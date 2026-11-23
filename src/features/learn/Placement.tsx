import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { lessonById, moduleById } from '../../content';
import type { Question } from '../../content/types';
import { useSession } from '../../app/session';
import { Notice, useAction } from '../../components/ui';
import { allProgress, lessonStatus, placeOut, recordAttempt } from '../../data/progress';
import { makeRng, newSeed } from '../../engines/core/rng';
import { quizResult } from './scoring';

const COUNT = 12;

/**
 * Placement test: questions drawn from every lesson in the module. Pass mark 80% with no critical question wrong.
 * Passing marks the module's lessons as placed out. Practical sign-off is still needed. M0 has no placement test.
 */
export function Placement() {
  const { moduleId = '' } = useParams();
  const profile = useSession((s) => s.profile)!;
  const mod = moduleById(moduleId);
  const [seed, setSeed] = useState(() => newSeed());
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ReturnType<typeof quizResult> | null>(null);
  const [locked, setLocked] = useState<boolean | null>(null);
  const { busy, run } = useAction();

  useEffect(() => {
    if (!mod) return;
    void allProgress(profile.id).then((all) => setLocked(mod.lessons.some((id) => lessonStatus(id, all) === 'locked')));
  }, [mod, profile.id]);

  const quiz = useMemo(() => {
    if (!mod) return [];
    const pool: (Question & { key: string })[] = mod.lessons.flatMap((id) => (lessonById(id)?.prove.questions ?? []).map((q) => ({ ...q, key: `${id}.${q.id}` })));
    const rng = makeRng(seed);
    // Always include every critical question, then fill with others.
    const crit = pool.filter((q) => q.critical);
    const rest = rng.shuffle(pool.filter((q) => !q.critical)).slice(0, Math.max(0, COUNT - crit.length));
    return rng.shuffle([...crit, ...rest]).map((q) => ({ q, order: rng.shuffle(q.options.map((_, i) => i)) }));
  }, [mod, seed]);

  if (!mod || !mod.placement) return <Navigate to="/learn" replace />;
  if (locked === null) return <main><p>Loading…</p></main>;
  if (locked) {
    return (
      <main className="narrow-step">
        <h1>{mod.code} placement test</h1>
        <Notice kind="info">🔒 Pass M0 Safety first. Nobody skips safety.</Notice>
        <Link to="/learn">Back to lessons</Link>
      </main>
    );
  }

  const all = quiz.every(({ q }) => answers[q.key] !== undefined);
  const submit = () =>
    run(async () => {
      const correct = quiz.map(({ q }) => answers[q.key] === q.answer);
      const r = quizResult(correct, quiz.map(({ q }) => !!q.critical), 0.8);
      setResult(r);
      await recordAttempt(profile.id, { kind: 'placement', moduleId: mod.id, lessonId: null, score: Math.round(r.score * 100), passed: r.passed, criticalFail: r.criticalFail });
      if (r.passed) await placeOut(profile.id, mod.lessons);
      window.scrollTo({ top: 0 });
    });

  return (
    <main className="narrow-step">
      <p className="crumbs"><Link to="/learn">Learn</Link> › {mod.code} {mod.title}</p>
      <h1>{mod.code} placement test</h1>
      {result ? (
        <Notice kind={result.passed ? 'ok' : 'error'}>
          <p><strong>{result.passed ? 'Passed' : 'Not passed'}: {Math.round(result.score * 100)}%</strong> (pass mark 80%).</p>
          {result.passed ? (
            <p>The lessons in {mod.code} are marked as placed out. You can still open any of them to review. Ask your trainer to sign off the practical (Apply) for each one.</p>
          ) : (
            <p>{result.criticalFail ? 'A critical safety question was wrong. ' : ''}No problem: work through the lessons instead. Explanations are below.</p>
          )}
        </Notice>
      ) : (
        <p>{quiz.length} questions from every lesson in this module. Pass with 80% and no ⚠ critical question wrong, and you can skip the lessons. Practical sign-off is still needed.</p>
      )}
      <ol className="quiz">
        {quiz.map(({ q, order }, n) => {
          const chosen = answers[q.key];
          const wrong = result && chosen !== q.answer;
          return (
            <li key={q.key} className={result ? (wrong ? 'q-wrong' : 'q-right') : ''}>
              <fieldset disabled={!!result}>
                <legend><span className="qn">Q{n + 1}.</span> {q.critical && <span className="tag">⚠ Critical</span>} {q.text}</legend>
                {order.map((oi) => (
                  <label key={oi} className={`option ${chosen === oi ? 'chosen' : ''}`}>
                    <input type="radio" name={q.key} checked={chosen === oi} onChange={() => setAnswers({ ...answers, [q.key]: oi })} />
                    <span>{q.options[oi]}</span>
                    {result && oi === q.answer && <span className="mark"> ✔ correct answer</span>}
                  </label>
                ))}
                {result && wrong && <p className="explain">✖ {q.explain}</p>}
              </fieldset>
            </li>
          );
        })}
      </ol>
      <div className="step-nav">
        {!result && <button className="primary" disabled={!all || busy} onClick={submit}>{all ? 'Submit answers' : `Answer all questions (${Object.keys(answers).length}/${quiz.length})`}</button>}
        {result && !result.passed && <button onClick={() => { setResult(null); setAnswers({}); setSeed(newSeed()); }}>Try again</button>}
        {result && <Link className="button primary" to="/learn">Back to lessons</Link>}
      </div>
    </main>
  );
}
