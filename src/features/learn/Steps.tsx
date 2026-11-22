import { useMemo, useState } from 'react';
import { CircuitCanvas } from '../../components/CircuitCanvas';
import { Markup } from '../../components/Markup';
import { Card, Notice, StatusChip, useAction } from '../../components/ui';
import { circuit as circuitById } from '../../content';
import type { Lesson } from '../../content/types';
import { Circuit } from '../../engines/wiring/circuit';
import { makeRng, newSeed } from '../../engines/core/rng';
import type { FaultJson } from '../../engines/wiring/types';
import { requestSignOff } from '../../data/progress';
import { IsolationLab, type IsolationResult } from './IsolationLab';
import { breakScore, quizResult } from './scoring';
import type { StepProps } from './stepTypes';

// ------------------------------------------------------------------ WHY

export function WhyStep({ lesson, done }: StepProps) {
  return (
    <div className="narrow-step">
      <Markup text={lesson.why.text} />
      <div className="step-nav"><button className="primary" onClick={() => done((s) => ({ ...s, why: true }))}>Next: Learn ▶</button></div>
    </div>
  );
}

// ------------------------------------------------------------------ LEARN

export function LearnStep({ lesson, done }: StepProps) {
  const [i, setI] = useState(0);
  const card = lesson.learn.cards[i];
  const last = i === lesson.learn.cards.length - 1;
  const diagram = useMemo(() => {
    if (!card.circuit) return null;
    const c = new Circuit(circuitById(card.circuit));
    for (let t = 0; t < 3000; t += 10) c.step(10); // let motors settle so the drawing shows a steady state
    return c;
  }, [card.circuit]);
  return (
    <div className="narrow-step">
      <p className="hint">Card {i + 1} of {lesson.learn.cards.length}</p>
      <Card title={card.title}>
        <Markup text={card.text} />
        {diagram && <CircuitCanvas circuit={diagram} version={0} />}
      </Card>
      <div className="step-nav">
        <button disabled={i === 0} onClick={() => setI(i - 1)}>◀ Back</button>
        {last ? (
          <button className="primary" onClick={() => done((s) => ({ ...s, learn: true }))}>Next: Show ▶</button>
        ) : (
          <button className="primary" onClick={() => setI(i + 1)}>Next card ▶</button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ ISOLATION: SHOW / BUILD / BREAK

export function ShowIsolationStep({ lesson, done }: StepProps) {
  const show = lesson.show as Extract<Lesson['show'], { kind: 'isolation' }>;
  return (
    <div>
      <Markup text={show.intro} />
      <IsolationLab scenario={show.scenario} mode="demo" demo={show.demo} onFinish={() => done((s) => ({ ...s, show: true }))} />
    </div>
  );
}

export function BuildIsolationStep({ lesson, progress, done, record }: StepProps) {
  const build = lesson.build as Extract<Lesson['build'], { kind: 'isolation' }>;
  const guided = !progress.steps.buildGuided;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<IsolationResult | null>(null);

  const finish = async (r: IsolationResult) => {
    setResult(r);
    const passed = !!r.evaluation?.passed;
    await record({ kind: 'build', lessonId: lesson.id, mode: guided ? 'guided' : 'unguided', passed, problems: r.evaluation?.problems ?? [], tests: r.tests });
  };

  if (result) {
    const passed = !!result.evaluation?.passed;
    return (
      <div className="narrow-step">
        {passed ? (
          <Notice kind="ok"><strong>Correct procedure.</strong> Isolated, locked, and proved dead with prove-test-prove.</Notice>
        ) : (
          <Notice kind="error">
            <p><strong>Not safe yet.</strong></p>
            <ul>{result.evaluation?.problems.map((p) => <li key={p.text}>{p.critical ? '⚠ ' : ''}{p.text}</li>)}</ul>
          </Notice>
        )}
        <div className="step-nav">
          {!passed && <button className="primary" onClick={() => { setResult(null); setAttempt(attempt + 1); }}>Try again</button>}
          {passed && guided && <button className="primary" onClick={() => { setResult(null); setAttempt(attempt + 1); void done((s) => ({ ...s, buildGuided: true }), false); }}>Next: do it with no hints ▶</button>}
          {passed && !guided && <button className="primary" onClick={() => done((s) => ({ ...s, build: true }))}>Next: Break ▶</button>}
        </div>
      </div>
    );
  }
  return (
    <div>
      <p><StatusChip status="progress" label={guided ? 'Part 1 of 2: guided' : 'Part 2 of 2: on your own'} /></p>
      <Markup text={guided ? build.guided.intro : build.unguided.intro} />
      <IsolationLab key={`${guided}-${attempt}`} scenario={build.scenario} mode={guided ? 'guided' : 'unguided'} onFinish={finish} />
    </div>
  );
}

export function BreakIsolationStep({ lesson, done, record, recordSession, lastFaultId }: StepProps) {
  const br = lesson.break as Extract<Lesson['break'], { kind: 'isolation' }>;
  const pickRun = (exclude?: string | null) => {
    const seed = newSeed();
    const pool = br.faults.filter((f) => f.id !== exclude);
    return { seed, fault: makeRng(seed).pick(pool.length ? pool : br.faults) as FaultJson };
  };
  const [run, setRun] = useState(() => pickRun(lastFaultId));
  const [outcome, setOutcome] = useState<null | { passed: boolean; score: number; why: string[]; chosen: string | null }>(null);
  const reports = useMemo(() => [...br.faults.map((f) => f.report), ...br.extraReports], [br]);
  const faults = useMemo(() => [run.fault], [run]);

  const finish = async (r: IsolationResult) => {
    const why: string[] = [];
    const critical = r.evaluation ? r.evaluation.problems.some((p) => p.critical) : false;
    if (r.evaluation) why.push(...r.evaluation.problems.map((p) => p.text));
    const correct = r.report === run.fault.report;
    if (!correct) why.push(`The problem on this job was: ${run.fault.report}`);
    const passed = correct && !critical;
    const score = passed ? breakScore(r.tests, br.parMeasurements, r.seconds, br.parSeconds) : 0;
    const attempt = await record({ kind: 'break', lessonId: lesson.id, faultId: run.fault.id, passed, score, critical, measurements: r.tests, seconds: r.seconds, chosen: r.report });
    await recordSession({ attemptId: attempt.id, lessonId: lesson.id, faultId: run.fault.id, seed: run.seed, measurements: r.events, safetyEvents: r.evaluation?.problems.filter((p) => p.critical).map((p) => p.text) ?? [], result: passed ? 'found' : 'not-found' });
    setOutcome({ passed, score, why, chosen: r.report });
    if (passed) await done((s) => ({ ...s, break: { passed: true, bestScore: Math.max(score, s.break?.bestScore ?? 0) } }), false);
  };

  if (outcome) {
    return (
      <div className="narrow-step">
        {outcome.passed ? (
          <Notice kind="ok"><p><strong>Well done.</strong> You stayed safe and found the problem. Score {outcome.score}%.</p><p>{run.fault.report}</p></Notice>
        ) : (
          <Notice kind="error"><p><strong>Not passed.</strong></p><ul>{outcome.why.map((w) => <li key={w}>{w}</li>)}</ul></Notice>
        )}
        <div className="step-nav">
          <button onClick={() => { setOutcome(null); setRun(pickRun(run.fault.id)); }}>Try another job</button>
          {outcome.passed && <button className="primary" onClick={() => done((s) => s)}>Next: Prove ▶</button>}
        </div>
      </div>
    );
  }
  return (
    <div>
      <Markup text={br.intro} />
      <IsolationLab key={run.seed} scenario={br.scenario} mode="break" faults={faults} reports={reports} seed={run.seed} onFinish={finish} />
    </div>
  );
}

// ------------------------------------------------------------------ PROVE

export function ProveStep({ lesson, done, record }: StepProps) {
  const [seed, setSeed] = useState(() => newSeed());
  const quiz = useMemo(() => {
    const rng = makeRng(seed);
    return rng.shuffle(lesson.prove.questions).map((q) => {
      const order = rng.shuffle(q.options.map((_, i) => i));
      return { q, order };
    });
  }, [seed, lesson.prove.questions]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ReturnType<typeof quizResult> | null>(null);
  const { busy, run } = useAction();
  const allAnswered = quiz.every(({ q }) => answers[q.id] !== undefined);

  const submit = () =>
    run(async () => {
      const correct = quiz.map(({ q }) => answers[q.id] === q.answer);
      const r = quizResult(correct, quiz.map(({ q }) => !!q.critical), lesson.prove.passMark);
      setResult(r);
      await record({ kind: 'quiz', lessonId: lesson.id, score: Math.round(r.score * 100), passed: r.passed, criticalFail: r.criticalFail, answers: quiz.map(({ q }) => ({ id: q.id, chosen: answers[q.id], correct: answers[q.id] === q.answer })) });
      if (r.passed) await done((s) => ({ ...s, prove: { passed: true, bestScore: Math.max(Math.round(r.score * 100), s.prove?.bestScore ?? 0) } }), false);
      window.scrollTo({ top: 0 });
    });

  return (
    <div className="narrow-step">
      {result ? (
        <Notice kind={result.passed ? 'ok' : 'error'}>
          <p><strong>{result.passed ? 'Passed' : 'Not passed'}: {Math.round(result.score * 100)}%</strong> (pass mark {Math.round(lesson.prove.passMark * 100)}%).</p>
          {result.criticalFail && <p>You got a critical safety question wrong. That fails the test whatever the score. Read the explanations, then try again.</p>}
        </Notice>
      ) : (
        <p>{quiz.length} questions. Pass mark {Math.round(lesson.prove.passMark * 100)}%. Questions marked ⚠ are critical: getting one wrong fails the test.</p>
      )}
      <ol className="quiz">
        {quiz.map(({ q, order }, n) => {
          const chosen = answers[q.id];
          const wrong = result && chosen !== q.answer;
          return (
            <li key={q.id} className={result ? (wrong ? 'q-wrong' : 'q-right') : ''}>
              <fieldset disabled={!!result}>
                <legend>
                  <span className="qn">Q{n + 1}.</span> {q.critical && <span className="tag" title="Critical question">⚠ Critical</span>} {q.text}
                </legend>
                {order.map((oi) => (
                  <label key={oi} className={`option ${chosen === oi ? 'chosen' : ''}`}>
                    <input type="radio" name={q.id} checked={chosen === oi} onChange={() => setAnswers({ ...answers, [q.id]: oi })} />
                    <span>{q.options[oi]}</span>
                    {result && oi === q.answer && <span className="mark"> ✔ correct answer</span>}
                  </label>
                ))}
                {result && wrong && <p className="explain">✖ {q.explain}</p>}
                {result && !wrong && <p className="explain ok">✔ {q.explain}</p>}
              </fieldset>
            </li>
          );
        })}
      </ol>
      <div className="step-nav">
        {!result && <button className="primary" disabled={!allAnswered || busy} onClick={submit}>{allAnswered ? 'Submit answers' : `Answer all questions (${Object.keys(answers).length}/${quiz.length})`}</button>}
        {result && !result.passed && <button className="primary" onClick={() => { setResult(null); setAnswers({}); setSeed(newSeed()); window.scrollTo({ top: 0 }); }}>Try again</button>}
        {result?.passed && <button className="primary" onClick={() => done((s) => s)}>Next: Apply ▶</button>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ APPLY

export function ApplyStep({ lesson, progress, profileId, done }: StepProps) {
  const a = progress.steps.apply;
  const { busy, error, run } = useAction();
  return (
    <div className="narrow-step">
      <Markup text={lesson.apply.intro} />
      <Card title="Bench checklist">
        <ol className="checklist">{lesson.apply.items.map((i) => <li key={i.id}>{i.text}</li>)}</ol>
      </Card>
      {a?.status === 'signed' && <Notice kind="ok">Signed off by <strong>{a.signedBy}</strong> on {new Date(a.signedAt!).toLocaleDateString('en-GB')}.{a.note ? ` Note: ${a.note}` : ''}</Notice>}
      {a?.status === 'requested' && <Notice kind="info"><StatusChip status="awaiting" /> Your trainer will watch you do this on the bench and sign it off.</Notice>}
      {a?.status === 'redo' && <Notice kind="warn">Your trainer asked you to practise more before signing off.{a.note ? <> Note: <strong>{a.note}</strong></> : null}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {(!a || a.status === 'not-requested' || a.status === 'redo') && (
        <div className="step-nav">
          <button className="primary" disabled={busy} onClick={() => run(async () => { await requestSignOff(profileId, lesson.id); await done((s) => s, false); })}>
            I'm ready: ask my trainer for sign-off
          </button>
        </div>
      )}
    </div>
  );
}
