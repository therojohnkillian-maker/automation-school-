import { ulid } from 'ulid';
import { db, SCHEMA_VERSION, type BaseRecord } from './db';

export const newId = () => ulid();
export const nowIso = () => new Date().toISOString();

/** A random id for this browser install, created once and kept in settings. */
export async function getDeviceId(): Promise<string> {
  const row = await db.settings.get('deviceId');
  if (row && typeof row.value === 'string') return row.value;
  const id = `dev-${ulid()}`;
  await db.settings.put({ key: 'deviceId', value: id });
  return id;
}

/** Fills the shared fields for a new record. */
export async function baseFields(profileId: string): Promise<BaseRecord> {
  const t = nowIso();
  return {
    id: newId(),
    profileId,
    createdAt: t,
    updatedAt: t,
    deviceId: await getDeviceId(),
    schemaVersion: SCHEMA_VERSION,
  };
}
