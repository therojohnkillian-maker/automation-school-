import { db, type BaseRecord, type EditableRecord } from './db';
import { baseFields, nowIso } from './ids';
import { lessonById, lessonsInOrder } from '../content';
import type { StepId } from '../content/types';
import { STEPS } from '../content/types';

export type ApplyStatus = 'not-requested' | 'requested' | 'signed' | 'redo';

export interface StepStates {
  why?: boolean;
  learn?: boolean;
  show?: boolean;
  buildGuided?: boolean;
  build?: boolean;
  break?: { passed: boolean; bestScore: number };
  prove?: { passed: boolean; bestScore: number };
  apply?: { status: ApplyStatus; requestedAt?: string; signOffId?: string; note?: string; signedBy?: string; signedAt?: string };
}

export interface LessonProgress extends BaseRecord {
  lessonId: string;
  contentVersion: string;
  currentStep: StepId;
  steps: StepStates;
}

export async function getProgress(profileId: string, lessonId: string): Promise<LessonProgress | undefined> {
  const rows = await db.lessonProgress.where('[profileId+lessonId]').equals([profileId, lessonId]).toArray();
  return rows.filter((r) => !r.deleted).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] as unknown as LessonProgress | undefined;
}

export async function allProgress(profileId: string): Promise<LessonProgress[]> {
  return (await db.lessonProgress.where('profileId').equals(profileId).toArray()).filter((r) => !r.deleted) as unknown as LessonProgress[];
}

export async function ensureProgress(profileId: string, lessonId: string): Promise<LessonProgress> {
  const existing = await getProgress(profileId, lessonId);
  if (existing) return existing;
  const lesson = lessonById(lessonId)!;
  const rec: LessonProgress = { ...(await baseFields(profileId)), lessonId, contentVersion: lesson.version, currentStep: 'why', steps: {} };
  await db.lessonProgress.add(rec as unknown as EditableRecord);
  return rec;
}

export async function updateSteps(profileId: string, lessonId: string, change: (s: StepStates) => StepStates, currentStep?: StepId): Promise<LessonProgress> {
  const p = await ensureProgress(profileId, lessonId);
  const next: LessonProgress = { ...p, steps: change({ ...p.steps }), updatedAt: nowIso(), ...(currentStep ? { currentStep } : {}) };
  await db.lessonProgress.put(next as unknown as EditableRecord);
  return next;
}

/** Is this step finished? */
export function stepDone(s: StepStates, step: StepId): boolean {
  switch (step) {
    case 'why':
      return !!s.why;
    case 'learn':
      return !!s.learn;
    case 'show':
      return !!s.show;
    case 'build':
      return !!s.build;
    case 'break':
      return !!s.break?.passed;
    case 'prove':
      return !!s.prove?.passed;
    case 'apply':
      return s.apply?.status === 'requested' || s.apply?.status === 'signed';
  }
}

/** A step is open when every earlier step is done. */
export function stepOpen(s: StepStates, step: StepId): boolean {
  const i = STEPS.findIndex((x) => x.id === step);
  return STEPS.slice(0, i).every((x) => stepDone(s, x.id));
}

export function firstOpenStep(s: StepStates): StepId {
  return (STEPS.find((x) => !stepDone(s, x.id))?.id ?? 'apply') as StepId;
}

/** Passed in the app: fault-finding and the scored test. Signing off is separate. */
export const appPassed = (s?: StepStates) => !!s?.break?.passed && !!s?.prove?.passed;

export type LessonStatus = 'locked' | 'new' | 'progress' | 'awaiting' | 'redo' | 'signed';

export function lessonStatus(lessonId: string, all: LessonProgress[]): LessonStatus {
  const lesson = lessonById(lessonId)!;
  const byId = new Map(all.map((p) => [p.lessonId, p]));
  if (lesson.requires.some((r) => !appPassed(byId.get(r)?.steps))) return 'locked';
  const p = byId.get(lessonId);
  if (!p) return 'new';
  const a = p.steps.apply?.status;
  if (a === 'signed') return 'signed';
  if (a === 'requested') return 'awaiting';
  if (a === 'redo') return 'redo';
  return 'progress';
}

/** The next thing to do, for Home. */
export async function nextTask(profileId: string) {
  const all = await allProgress(profileId);
  for (const l of lessonsInOrder()) {
    const st = lessonStatus(l.id, all);
    if (st === 'new' || st === 'progress' || st === 'redo') {
      const p = all.find((x) => x.lessonId === l.id);
      return { lesson: l, status: st, step: p ? firstOpenStep(p.steps) : ('why' as StepId) };
    }
  }
  return null;
}

// ---------- attempts and fault sessions (append-only) ----------

export async function recordAttempt(profileId: string, data: Record<string, unknown>) {
  const rec = { ...(await baseFields(profileId)), ...data };
  await db.attempts.add(rec);
  return rec;
}

export async function recordFaultSession(profileId: string, data: Record<string, unknown>) {
  const rec = { ...(await baseFields(profileId)), ...data };
  await db.faultSessions.add(rec);
  return rec;
}

export async function attemptsFor(profileId: string, lessonId: string) {
  return (await db.attempts.where('profileId').equals(profileId).toArray())
    .filter((a) => a.lessonId === lessonId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------- sign-off ----------

export async function requestSignOff(profileId: string, lessonId: string) {
  return updateSteps(profileId, lessonId, (s) => ({ ...s, apply: { status: 'requested', requestedAt: nowIso() } }), 'apply');
}

export interface SignOffInput {
  learnerId: string;
  lessonId: string;
  trainerId: string;
  trainerName: string;
  items: { id: string; observed: boolean }[];
  note: string;
  outcome: 'signed' | 'redo';
}

/** Only a trainer may call this (the UI checks the role and PIN). */
export async function signOff(input: SignOffInput) {
  const lesson = lessonById(input.lessonId)!;
  const rec = { ...(await baseFields(input.learnerId)), ...input, contentVersion: lesson.version };
  await db.signOffs.add(rec);
  await updateSteps(input.learnerId, input.lessonId, (s) => ({
    ...s,
    apply:
      input.outcome === 'signed'
        ? { status: 'signed', signOffId: rec.id, signedBy: input.trainerName, signedAt: rec.createdAt, note: input.note }
        : { status: 'redo', signOffId: rec.id, note: input.note },
  }));
  return rec;
}

export async function awaitingSignOff() {
  const rows = (await db.lessonProgress.toArray()).filter((r) => !r.deleted) as unknown as LessonProgress[];
  return rows.filter((r) => r.steps.apply?.status === 'requested');
}
