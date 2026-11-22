import { db } from './db';
import { nowIso } from './ids';

export interface StorageStatus {
  supported: boolean;
  persisted: boolean;
  usageBytes?: number;
  quotaBytes?: number;
}

/** Asks the browser not to clear our data when space runs low. */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

export async function getStorageStatus(): Promise<StorageStatus> {
  if (!navigator.storage?.estimate) return { supported: false, persisted: false };
  const [est, persisted] = await Promise.all([
    navigator.storage.estimate(),
    navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(false),
  ]);
  return { supported: true, persisted, usageBytes: est.usage, quotaBytes: est.quota };
}

export async function getLastBackupAt(): Promise<string | null> {
  const row = await db.settings.get('lastBackupAt');
  return typeof row?.value === 'string' ? row.value : null;
}

export async function markBackupDone() {
  await db.settings.put({ key: 'lastBackupAt', value: nowIso() });
}

export function formatBytes(n?: number): string {
  if (n === undefined) return 'unknown';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}
