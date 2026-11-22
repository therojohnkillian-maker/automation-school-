import Dexie, { type Table } from 'dexie';

/** Bump when the stored shape changes. Exported files carry it too. */
export const SCHEMA_VERSION = 1;

/** Fields every user record carries, so optional sync is possible later. */
export interface BaseRecord {
  id: string;
  profileId: string;
  createdAt: string;
  updatedAt: string;
  deviceId: string;
  schemaVersion: number;
  deleted?: boolean;
}

export type Role = 'trainer' | 'technician';

export interface Profile extends BaseRecord {
  name: string;
  role: Role;
  pinSalt?: string;
  pinHash?: string;
}

/** Records that are only ever added, never edited (attempts, fault hunts, sign-offs). */
export type AppendOnlyRecord = BaseRecord & Record<string, unknown>;
/** Records that can be edited; on import the newer updatedAt wins. */
export type EditableRecord = BaseRecord & Record<string, unknown>;

export interface SettingRow {
  key: string;
  value: unknown;
}

export interface ImportRow {
  fileHash: string;
  sourceDeviceId: string;
  importedAt: string;
  kind: 'progress' | 'backup';
  summary: string;
}

export class SchoolDB extends Dexie {
  profiles!: Table<Profile, string>;
  enrolments!: Table<EditableRecord, string>;
  lessonProgress!: Table<EditableRecord, string>;
  attempts!: Table<AppendOnlyRecord, string>;
  faultSessions!: Table<AppendOnlyRecord, string>;
  signOffs!: Table<AppendOnlyRecord, string>;
  assignments!: Table<EditableRecord, string>;
  projects!: Table<EditableRecord, string>;
  labSaves!: Table<EditableRecord, string>;
  settings!: Table<SettingRow, string>;
  imports!: Table<ImportRow, string>;

  constructor(name = 'automation-school') {
    super(name);
    this.version(1).stores({
      profiles: 'id, role, updatedAt',
      enrolments: 'id, profileId, [profileId+moduleId], updatedAt',
      lessonProgress: 'id, profileId, [profileId+lessonId], updatedAt',
      attempts: 'id, profileId, lessonId, createdAt',
      faultSessions: 'id, profileId, attemptId, createdAt',
      signOffs: 'id, profileId, learnerId, createdAt',
      assignments: 'id, profileId, learnerId, updatedAt',
      projects: 'id, profileId, updatedAt',
      labSaves: 'id, profileId, updatedAt',
      settings: 'key',
      imports: 'fileHash, importedAt',
    });
  }
}

/** Per-learner tables, and how each one merges on import. */
export const APPEND_ONLY_TABLES = ['attempts', 'faultSessions', 'signOffs'] as const;
export const EDITABLE_TABLES = ['enrolments', 'lessonProgress', 'assignments', 'projects', 'labSaves'] as const;
export const RECORD_TABLES = [...APPEND_ONLY_TABLES, ...EDITABLE_TABLES] as const;
export type RecordTableName = (typeof RECORD_TABLES)[number];

export let db = new SchoolDB();

/** Tests use a fresh database each time. */
export function useDatabase(next: SchoolDB) {
  db = next;
}
