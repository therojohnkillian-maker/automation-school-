import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { lessonById, moduleById } from '../../content';
import { STEPS, type StepId } from '../../content/types';
import { useSession } from '../../app/session';
import { Notice } from '../../components/ui';
import {
  allProgress,
  attemptsFor,
  ensureProgress,
  firstOpenStep,
  lessonStatus,
  recordAttempt,
  recordFaultSession,
  stepDone,
  stepOpen,
  updateSteps,
  type LessonProgress,
  type StepStates,
} from '../../data/progress';
import { WhyStep, LearnStep, ShowIsolationStep, BuildIsolationStep, BreakIsolationStep, ProveStep, ApplyStep } from './Steps';
import { ShowCircuitStep, BuildCircuitStep, BreakCircuitStep } from './CircuitSteps';
import type { StepProps } from './stepTypes';

export function LessonPage() {
  const { lessonId = '', step } = useParams();
  const navigate = useNavigate();
  const profile = useSession((s) => s.profile)!;
  const lesson = lessonById(lessonId);
  const [progress, setProgress] = useState<LessonProgress | null>(null);
  const [locked, setLocked] = useState(false);
  const [lastFaultId, setLastFaultId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!lesson) return;
    const all = await allProgress(profile.id);
    if (lessonStatus(lesson.id, all) === 'locked') {
      setLocked(true);
      return;
    }
    setProgress(await ensureProgress(profile.id, lesson.id));
    const last = (await attemptsFor(profile.id, lesson.id)).find((a) => a.kind === 'break');
    setLastFaultId((last?.faultId as string) ?? null);
  }, [lesson, profile.id]);
  useEffect(() => void load(), [load]);

  if (!lesson) return <Navigate to="/learn" replace />;
  const mod = moduleById(lesson.moduleId);

  if (locked) {
    const req = lesson.requires.map((r) => lessonById(r)?.title).join(', ');
    return (
      <main>
        <h1>{lesson.title}</h1>
        <Notice kind="info">🔒 Locked. Pass <strong>{req}</strong> first (Break and Prove steps). Safety comes before any lab.</Notice>
        <Link to="/learn">Back to lessons</Link>
      </main>
    );
  }
  if (!progress) return <main><p>Loading…</p></main>;

  const current = (STEPS.some((s) => s.id === step) ? step : firstOpenStep(progress.steps)) as StepId;
  if (!stepOpen(progress.steps, current)) return <Navigate to={`/learn/${lesson.id}/${firstOpenStep(progress.steps)}`} replace />;

  const done = async (change: (s: StepStates) => StepStates, goNext = true) => {
    const idx = STEPS.findIndex((s) => s.id === current);
    const next = STEPS[Math.min(idx + 1, STEPS.length - 1)].id;
    const updated = await updateSteps(profile.id, lesson.id, change, goNext ? next : current);
    setProgress(updated);
    if (goNext && next !== current) {
      navigate(`/learn/${lesson.id}/${next}`);
      window.scrollTo({ top: 0 });
    }
  };

  const props: StepProps = {
    lesson,
    progress,
    profileId: profile.id,
    done,
    record: async (d) => {
      const r = await recordAttempt(profile.id, d);
      if (d.kind === 'break') setLastFaultId(d.faultId as string);
      return r;
    },
    recordSession: (d) => recordFaultSession(profile.id, d),
    lastFaultId,
  };

  const kindShow = lesson.show.kind;
  const body = {
    why: <WhyStep {...props} />,
    learn: <LearnStep {...props} />,
    show: kindShow === 'circuit' ? <ShowCircuitStep {...props} /> : <ShowIsolationStep {...props} />,
    build: lesson.build.kind === 'circuit' ? <BuildCircuitStep {...props} /> : <BuildIsolationStep {...props} />,
    break: lesson.break.kind === 'circuit' ? <BreakCircuitStep {...props} /> : <BreakIsolationStep {...props} />,
    prove: <ProveStep {...props} />,
    apply: <ApplyStep {...props} />,
  }[current];

  return (
    <main className="lesson">
      <p className="crumbs"><Link to="/learn">Learn</Link> › {mod?.code} {mod?.title}</p>
      <h1>{lesson.title}</h1>
      <nav className="stepper" aria-label="Lesson steps">
        {STEPS.map((s, i) => {
          const isDone = stepDone(progress.steps, s.id);
          const open = stepOpen(progress.steps, s.id);
          const state = s.id === current ? 'current' : isDone ? 'done' : open ? 'open' : 'locked';
          const icon = state === 'done' ? '✔' : state === 'locked' ? '🔒' : String(i + 1);
          const label = `${s.label}: ${state === 'current' ? 'current step' : state === 'done' ? 'done' : state === 'locked' ? 'locked' : 'open'}`;
          return open ? (
            <Link key={s.id} to={`/learn/${lesson.id}/${s.id}`} className={`stp stp-${state}`} aria-current={s.id === current ? 'step' : undefined} aria-label={label}>
              <span className="stp-icon" aria-hidden="true">{icon}</span>
              <span className="stp-label">{s.short}</span>
            </Link>
          ) : (
            <span key={s.id} className={`stp stp-${state}`} aria-label={label}>
              <span className="stp-icon" aria-hidden="true">{icon}</span>
              <span className="stp-label">{s.short}</span>
            </span>
          );
        })}
      </nav>
      <h2 className="step-title">{STEPS.find((s) => s.id === current)!.label}</h2>
      <div key={current}>{body}</div>
    </main>
  );
}
