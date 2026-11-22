/**
 * Pilot report: one row per learner, lesson and step, built from what the app already records.
 * Exported as CSV so it opens in any spreadsheet.
 */
import { db, type Profile } from '../../data/db';
import { lessonById, lessonsInOrder } from '../../content';
import { STEPS } from '../../content/types';

interface Rec {
  profileId: string;
  lessonId?: string | null;
  kind?: string;
  step?: string | null;
  seconds?: number;
  passed?: boolean;
  failure?: string | null;
  problems?: { text: string }[];
  hints?: number;
  critical?: boolean;
  criticalFail?: boolean;
  text?: string;
  createdAt: string;
  deleted?: boolean;
}

export interface ReportRow {
  learner: string;
  lesson: string;
  step: string;
  minutes: number | '';
  attempts: number;
  failedAttempts: number;
  problems: string;
  hints: number;
  safetyErrors: number;
  feedback: string;
}

const KIND_STEP: Record<string, string> = { build: 'build', break: 'break', quiz: 'prove' };

export function buildReportRows(people: Profile[], attempts: Rec[], feedback: Rec[]): ReportRow[] {
  const rows: ReportRow[] = [];
  for (const p of people) {
    for (const l of lessonsInOrder()) {
      for (const s of STEPS) {
        const mine = attempts.filter((a) => a.profileId === p.id && a.lessonId === l.id && !a.deleted);
        const stepTimes = mine.filter((a) => a.kind === 'step' && a.step === s.id);
        const tries = mine.filter((a) => a.kind && KIND_STEP[a.kind] === s.id);
        const notes = feedback.filter((f) => f.profileId === p.id && f.lessonId === l.id && f.step === s.id && !f.deleted);
        if (!stepTimes.length && !tries.length && !notes.length) continue;
        const problems = new Set<string>();
        for (const t of tries) {
          if (t.failure) problems.add(t.failure);
          for (const pr of t.problems ?? []) problems.add(pr.text);
        }
        const secs = stepTimes.reduce((sum, t) => sum + (t.seconds ?? 0), 0);
        rows.push({
          learner: p.name,
          lesson: l.title,
          step: s.label,
          minutes: stepTimes.length ? Math.round((secs / 60) * 10) / 10 : '',
          attempts: tries.length,
          failedAttempts: tries.filter((t) => !t.passed).length,
          problems: [...problems].join(' | '),
          hints: tries.reduce((m, t) => Math.max(m, t.hints ?? 0), 0),
          safetyErrors: tries.filter((t) => t.critical || t.criticalFail).length,
          feedback: notes.map((n) => n.text).join(' | '),
        });
      }
    }
    // Notes written outside a lesson.
    for (const n of feedback.filter((f) => f.profileId === p.id && !f.lessonId && !f.deleted)) {
      rows.push({ learner: p.name, lesson: '(outside a lesson)', step: '', minutes: '', attempts: 0, failedAttempts: 0, problems: '', hints: 0, safetyErrors: 0, feedback: n.text ?? '' });
    }
  }
  return rows;
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: ReportRow[]): string {
  const head = ['Learner', 'Lesson', 'Step', 'Minutes', 'Attempts', 'Failed attempts', 'Problems shown', 'Hints used', 'Safety errors', 'Feedback notes'];
  const lines = rows.map((r) => [r.learner, r.lesson, r.step, r.minutes, r.attempts, r.failedAttempts, r.problems, r.hints, r.safetyErrors, r.feedback].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\r\n') + '\r\n';
}

export async function pilotReport(people: Profile[]) {
  const attempts = (await db.attempts.toArray()) as unknown as Rec[];
  const feedback = (await db.feedback.toArray()) as unknown as Rec[];
  const rows = buildReportRows(people, attempts, feedback);
  const notes = feedback
    .filter((f) => !f.deleted)
    .map((f) => ({ learner: people.find((p) => p.id === f.profileId)?.name ?? 'Removed profile', where: f.lessonId ? `${lessonById(f.lessonId)?.title ?? f.lessonId} · ${f.step ?? ''}` : 'Outside a lesson', text: f.text ?? '', at: f.createdAt }))
    .sort((a, b) => b.at.localeCompare(a.at));
  return { rows, notes, csv: toCsv(rows) };
}
