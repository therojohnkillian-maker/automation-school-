import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { circuit as circuitById, moduleById, templateById } from '../../content';
import type { Template, TestRow } from '../../content/types';
import { useSession } from '../../app/session';
import { CircuitCanvas } from '../../components/CircuitCanvas';
import { Markup } from '../../components/Markup';
import { Meter, emptyProbes, placeProbe, type ProbeState } from '../../components/Meter';
import { Card, Modal, Notice, StatusChip } from '../../components/ui';
import { Circuit } from '../../engines/wiring/circuit';
import { measure } from '../../engines/wiring/meter';
import { makeRng, newSeed } from '../../engines/core/rng';
import type { FaultJson } from '../../engines/wiring/types';
import { allProgress, appPassed, recordAttempt } from '../../data/progress';
import { useSim } from '../learn/useSim';
import { EventLog } from '../learn/CircuitSteps';
import { breakScore } from '../learn/scoring';

type Tab = 'brief' | 'run' | 'io' | 'logic' | 'schedule' | 'test' | 'break' | 'answer';
const TABS: [Tab, string][] = [
  ['brief', 'Brief'],
  ['run', 'Schematic'],
  ['io', 'I/O list'],
  ['logic', 'Logic'],
  ['schedule', 'Schedule'],
  ['test', 'Test sheet'],
  ['break', 'Break it'],
  ['answer', 'Model answer'],
];

export function TemplatePage() {
  const { templateId = '' } = useParams();
  const t = templateById(templateId);
  const profile = useSession((s) => s.profile)!;
  const [tab, setTab] = useState<Tab>('brief');
  const [safe, setSafe] = useState<boolean | null>(null);
  useEffect(() => void allProgress(profile.id).then((all) => setSafe(appPassed(all.find((p) => p.lessonId === 'm0-l1')?.steps))), [profile.id]);
  if (!t) return <Navigate to="/templates" replace />;
  if (safe === null) return <main><p>Loading…</p></main>;
  if (!safe) return <Navigate to="/templates" replace />;
  const mod = moduleById(t.moduleId);
  return (
    <main className="lesson">
      <p className="crumbs"><Link to="/templates">Templates</Link> › {mod?.code}</p>
      <h1>T{t.number} · {t.title}</h1>
      <div className="tabs" role="tablist" aria-label="Template sections">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <div role="tabpanel" key={tab}>
        {tab === 'brief' && <div className="narrow-step"><Markup text={t.brief} /></div>}
        {tab === 'run' && <RunTab t={t} />}
        {tab === 'io' && <Table head={['Tag', 'Description', 'Type', 'Range', 'Connection']} rows={t.ioList.map((r) => [r.tag, r.description, r.type, r.range, r.connection])} />}
        {tab === 'logic' && (
          <>
            <Table head={['Function', 'When', 'What happens']} rows={t.logic.map((r) => [r.function, r.condition, r.action])} />
            {t.logicNote && <Notice kind="info"><Markup text={t.logicNote} /></Notice>}
          </>
        )}
        {tab === 'schedule' && (
          <>
            <Table head={['#', 'Job step', 'Who', 'Hours']} rows={t.schedule.map((r, i) => [String(i + 1), r.step, r.who, String(r.hours)])} />
            <p><strong>Total:</strong> {t.schedule.reduce((s, r) => s + r.hours, 0)} hours.</p>
          </>
        )}
        {tab === 'test' && <TestTab t={t} profileId={profile.id} />}
        {tab === 'break' && <BreakTab t={t} profileId={profile.id} />}
        {tab === 'answer' && <AnswerTab t={t} />}
      </div>
    </main>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="table-scroll">
      <table className="matrix">
        <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Lab({ circuit, version, onCommand, probes, setProbes, onTerminal, children }: {
  circuit: Circuit; version: number; onCommand: (c: Parameters<Circuit['command']>[0]) => void; probes: ProbeState; setProbes: (p: ProbeState) => void; onTerminal: (r: string) => void; children?: React.ReactNode;
}) {
  return (
    <div className="lab">
      <div className="lab-main"><CircuitCanvas circuit={circuit} version={version} onCommand={onCommand} onTerminal={onTerminal} probes={probes} /></div>
      <aside className="lab-side">
        {children}
        <Meter circuit={circuit} probes={probes} onChange={setProbes} version={version} />
        <EventLog circuit={circuit} />
      </aside>
    </div>
  );
}

function RunTab({ t }: { t: Template }) {
  const def = circuitById(t.circuit);
  const sim = useSim(() => new Circuit(def), [def]);
  const [probes, setProbes] = useState<ProbeState>(emptyProbes);
  return (
    <>
      <Markup text={t.schematicIntro} />
      <Lab circuit={sim.circuit} version={sim.version} onCommand={(c) => sim.apply((x) => x.command(c))} probes={probes} setProbes={setProbes} onTerminal={(r) => setProbes(placeProbe(probes, r))} />
      <div className="actions"><button onClick={sim.reset}>Reset circuit</button></div>
    </>
  );
}

/** The value a test-sheet row should read, from the simulator after its setup. */
export function expectedRow(t: Template, row: TestRow): number | boolean {
  const c = new Circuit(circuitById(t.circuit));
  // A person doing the test takes a moment between actions: let 200 ms pass after each one.
  for (const cmd of row.setup) {
    c.command(cmd);
    for (let ms = 0; ms < 200; ms += 10) c.step(10);
  }
  for (let ms = 0; ms < row.wait; ms += 10) c.step(10);
  const st = c.status(row.part);
  if (row.field === 'lit') return !!st.lit;
  if (row.field === 'energised') return !!st.energised;
  if (row.field === 'amps') return st.motor?.amps ?? 0;
  if (row.field === 'rpm') return Math.abs(st.motor?.rpm ?? 0);
  if (row.field === 'vac') return Math.round(c.voltage(row.a ?? '', row.b ?? '').ac);
  return row.field === 'mA' ? st.mA ?? 0 : st.eng ?? 0;
}

/** How far a typed test-sheet value may be from the simulator's value. */
export function rowTolerance(row: TestRow, expected: number, engSpan: number): number {
  switch (row.field) {
    case 'mA':
      return 0.1;
    case 'amps':
      return Math.max(expected * 0.03, 0.2);
    case 'rpm':
      return 10;
    case 'vac':
      return Math.max(expected * 0.02, 2);
    default:
      return engSpan * 0.01;
  }
}

function TestTab({ t, profileId }: { t: Template; profileId: string }) {
  const def = circuitById(t.circuit);
  const sim = useSim(() => new Circuit(def), [def]);
  const [probes, setProbes] = useState<ProbeState>(emptyProbes);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [res, setRes] = useState<Record<string, boolean>>({});
  const span = useMemo(() => {
    const ai = def.parts.find((p) => p.type === 'ai');
    return (ai?.params?.rangeHi ?? 100) - (ai?.params?.rangeLo ?? 0);
  }, [def]);
  const check = async (row: TestRow) => {
    const exp = expectedRow(t, row);
    const v = typed[row.id] ?? '';
    let ok: boolean;
    if (typeof exp === 'boolean') ok = (v === 'yes') === exp && v !== '';
    else {
      const n = Number(v.replace(',', '.'));
      ok = v.trim() !== '' && !Number.isNaN(n) && Math.abs(n - exp) <= rowTolerance(row, exp, span);
    }
    setRes({ ...res, [row.id]: ok });
    await recordAttempt(profileId, { kind: 'template-test', templateId: t.id, lessonId: null, row: row.id, passed: ok });
  };
  const done = t.testSheet.every((r) => res[r.id]);
  return (
    <>
      <Markup text={t.testIntro} />
      {done && <Notice kind="ok">Test sheet complete: every result is within tolerance.</Notice>}
      <Lab circuit={sim.circuit} version={sim.version} onCommand={(c) => sim.apply((x) => x.command(c))} probes={probes} setProbes={setProbes} onTerminal={(r) => setProbes(placeProbe(probes, r))}>
        <h3>Test sheet</h3>
        <ol className="readings">
          {t.testSheet.map((row) => (
            <li key={row.id} className={res[row.id] ? 'done' : ''}>
              <label htmlFor={`ts-${row.id}`}>{row.text}</label>
              <div className="reading-row">
                {row.field === 'lit' || row.field === 'energised' ? (
                  <select id={`ts-${row.id}`} value={typed[row.id] ?? ''} disabled={res[row.id]} onChange={(e) => setTyped({ ...typed, [row.id]: e.target.value })}>
                    <option value="">Choose…</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                ) : (
                  <>
                    <input id={`ts-${row.id}`} inputMode="decimal" value={typed[row.id] ?? ''} disabled={res[row.id]} onChange={(e) => setTyped({ ...typed, [row.id]: e.target.value })} />
                    <span className="unit">{row.unit}</span>
                  </>
                )}
                {res[row.id] ? <StatusChip status="passed" label="Pass" /> : <button type="button" onClick={() => void check(row)}>Check</button>}
              </div>
              {res[row.id] === false && <p className="explain">✖ Outside tolerance. Set up the test exactly as written, then read again.</p>}
            </li>
          ))}
        </ol>
      </Lab>
    </>
  );
}

function BreakTab({ t, profileId }: { t: Template; profileId: string }) {
  const def = circuitById(t.circuit);
  const pick = (exclude?: string) => {
    const seed = newSeed();
    const pool = t.faults.filter((f) => f.id !== exclude);
    return { seed, fault: makeRng(seed).pick(pool.length ? pool : t.faults) as FaultJson };
  };
  const [run, setRun] = useState(() => pick());
  const sim = useSim(() => new Circuit(def, [run.fault]), [def, run]);
  const [probes, setProbes] = useState<ProbeState>(emptyProbes);
  const count = useRef(0);
  const started = useRef(Date.now());
  const [unsafe, setUnsafe] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [outcome, setOutcome] = useState<null | { passed: boolean; score: number }>(null);
  const reports = useMemo(() => makeRng(run.seed + 1).shuffle([...t.faults.map((f) => f.report), ...t.extraReports]), [run, t]);

  const onTerminal = (ref: string) => {
    const next = placeProbe(probes, ref);
    setProbes(next);
    if (next.red && next.black) {
      count.current++;
      if (measure(sim.circuit, next.red, next.black, next.mode).unsafe) setUnsafe(true);
    }
  };
  const submit = async (chosen: string) => {
    setChoosing(false);
    const seconds = Math.round((Date.now() - started.current) / 1000);
    const passed = chosen === run.fault.report && !unsafe;
    const score = passed ? breakScore(count.current, 5, seconds, 300) : 0;
    await recordAttempt(profileId, { kind: 'template-break', templateId: t.id, lessonId: null, faultId: run.fault.id, passed, score, critical: unsafe, measurements: count.current, seconds });
    setOutcome({ passed, score });
  };
  const again = () => {
    setOutcome(null);
    setUnsafe(false);
    setProbes(emptyProbes);
    count.current = 0;
    started.current = Date.now();
    setRun(pick(run.fault.id));
  };

  if (outcome) {
    return (
      <div className="narrow-step">
        <Notice kind={outcome.passed ? 'ok' : 'error'}>
          <p><strong>{outcome.passed ? `Found it. Score ${outcome.score}%.` : unsafe ? 'Failed: resistance test on a live circuit.' : 'Not the fault.'}</strong></p>
          <p>The fault was: {run.fault.report}</p>
        </Notice>
        <div className="step-nav"><button className="primary" onClick={again}>Try another fault</button></div>
      </div>
    );
  }
  return (
    <>
      <p>One hidden fault has been put into this template. Operate it, measure, and choose the cause.</p>
      {unsafe && <Notice kind="error">Critical safety error: resistance test on a live circuit. This attempt will fail.</Notice>}
      <Lab circuit={sim.circuit} version={sim.version} onCommand={(c) => sim.apply((x) => x.command(c))} probes={probes} setProbes={setProbes} onTerminal={onTerminal}>
        <div className="actions"><button className="primary" onClick={() => setChoosing(true)}>I found the fault…</button></div>
        <p className="hint">Measurements: {count.current}</p>
      </Lab>
      {choosing && (
        <Modal title="What is the fault?" onClose={() => setChoosing(false)}>
          <div className="choices">{reports.map((r) => <button key={r} type="button" className="choice" onClick={() => void submit(r)}>{r}</button>)}</div>
          <div className="actions"><button onClick={() => setChoosing(false)}>Keep looking</button></div>
        </Modal>
      )}
    </>
  );
}

function AnswerTab({ t }: { t: Template }) {
  const [shown, setShown] = useState(false);
  if (!shown) {
    return (
      <div className="narrow-step">
        <p>Try the test sheet and at least one fault first. The model answer gives every expected reading and how each fault shows itself.</p>
        <button className="primary" onClick={() => setShown(true)}>Show the model answer</button>
      </div>
    );
  }
  return (
    <div className="narrow-step">
      <Card title="Expected test sheet">
        <Table head={['Test', 'Expected']} rows={t.testSheet.map((r) => {
          const e = expectedRow(t, r);
          return [r.text, typeof e === 'boolean' ? (e ? 'Yes' : 'No') : `${e} ${r.unit}`];
        })} />
      </Card>
      <Markup text={t.modelAnswer} />
    </div>
  );
}
