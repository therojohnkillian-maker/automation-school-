import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { SchoolDB, useDatabase, db } from '../../src/data/db';
import { createProfile } from '../../src/data/profiles';
import { baseFields } from '../../src/data/ids';
import { buildProgress, importProgress } from '../../src/data/files';
import { pilotReport } from '../../src/features/pilot/report';

let n = 0;
beforeEach(async () => {
  useDatabase(new SchoolDB(`pilot-${++n}`));
  await db.open();
});

describe('pilot report', () => {
  it('summarises time, attempts, failures, hints and notes per step', async () => {
    const a = await createProfile({ name: 'Kabo', role: 'technician' });
    const add = async (data: Record<string, unknown>) => db.attempts.add({ ...(await baseFields(a.id)), ...data });
    await add({ kind: 'step', lessonId: 'm3-l1', step: 'build', seconds: 600 });
    await add({ kind: 'build', lessonId: 'm3-l1', passed: false, failure: 'KM1 drops out when you let go of START.', hints: 2 });
    await add({ kind: 'build', lessonId: 'm3-l1', passed: true, failure: null, hints: 3 });
    await db.feedback.add({ ...(await baseFields(a.id)), lessonId: 'm3-l1', step: 'build', text: 'Hard to tap terminals, "small", on my phone' });
    const r = await pilotReport([a]);
    const row = r.rows.find((x) => x.step === 'Build')!;
    expect(row).toMatchObject({ learner: 'Kabo', minutes: 10, attempts: 2, failedAttempts: 1, hints: 3 });
    expect(row.problems).toContain('drops out');
    expect(r.csv.split('\r\n')[0]).toContain('Feedback notes');
    expect(r.csv).toContain('"Hard to tap terminals, ""small"", on my phone"');
    expect(r.notes[0].where).toContain('DOL starter');
  });

  it('feedback travels in progress files and imports once', async () => {
    const a = await createProfile({ name: 'Thandi', role: 'technician' });
    await db.feedback.add({ ...(await baseFields(a.id)), lessonId: 'm0-l1', step: 'why', text: 'Clear' });
    const text = JSON.stringify(await buildProgress(a.id));
    useDatabase(new SchoolDB(`pilot-${++n}`));
    await db.open();
    await importProgress(text);
    expect(await db.feedback.count()).toBe(1);
    expect((await importProgress(text)).status).toBe('already-imported');
  });
});
