import { useEffect, useMemo, useRef, useState } from 'react';
import { CircuitCanvas } from '../../components/CircuitCanvas';
import { Meter, emptyProbes, placeProbe, type ProbeState } from '../../components/Meter';
import { Markup } from '../../components/Markup';
import { Modal, Notice, StatusChip } from '../../components/ui';
import { circuit as circuitById } from '../../content';
import type { Lesson } from '../../content/types';
import { Circuit } from '../../engines/wiring/circuit';
import { holds, runChecks, type Expectation } from '../../engines/wiring/checks';
import { measure } from '../../engines/wiring/meter';
import { makeRng, newSeed } from '../../engines/core/rng';
import type { FaultJson } from '../../engines/wiring/types';
import { useSim } from './useSim';
import type { StepProps } from './stepTypes';
import { breakScore } from './scoring';

type ShowC = Extract<Lesson['show'], { kind: 'circuit' }>;
type BuildC = Extract<Lesson['build'], { kind: 'circuit' }>;
type BreakC = Extract<Lesson['break'], { kind: 'circuit' }>;

function EventLog({ circuit }: { circuit: Circuit }) {
  const items = circuit.log.slice(-6).reverse();
  return (
    <div className="eventlog" aria-label="Event log">
      <h3>Event log</h3>
      <ol>
        {items.map((e, i) => (
          <li key={`${e.t}-${i}`}><span className="t">{(e.t / 1000).toFixed(1)} s</span> {e.text}</li>
        ))}
        {!items.length && <li className="hint">Nothing yet.</li>}
      </ol>
    </div>
  );
}

// ------------------------------------------------------------------ SHOW

export function ShowCircuitStep({ lesson, done }: StepProps) {
  const show = lesson.show as ShowC;
  const def = circuitById(show.circuit);
  const sim = useSim(() => new Circuit(def), [def]);
  const [probes, setProbes] = useState<ProbeState>(emptyProbes);
  const [doneIdx, setDoneIdx] = useState(0);

  useEffect(() => {
    const task = show.tasks[doneIdx];
    if (!task) return;
    let ok = true;
    if (task.when) ok = task.when.every((e) => holds(sim.circuit, e as Expectation));
    if (task.measure) {
      const m = task.measure;
      const onPair = (probes.red === m.a && probes.black === m.b) || (probes.red === m.b && probes.black === m.a);
      ok = ok && onPair && probes.mode === m.mode;
    }
    if (ok) setDoneIdx(doneIdx + 1);
  }, [sim.version, probes, doneIdx, show.tasks, sim.circuit]);

  const finished = doneIdx >= show.tasks.length;
  return (
    <div>
      <Markup text={show.intro} />
      <div className="lab">
        <div className="lab-main">
          <CircuitCanvas circuit={sim.circuit} version={sim.version} onCommand={(c) => sim.apply((x) => x.command(c))} onTerminal={(r) => setProbes(placeProbe(probes, r))} probes={probes} showLive />
          <div className="actions"><button onClick={sim.reset}>Reset circuit</button></div>
        </div>
        <aside className="lab-side">
          <h3>Tasks</h3>
          <ol className="tasks">
            {show.tasks.map((t, i) => (
              <li key={t.id} className={i < doneIdx ? 'done' : i === doneIdx ? 'current' : ''}>
                <StatusChip status={i < doneIdx ? 'passed' : i === doneIdx ? 'progress' : 'open'} label={i < doneIdx ? 'Done' : i === doneIdx ? 'Now' : 'Next'} /> {t.text}
              </li>
            ))}
          </ol>
          <Meter circuit={sim.circuit} probes={probes} onChange={setProbes} version={sim.version} />
          <EventLog circuit={sim.circuit} />
        </aside>
      </div>
      <div className="step-nav">
        <button className="primary" disabled={!finished} onClick={() => done((s) => ({ ...s, show: true }))}>{finished ? 'Next: Build ▶' : `Finish the tasks (${doneIdx}/${show.tasks.length})`}</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ BUILD

export function BuildCircuitStep({ lesson, progress, done, record }: StepProps) {
  const build = lesson.build as BuildC;
  const def = circuitById(build.circuit);
  const guided = !progress.steps.buildGuided;
  const remove = guided ? build.guided.removeWires : build.unguided.removeWires;
  const sim = useSim(() => new Circuit(def, [], def.wires.filter((w) => !remove.includes(w.id))), [def, guided]);
  const [tool, setTool] = useState<'wire' | 'meter'>('wire');
  const [sel, setSel] = useState<string | null>(null);
  const [selWire, setSelWire] = useState<string | null>(null);
  const [probes, setProbes] = useState<ProbeState>(emptyProbes);
  const [hints, setHints] = useState(0);
  const [result, setResult] = useState<{ passed: boolean; text: string } | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  const onTerminal = (ref: string) => {
    setResult(null);
    if (tool === 'meter') {
      const next = placeProbe(probes, ref);
      setProbes(next);
      if (next.red && next.black && measure(sim.circuit, next.red, next.black, next.mode).unsafe) setWarn('Safety: you tried a resistance (Ω) test on a live circuit. On the real bench, switch off and prove dead first.');
      return;
    }
    if (!sel) return setSel(ref);
    if (sel === ref) return setSel(null);
    sim.apply((c) => c.addWire(sel, ref));
    setSel(null);
  };

  const check = async () => {
    const r = runChecks(def, sim.circuit.wires, build.checks);
    await record({ kind: 'build', lessonId: lesson.id, mode: guided ? 'guided' : 'unguided', passed: r.passed, failure: r.failures[0] ?? null, wires: sim.circuit.wires.length });
    setResult(r.passed ? { passed: true, text: `All ${r.total} checks passed. The starter works correctly.` } : { passed: false, text: r.failures[0] });
  };

  return (
    <div>
      <p><StatusChip status="progress" label={guided ? 'Part 1 of 2: guided' : 'Part 2 of 2: on your own'} /></p>
      <Markup text={guided ? build.guided.intro : build.unguided.intro} />
      <div className="lab">
        <div className="lab-main">
          <div className="seg tool-seg" role="group" aria-label="Tool">
            <button type="button" aria-pressed={tool === 'wire'} className={tool === 'wire' ? 'on' : ''} onClick={() => setTool('wire')}>✎ Wire</button>
            <button type="button" aria-pressed={tool === 'meter'} className={tool === 'meter' ? 'on' : ''} onClick={() => { setTool('meter'); setSel(null); }}>⎓ Meter</button>
          </div>
          <CircuitCanvas
            circuit={sim.circuit}
            version={sim.version}
            onTerminal={onTerminal}
            selectedTerminal={tool === 'wire' ? sel : null}
            probes={tool === 'meter' ? probes : undefined}
            selectedWire={selWire}
            onWire={tool === 'wire' ? (id) => setSelWire(id === selWire ? null : id) : undefined}
            onCommand={(c) => sim.apply((x) => x.command(c))}
          />
          <div className="actions">
            {selWire && <button className="danger" onClick={() => { sim.apply((c) => c.removeWire(selWire)); setSelWire(null); }}>Delete selected wire</button>}
            <button onClick={sim.reset}>Start again</button>
            <button className="primary" onClick={check}>Check my wiring</button>
          </div>
          {tool === 'wire' && <p className="hint">{sel ? `From ${sel}: tap the terminal to wire to.` : 'Tap a terminal to start a wire.'}</p>}
        </div>
        <aside className="lab-side">
          {result && <Notice kind={result.passed ? 'ok' : 'error'}>{result.text}</Notice>}
          {warn && <Notice kind="warn">{warn}</Notice>}
          {guided && (
            <>
              <h3>Hints</h3>
              <ol className="hints">{build.guided.hints.slice(0, hints).map((h) => <li key={h}><Markup text={h} /></li>)}</ol>
              {hints < build.guided.hints.length && <button onClick={() => setHints(hints + 1)}>Show hint {hints + 1} of {build.guided.hints.length}</button>}
            </>
          )}
          {tool === 'meter' && <Meter circuit={sim.circuit} probes={probes} onChange={setProbes} version={sim.version} />}
          <EventLog circuit={sim.circuit} />
        </aside>
      </div>
      <div className="step-nav">
        {result?.passed && guided && <button className="primary" onClick={() => { setResult(null); setHints(0); void done((s) => ({ ...s, buildGuided: true }), false); }}>Next: wire it on your own ▶</button>}
        {result?.passed && !guided && <button className="primary" onClick={() => done((s) => ({ ...s, build: true }))}>Next: Break ▶</button>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ BREAK

export function BreakCircuitStep({ lesson, done, record, recordSession, lastFaultId }: StepProps) {
  const br = lesson.break as BreakC;
  const def = circuitById(br.circuit);
  const pickRun = (exclude?: string | null) => {
    const seed = newSeed();
    const pool = br.faults.length > 1 ? br.faults.filter((f) => f.id !== exclude) : br.faults;
    return { seed, fault: makeRng(seed).pick(pool) as FaultJson };
  };
  // Chosen once per attempt, so later progress updates never swap the fault mid-attempt.
  const [run, setRun] = useState(() => pickRun(lastFaultId));
  const { seed, fault } = run;
  const sim = useSim(() => new Circuit(def, [fault]), [def, fault]);
  const [probes, setProbes] = useState<ProbeState>(emptyProbes);
  const measurements = useRef<{ red: string; black: string; mode: string; display: string; unsafe: boolean }[]>([]);
  const [unsafe, setUnsafe] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [outcome, setOutcome] = useState<null | { passed: boolean; score: number; chosen: string }>(null);
  const started = useRef(Date.now());
  const reports = useMemo(() => makeRng(seed + 1).shuffle([...br.faults.map((f) => f.report), ...br.extraReports]), [seed, br]);

  const onTerminal = (ref: string) => {
    const next = placeProbe(probes, ref);
    setProbes(next);
    if (next.red && next.black) {
      const r = measure(sim.circuit, next.red, next.black, next.mode);
      measurements.current.push({ red: next.red, black: next.black, mode: next.mode, display: r.display, unsafe: r.unsafe });
      if (r.unsafe) setUnsafe(true);
    }
  };

  const submit = async (chosen: string) => {
    setChoosing(false);
    const seconds = Math.round((Date.now() - started.current) / 1000);
    const correct = chosen === fault.report;
    const passed = correct && !unsafe;
    const score = passed ? breakScore(measurements.current.length, br.parMeasurements, seconds, br.parSeconds) : 0;
    const attempt = await record({ kind: 'break', lessonId: lesson.id, faultId: fault.id, passed, score, critical: unsafe, measurements: measurements.current.length, seconds, chosen });
    await recordSession({ attemptId: attempt.id, lessonId: lesson.id, faultId: fault.id, seed, measurements: measurements.current, safetyEvents: unsafe ? ['Resistance test on a live circuit'] : [], result: passed ? 'found' : 'not-found', log: sim.circuit.log.slice(-40) });
    setOutcome({ passed, score, chosen });
    if (passed) await done((s) => ({ ...s, break: { passed: true, bestScore: Math.max(score, s.break?.bestScore ?? 0) } }), false);
  };

  const again = () => {
    setOutcome(null);
    setUnsafe(false);
    setProbes(emptyProbes);
    measurements.current = [];
    started.current = Date.now();
    setRun(pickRun(fault.id));
  };

  if (outcome) {
    return (
      <div className="narrow-step">
        {outcome.passed ? (
          <Notice kind="ok"><p><strong>Found it.</strong> Score {outcome.score}%: {measurements.current.length} measurement(s).</p><p>{fault.report}</p></Notice>
        ) : (
          <Notice kind="error">
            <p><strong>{unsafe ? 'Failed: critical safety error.' : 'Not the fault.'}</strong></p>
            {unsafe && <p>You made a resistance test on a live circuit. On a real panel this can destroy the meter and cause an arc flash. Always isolate and prove dead before an Ω test.</p>}
            <p>You chose: {outcome.chosen}</p>
            <p>The fault was: {fault.report}</p>
          </Notice>
        )}
        <div className="step-nav">
          <button onClick={again}>Try another fault</button>
          {outcome.passed && <button className="primary" onClick={() => done((s) => s)}>Next: Prove ▶</button>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <Markup text={br.intro} />
      {unsafe && <Notice kind="error">Critical safety error: resistance test on a live circuit. This attempt will fail. Switch off Q1 before any Ω test.</Notice>}
      <div className="lab">
        <div className="lab-main">
          <CircuitCanvas circuit={sim.circuit} version={sim.version} onCommand={(c) => sim.apply((x) => x.command(c))} onTerminal={onTerminal} probes={probes} />
          <div className="actions">
            <button className="primary" onClick={() => setChoosing(true)}>I found the fault…</button>
          </div>
        </div>
        <aside className="lab-side">
          <Meter circuit={sim.circuit} probes={probes} onChange={setProbes} version={sim.version} />
          <p className="hint">Measurements: {measurements.current.length} (target {br.parMeasurements} or fewer)</p>
          <EventLog circuit={sim.circuit} />
        </aside>
      </div>
      {choosing && (
        <Modal title="What is the fault?" onClose={() => setChoosing(false)}>
          <div className="choices">
            {reports.map((r) => <button key={r} type="button" className="choice" onClick={() => void submit(r)}>{r}</button>)}
          </div>
          <div className="actions"><button onClick={() => setChoosing(false)}>Keep looking</button></div>
        </Modal>
      )}
    </div>
  );
}
