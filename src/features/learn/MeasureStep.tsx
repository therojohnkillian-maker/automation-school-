import { useMemo, useState } from 'react';
import { CircuitCanvas } from '../../components/CircuitCanvas';
import { Meter, emptyProbes, placeProbe, type ProbeState } from '../../components/Meter';
import { Markup } from '../../components/Markup';
import { Notice, StatusChip } from '../../components/ui';
import { circuit as circuitById } from '../../content';
import type { Lesson, MeasureTask } from '../../content/types';
import { Circuit } from '../../engines/wiring/circuit';
import { measure, measureValue, readingMatches } from '../../engines/wiring/meter';
import { useSim } from './useSim';
import type { StepProps } from './stepTypes';

type BuildM = Extract<Lesson['build'], { kind: 'measure' }>;
const MODE_LABEL = { VAC: 'V~', VDC: 'V=', OHM: 'Ω', IR: 'MΩ (IR 500 V)' } as const;

/** The value the simulator gives for a task, after its setup, starting from the circuit as drawn. */
export function expectedFor(circuitId: string, task: MeasureTask): number | null {
  const c = new Circuit(circuitById(circuitId));
  for (const cmd of task.setup) c.command(cmd);
  const v = measureValue(c, task.a, task.b, task.mode);
  return v === 'unsafe' ? null : v;
}

/** Build step for measurement lessons: the learner measures and types each reading. */
export function BuildMeasureStep({ lesson, progress, done, record }: StepProps) {
  const build = lesson.build as BuildM;
  const def = circuitById(build.circuit);
  const guided = !progress.steps.buildGuided;
  const part = guided ? build.guided : build.unguided;
  const sim = useSim(() => new Circuit(def), [def, guided]);
  const [probes, setProbes] = useState<ProbeState>(emptyProbes);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Record<string, 'ok' | 'wrong'>>({});
  const [warn, setWarn] = useState<string | null>(null);
  const expected = useMemo(() => Object.fromEntries(part.tasks.map((t) => [t.id, expectedFor(build.circuit, t)])), [part, build.circuit]);
  const allOk = part.tasks.every((t) => result[t.id] === 'ok');

  const check = async (t: MeasureTask) => {
    const n = Number(String(typed[t.id] ?? '').replace(',', '.').trim());
    const exp = expected[t.id];
    const ok = typed[t.id]?.trim() !== '' && !Number.isNaN(n) && exp !== null && readingMatches(n, exp, t.tolerancePct);
    setResult({ ...result, [t.id]: ok ? 'ok' : 'wrong' });
    await record({ kind: 'build', lessonId: lesson.id, mode: guided ? 'guided' : 'unguided', task: t.id, passed: ok, failure: ok ? null : `Wrong reading for: ${t.text}` });
  };

  const onTerminal = (ref: string) => {
    const next = placeProbe(probes, ref);
    setProbes(next);
    if (next.red && next.black && measure(sim.circuit, next.red, next.black, next.mode).unsafe) {
      setWarn(next.mode === 'IR' ? 'Safety: you tried a 500 V insulation test on a live circuit. Isolate, lock off and prove dead first. A live IR test can damage the tester and the equipment.' : 'Safety: you tried a resistance (Ω) test on a live circuit. Switch off F1 first. On a real panel, isolate and prove dead.');
    }
  };

  return (
    <div>
      <p><StatusChip status="progress" label={guided ? 'Part 1 of 2: guided' : 'Part 2 of 2: on your own'} /></p>
      <Markup text={part.intro} />
      <div className="lab">
        <div className="lab-main">
          <CircuitCanvas circuit={sim.circuit} version={sim.version} onCommand={(c) => sim.apply((x) => x.command(c))} onTerminal={onTerminal} probes={probes} />
          <div className="actions"><button onClick={sim.reset}>Reset circuit</button></div>
        </div>
        <aside className="lab-side">
          {warn && <Notice kind="warn">{warn}</Notice>}
          <Meter circuit={sim.circuit} probes={probes} onChange={setProbes} version={sim.version} />
          <h3>Readings</h3>
          <ol className="readings">
            {part.tasks.map((t) => (
              <li key={t.id} className={result[t.id] === 'ok' ? 'done' : ''}>
                <label htmlFor={`r-${t.id}`}>{t.text}{guided ? '' : ` (${MODE_LABEL[t.mode]})`}</label>
                <div className="reading-row">
                  <input id={`r-${t.id}`} inputMode="decimal" value={typed[t.id] ?? ''} disabled={result[t.id] === 'ok'}
                    onChange={(e) => { setTyped({ ...typed, [t.id]: e.target.value }); if (result[t.id] === 'wrong') setResult({ ...result, [t.id]: undefined as never }); }} />
                  <span className="unit">{t.unit}</span>
                  {result[t.id] === 'ok' ? <StatusChip status="passed" label="Correct" /> : <button type="button" onClick={() => void check(t)}>Check</button>}
                </div>
                {result[t.id] === 'wrong' && <p className="explain">✖ Not quite. Check the switches, the meter mode and both test points, then measure again.</p>}
              </li>
            ))}
          </ol>
        </aside>
      </div>
      <div className="step-nav">
        {allOk && guided && <button className="primary" onClick={() => { setTyped({}); setResult({}); setWarn(null); void done((s) => ({ ...s, buildGuided: true }), false); }}>Next: measure on your own ▶</button>}
        {allOk && !guided && <button className="primary" onClick={() => done((s) => ({ ...s, build: true }))}>Next: Break ▶</button>}
      </div>
    </div>
  );
}
