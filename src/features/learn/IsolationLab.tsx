import { useEffect, useMemo, useRef, useState } from 'react';
import { CircuitCanvas } from '../../components/CircuitCanvas';
import { Modal, Notice } from '../../components/ui';
import { circuit as circuitById } from '../../content';
import type { Lesson } from '../../content/types';
import { IsolationSession, short, type Evaluation, type IsolationScenario } from '../../engines/safety/isolation';
import type { Command, FaultJson } from '../../engines/wiring/types';
import { makeRng } from '../../engines/core/rng';

type ShowLesson = Extract<Lesson['show'], { kind: 'isolation' }>;

export interface IsolationResult {
  evaluation: Evaluation | null;
  report: string | null;
  tests: number;
  seconds: number;
  events: unknown[];
}

interface Props {
  scenario: IsolationScenario;
  mode: 'demo' | 'guided' | 'unguided' | 'break';
  faults?: FaultJson[];
  demo?: ShowLesson['demo'];
  reports?: string[];
  seed?: number;
  onFinish: (r: IsolationResult) => void;
}

const NONE: never[] = [];

export function IsolationLab({ scenario, mode, faults = NONE, demo = NONE, reports = NONE, seed = 1, onFinish }: Props) {
  const session = useMemo(() => new IsolationSession(circuitById(scenario.circuit), scenario, faults), [scenario, faults]);
  const [, setV] = useState(0);
  const bump = () => setV((v) => v + 1);
  const [a, setA] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'info' | 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [demoIdx, setDemoIdx] = useState(0);
  const [reporting, setReporting] = useState<null | 'declare' | 'report'>(null);
  const [pendingEval, setPendingEval] = useState<Evaluation | null>(null);
  const started = useRef(Date.now());
  const tests = session.events.filter((e) => e.kind === 'test') as { kind: 'test'; a: string; b: string; volts: number }[];
  const shuffledReports = useMemo(() => makeRng(seed + 7).shuffle(reports), [reports, seed]);

  // Let motors coast down visibly.
  useEffect(() => {
    const id = window.setInterval(() => {
      for (let i = 0; i < 5; i++) session.circuit.step(10);
      bump();
    }, 100);
    return () => window.clearInterval(id);
  }, [session]);

  const finish = (evaluation: Evaluation | null, report: string | null) =>
    onFinish({ evaluation, report, tests: tests.length, seconds: Math.round((Date.now() - started.current) / 1000), events: session.events });

  const onCommand = (c: Command) => {
    if (c.kind === 'switch') session.switchIsolator(c.part, c.on);
    else if (c.kind === 'lock') session.lock(c.part);
    else if (c.kind === 'unlock') session.unlock(c.part);
    const last = session.circuit.log[session.circuit.log.length - 1];
    if (last) setMessage({ kind: 'info', text: last.text });
    bump();
  };

  const onTerminal = (ref: string) => {
    if (!a) {
      setA(ref);
      setMessage({ kind: 'info', text: `Probe 1 on ${ref}. Tap the second test point.` });
      return;
    }
    if (a === ref) {
      setA(null);
      return;
    }
    const r = session.test(a, ref);
    setMessage({ kind: r.volts > 0 ? 'warn' : 'info', text: `Test ${short(a)} to ${short(ref)}: ${r.display}` });
    setA(null);
    bump();
  };

  const prove = () => {
    const r = session.prove();
    setMessage({ kind: r.ok ? 'ok' : 'error', text: r.display });
    bump();
  };

  const runDemo = () => {
    const step = demo[demoIdx];
    if (!step) return;
    const act = step.action;
    let text = step.say;
    if ('switch' in act) session.switchIsolator(act.switch.part, act.switch.on);
    else if ('lock' in act) session.lock(act.lock);
    else if ('prove' in act) text += ` → ${session.prove().display}`;
    else if ('test' in act) text += ` → ${session.test(act.test[0], act.test[1]).display}`;
    else if ('declare' in act) {
      const e = session.declareDead();
      text += e.passed ? ' → Procedure complete.' : ` → ${e.problems.map((p) => p.text).join(' ')}`;
    }
    setMessage({ kind: 'info', text });
    setDemoIdx(demoIdx + 1);
    bump();
  };

  const declare = () => {
    const e = session.declareDead();
    if (mode === 'break' && e.passed) {
      setPendingEval(e);
      setReporting('declare');
      return;
    }
    finish(e, null);
  };

  const interactive = mode !== 'demo';

  return (
    <div className="lab">
      <div className="lab-main">
        <p className="job-card">
          <strong>Job card:</strong> replace terminal box gasket on <strong>{scenario.jobTag}</strong>. Point of work: motor {scenario.target} terminal box.
        </p>
        <CircuitCanvas
          circuit={session.circuit}
          version={0}
          onCommand={interactive ? onCommand : undefined}
          controlsEnabled={interactive}
          onTerminal={interactive ? onTerminal : undefined}
          selectedTerminal={a}
        />
      </div>
      <aside className="lab-side">
        {mode === 'guided' && <Notice kind="info"><strong>Next:</strong> {session.nextHint()}</Notice>}
        {message && <Notice kind={message.kind}>{message.text}</Notice>}

        {mode === 'demo' ? (
          <div className="actions">
            {demoIdx < demo.length ? (
              <button className="primary" onClick={runDemo}>Do next step ({demoIdx + 1} of {demo.length})</button>
            ) : (
              <button className="primary" onClick={() => finish(null, null)}>Demonstration complete: continue</button>
            )}
          </div>
        ) : (
          <>
            <h3>Voltage indicator</h3>
            <p className="hint">Tap one test point, then another, to test between them.</p>
            <div className="actions">
              <button onClick={prove}>Prove tester on proving unit</button>
              <button onClick={() => { session.replaceTester(); setMessage({ kind: 'info', text: 'You fetched a different, known-good voltage indicator. Prove it before use.' }); bump(); }}>Get a replacement tester</button>
            </div>
            <h3>Tests at the point of work ({tests.length})</h3>
            <ol className="tests">
              {tests.slice(-8).map((t, i) => (
                <li key={i} className={t.volts > 0 ? 'live' : ''}>{short(t.a)}–{short(t.b)}: {t.volts > 0 ? `⚠ ${t.volts} V` : 'no indication'}</li>
              ))}
            </ol>
            <div className="actions">
              <button className="primary" onClick={declare}>Declare dead: safe to work</button>
              {mode === 'break' && <button className="danger" onClick={() => setReporting('report')}>Stop and report a problem…</button>}
            </div>
          </>
        )}
      </aside>

      {reporting && (
        <Modal title={reporting === 'declare' ? 'Before you start: what was wrong on this job?' : 'What problem did you find?'} onClose={() => { setReporting(null); setPendingEval(null); }}>
          <div className="choices" role="radiogroup">
            {shuffledReports.map((r) => (
              <button key={r} type="button" className="choice" onClick={() => { setReporting(null); finish(pendingEval, r); }}>{r}</button>
            ))}
          </div>
          <div className="actions"><button type="button" onClick={() => { setReporting(null); setPendingEval(null); }}>Cancel</button></div>
        </Modal>
      )}
    </div>
  );
}
