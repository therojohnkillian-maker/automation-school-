import { z } from 'zod';
import {
  db,
  SCHEMA_VERSION,
  APPEND_ONLY_TABLES,
  EDITABLE_TABLES,
  RECORD_TABLES,
  type Profile,
  type BaseRecord,
  type RecordTableName,
  type SettingRow,
} from './db';
import { getDeviceId, nowIso } from './ids';
import { sha256Hex } from './pin';

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
export const BACKUP_FORMAT = 'automation-school/backup';
export const PROGRESS_FORMAT = 'automation-school/progress';
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

// ---------- Schemas: every imported file is checked before anything is written ----------

const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'must be a date');
const id = z.string().min(1).max(64);

const baseShape = {
  id,
  profileId: z.string().max(64),
  createdAt: iso,
  updatedAt: iso,
  deviceId: z.string().min(1).max(80),
  schemaVersion: z.number().int().min(1),
  deleted: z.boolean().optional(),
};

const recordSchema = z.object(baseShape).passthrough();

const profileSchema = z
  .object({
    ...baseShape,
    name: z.string().min(1).max(40),
    role: z.enum(['trainer', 'technician']),
    pinSalt: z.string().regex(/^[0-9a-f]{8,64}$/).optional(),
    pinHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  })
  .strict();

const tablesShape = Object.fromEntries(RECORD_TABLES.map((t) => [t, z.array(recordSchema).default([])])) as Record<
  RecordTableName,
  z.ZodDefault<z.ZodArray<typeof recordSchema>>
>;

const header = {
  appVersion: z.string().max(20),
  schemaVersion: z.number().int().min(1),
  exportedAt: iso,
  deviceId: z.string().min(1).max(80),
};

export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  ...header,
  data: z.object({
    profiles: z.array(profileSchema),
    settings: z.array(z.object({ key: z.string().max(64), value: z.unknown() })).default([]),
    ...tablesShape,
  }),
});

export const progressSchema = z.object({
  format: z.literal(PROGRESS_FORMAT),
  ...header,
  profile: profileSchema,
  data: z.object(tablesShape),
});

export type BackupFile = z.infer<typeof backupSchema>;
export type ProgressFile = z.infer<typeof progressSchema>;

// ---------- Export ----------

type Rec = BaseRecord & Record<string, unknown>;
const tableOf = (name: RecordTableName) => db.table<Rec, string>(name);

/** Settings that belong to this browser only and must not travel. */
const LOCAL_ONLY_SETTINGS = new Set(['deviceId']);

export async function buildBackup(): Promise<BackupFile> {
  const data: Record<string, unknown[]> = {};
  for (const t of RECORD_TABLES) data[t] = await tableOf(t).toArray();
  const settings = (await db.settings.toArray()).filter((s) => !LOCAL_ONLY_SETTINGS.has(s.key));
  return {
    format: BACKUP_FORMAT,
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowIso(),
    deviceId: await getDeviceId(),
    data: { profiles: await db.profiles.toArray(), settings, ...data } as BackupFile['data'],
  };
}

/** Everything that belongs to one learner, for the trainer to import on another device. */
export async function buildProgress(profileId: string): Promise<ProgressFile> {
  const profile = await db.profiles.get(profileId);
  if (!profile || profile.deleted) throw new Error('Profile not found.');
  const data: Record<string, unknown[]> = {};
  for (const t of RECORD_TABLES) {
    data[t] = await tableOf(t).where('profileId').equals(profileId).toArray();
  }
  return {
    format: PROGRESS_FORMAT,
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowIso(),
    deviceId: await getDeviceId(),
    profile,
    data: data as ProgressFile['data'],
  };
}

// ---------- Parse and validate ----------

export class FileProblem extends Error {}

function describeZod(err: z.ZodError): string {
  const first = err.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'file'}: ${i.message}`);
  return first.join('; ') + (err.issues.length > 3 ? ` (and ${err.issues.length - 3} more)` : '');
}

function parseJson(text: string): unknown {
  if (text.length > MAX_FILE_BYTES) throw new FileProblem('This file is too large to be an Automation School file.');
  try {
    return JSON.parse(text);
  } catch {
    throw new FileProblem('This is not a valid Automation School file (it is not readable JSON).');
  }
}

function checkVersion(v: number) {
  if (v > SCHEMA_VERSION) {
    throw new FileProblem('This file was made by a newer version of the app. Update the app on this device first, then try again.');
  }
}

export function parseBackup(text: string): BackupFile {
  const raw = parseJson(text) as { format?: unknown };
  if (raw?.format === PROGRESS_FORMAT) {
    throw new FileProblem('This is a progress file for one person. Use "Import progress" in the Trainer area instead.');
  }
  const r = backupSchema.safeParse(raw);
  if (!r.success) throw new FileProblem(`This backup file failed its checks, so nothing was changed. ${describeZod(r.error)}`);
  checkVersion(r.data.schemaVersion);
  return r.data;
}

export function parseProgress(text: string): ProgressFile {
  const raw = parseJson(text) as { format?: unknown };
  if (raw?.format === BACKUP_FORMAT) {
    throw new FileProblem('This is a full backup. Use "Restore backup" in Settings instead.');
  }
  const r = progressSchema.safeParse(raw);
  if (!r.success) throw new FileProblem(`This progress file failed its checks, so nothing was changed. ${describeZod(r.error)}`);
  checkVersion(r.data.schemaVersion);
  const pid = r.data.profile.id;
  for (const t of RECORD_TABLES) {
    if (r.data.data[t].some((rec) => rec.profileId !== pid)) {
      throw new FileProblem('This progress file contains records for someone else, so nothing was changed.');
    }
  }
  return r.data;
}

// ---------- Restore (replaces everything on this device) ----------

export async function restoreBackup(text: string): Promise<{ profiles: number; records: number }> {
  const file = parseBackup(text);
  const deviceId = await getDeviceId();
  let records = 0;
  await db.transaction('rw', [db.profiles, db.settings, db.imports, ...RECORD_TABLES.map((t) => tableOf(t))], async () => {
    await db.profiles.clear();
    await db.profiles.bulkAdd(file.data.profiles as Profile[]);
    for (const t of RECORD_TABLES) {
      await tableOf(t).clear();
      const rows = file.data[t] as (BaseRecord & Record<string, unknown>)[];
      await tableOf(t).bulkAdd(rows);
      records += rows.length;
    }
    await db.settings.clear();
    await db.settings.bulkPut(file.data.settings as SettingRow[]);
    await db.settings.put({ key: 'deviceId', value: deviceId });
  });
  return { profiles: file.data.profiles.length, records };
}

// ---------- Import one learner's progress (merges, never duplicates) ----------

export interface ImportResult {
  status: 'imported' | 'already-imported';
  learner: string;
  added: number;
  updated: number;
  unchanged: number;
  notes: string[];
}

const newer = (a: { updatedAt: string }, b: { updatedAt: string }) => Date.parse(a.updatedAt) > Date.parse(b.updatedAt);

export async function importProgress(text: string): Promise<ImportResult> {
  const file = parseProgress(text);
  const fileHash = await sha256Hex(text);
  if (await db.imports.get(fileHash)) {
    return { status: 'already-imported', learner: file.profile.name, added: 0, updated: 0, unchanged: 0, notes: [] };
  }

  const result: ImportResult = { status: 'imported', learner: file.profile.name, added: 0, updated: 0, unchanged: 0, notes: [] };

  await db.transaction('rw', [db.profiles, db.imports, ...RECORD_TABLES.map((t) => tableOf(t))], async () => {
    // Profile: newer wins. A different person with the same name keeps both, renamed.
    const incoming = file.profile as Profile;
    const local = await db.profiles.get(incoming.id);
    if (!local) {
      const all = await db.profiles.toArray();
      const clash = all.find((p) => !p.deleted && p.name.toLowerCase() === incoming.name.toLowerCase());
      const toAdd = { ...incoming };
      if (clash) {
        toAdd.name = `${incoming.name} (imported)`.slice(0, 40);
        result.notes.push(`A different profile called "${incoming.name}" already exists here, so this one was added as "${toAdd.name}".`);
      }
      await db.profiles.add(toAdd);
      result.added++;
    } else if (newer(incoming, local)) {
      // Keep this device's PIN if the incoming profile has none.
      await db.profiles.put({ ...local, ...incoming });
      result.updated++;
      if (local.deleted && !incoming.deleted) result.notes.push(`"${incoming.name}" had been removed here and has been brought back by a newer file.`);
    } else {
      result.unchanged++;
      if (local.deleted) result.notes.push(`"${local.name}" was removed on this device after this file was made, so the profile stays removed. Their records were still imported.`);
    }

    for (const t of APPEND_ONLY_TABLES) {
      for (const rec of file.data[t]) {
        if (await tableOf(t).get(rec.id)) result.unchanged++;
        else {
          await tableOf(t).add(rec as Rec);
          result.added++;
        }
      }
    }
    for (const t of EDITABLE_TABLES) {
      for (const rec of file.data[t]) {
        const existing = await tableOf(t).get(rec.id);
        if (!existing) {
          await tableOf(t).add(rec as Rec);
          result.added++;
        } else if (newer(rec, existing)) {
          await tableOf(t).put(rec as Rec);
          result.updated++;
        } else result.unchanged++;
      }
    }

    await db.imports.put({
      fileHash,
      sourceDeviceId: file.deviceId,
      importedAt: nowIso(),
      kind: 'progress',
      summary: `${file.profile.name}: ${result.added} added, ${result.updated} updated`,
    });
  });

  return result;
}

// ---------- File names ----------

const day = () => new Date().toISOString().slice(0, 10);
const safe = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'profile';
export const backupFileName = () => `automation-school-${day()}.asbackup.json`;
export const progressFileName = (name: string) => `${safe(name)}-${day()}.asprogress.json`;
