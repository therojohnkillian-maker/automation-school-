import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { SchoolDB, useDatabase, db } from '../../src/data/db';
import { createProfile, listProfiles, removeProfile, updateProfile } from '../../src/data/profiles';
import { baseFields } from '../../src/data/ids';
import { checkPin } from '../../src/data/pin';
import {
  buildBackup,
  buildProgress,
  importProgress,
  restoreBackup,
  parseBackup,
  parseProgress,
  FileProblem,
} from '../../src/data/files';

let n = 0;
beforeEach(async () => {
  const fresh = new SchoolDB(`test-${++n}`);
  useDatabase(fresh);
  await fresh.open();
});

async function addAttempt(profileId: string, score: number) {
  const rec = { ...(await baseFields(profileId)), kind: 'quiz', lessonId: 'm0-l1', score };
  await db.attempts.add(rec);
  return rec;
}

/** Simulates a second device: export, wipe into a new database, return the text. */
async function moveToNewDevice<T>(build: () => Promise<T>): Promise<string> {
  const text = JSON.stringify(await build());
  useDatabase(new SchoolDB(`test-${++n}`));
  await db.open();
  return text;
}

describe('profiles', () => {
  it('creates, renames and checks a PIN', async () => {
    const p = await createProfile({ name: '  SD ', role: 'trainer', pin: '1234' });
    expect(p.name).toBe('SD');
    expect(await checkPin('1234', p.pinSalt!, p.pinHash!)).toBe(true);
    expect(await checkPin('9999', p.pinSalt!, p.pinHash!)).toBe(false);
    await updateProfile(p.id, { name: 'SD Trainer', pin: null });
    const [after] = await listProfiles();
    expect(after.name).toBe('SD Trainer');
    expect(after.pinHash).toBeUndefined();
  });

  it('rejects duplicate names and bad PINs', async () => {
    await createProfile({ name: 'Thandi', role: 'technician' });
    await expect(createProfile({ name: 'thandi', role: 'technician' })).rejects.toThrow(/already/);
    await expect(createProfile({ name: 'Kabo', role: 'technician', pin: '12' })).rejects.toThrow(/4 to 8/);
  });

  it('will not remove the only trainer', async () => {
    const t = await createProfile({ name: 'SD', role: 'trainer' });
    await expect(removeProfile(t.id)).rejects.toThrow(/only trainer/);
  });
});

describe('backup and restore', () => {
  it('restores everything after data is lost', async () => {
    const t = await createProfile({ name: 'SD', role: 'trainer' });
    const a = await createProfile({ name: 'Thandi', role: 'technician' });
    await addAttempt(a.id, 90);
    const text = JSON.stringify(await buildBackup());

    await db.profiles.clear();
    await db.attempts.clear();
    expect(await listProfiles()).toHaveLength(0);

    const r = await restoreBackup(text);
    expect(r.profiles).toBe(2);
    expect(r.records).toBe(1);
    expect((await listProfiles()).map((p) => p.id).sort()).toEqual([t.id, a.id].sort());
  });

  it('keeps this device id when restoring a backup from another device', async () => {
    await createProfile({ name: 'SD', role: 'trainer' });
    const text = await moveToNewDevice(buildBackup);
    const before = (await db.settings.get('deviceId'))?.value;
    await restoreBackup(text);
    const after = (await db.settings.get('deviceId'))?.value;
    if (before) expect(after).toBe(before);
    else expect(typeof after).toBe('string');
    expect(JSON.parse(text).data.settings.some((s: { key: string }) => s.key === 'deviceId')).toBe(false);
  });

  it('changes nothing when the file is damaged', async () => {
    await createProfile({ name: 'SD', role: 'trainer' });
    const good = await buildBackup();
    const bad = JSON.parse(JSON.stringify(good));
    bad.data.profiles[0].role = 'admin';
    await expect(restoreBackup(JSON.stringify(bad))).rejects.toBeInstanceOf(FileProblem);
    await expect(restoreBackup('not json')).rejects.toThrow(/not readable JSON/);
    expect(await listProfiles()).toHaveLength(1);
  });

  it('refuses files from a newer app version', () => {
    const f = { format: 'automation-school/backup', appVersion: '9', schemaVersion: 99, exportedAt: new Date().toISOString(), deviceId: 'x', data: { profiles: [] } };
    expect(() => parseBackup(JSON.stringify(f))).toThrow(/newer version/);
  });
});

describe('progress import', () => {
  it('adds a learner and their attempts on the trainer device', async () => {
    const a = await createProfile({ name: 'Thandi', role: 'technician' });
    await addAttempt(a.id, 85);
    await addAttempt(a.id, 92);
    const text = await moveToNewDevice(() => buildProgress(a.id));

    await createProfile({ name: 'SD', role: 'trainer' });
    const r = await importProgress(text);
    expect(r.status).toBe('imported');
    expect(r.added).toBe(3); // profile + 2 attempts
    expect(await db.attempts.count()).toBe(2);
  });

  it('never creates duplicates, even with overlapping files', async () => {
    const a = await createProfile({ name: 'Thandi', role: 'technician' });
    await addAttempt(a.id, 70);
    const first = JSON.stringify(await buildProgress(a.id));
    await addAttempt(a.id, 88);
    const second = JSON.stringify(await buildProgress(a.id));

    useDatabase(new SchoolDB(`test-${++n}`));
    await db.open();
    await importProgress(first);
    const again = await importProgress(first);
    expect(again.status).toBe('already-imported');
    const r2 = await importProgress(second);
    expect(r2.added).toBe(1);
    expect(await db.attempts.count()).toBe(2);
    expect(await db.profiles.count()).toBe(1);
  });

  it('keeps the newer version of editable records', async () => {
    const a = await createProfile({ name: 'Thandi', role: 'technician' });
    const lp = { ...(await baseFields(a.id)), lessonId: 'm0-l1', currentStep: 2 };
    await db.lessonProgress.add(lp);
    const text = await moveToNewDevice(() => buildProgress(a.id));
    await importProgress(text);
    // Trainer device has moved on further since.
    await db.lessonProgress.put({ ...lp, currentStep: 5, updatedAt: new Date(Date.now() + 60_000).toISOString() });
    const old = JSON.parse(text);
    old.exportedAt = new Date().toISOString(); // a different file with the same records
    await importProgress(JSON.stringify(old));
    expect((await db.lessonProgress.get(lp.id))?.currentStep).toBe(5);
  });

  it('renames a different person who has the same name', async () => {
    const a = await createProfile({ name: 'Kabo', role: 'technician' });
    const text = await moveToNewDevice(() => buildProgress(a.id));
    await createProfile({ name: 'Kabo', role: 'technician' });
    const r = await importProgress(text);
    expect(r.notes[0]).toMatch(/Kabo \(imported\)/);
    expect((await listProfiles()).map((p) => p.name).sort()).toEqual(['Kabo', 'Kabo (imported)']);
  });

  it('rejects records that belong to someone else, and wrong file types', async () => {
    const a = await createProfile({ name: 'Thandi', role: 'technician' });
    await addAttempt(a.id, 80);
    const f = await buildProgress(a.id);
    (f.data.attempts[0] as { profileId: string }).profileId = 'someone-else';
    expect(() => parseProgress(JSON.stringify(f))).toThrow(/someone else/);
    const backup = JSON.stringify(await buildBackup());
    expect(() => parseProgress(backup)).toThrow(/Restore backup/);
    const progress = JSON.stringify(await buildProgress(a.id));
    expect(() => parseBackup(progress)).toThrow(/Import progress/);
  });
});
