import { describe, expect, it } from 'vitest';
import { circuits, glossary, lessons, catalog, circuit } from '../../src/content';
import { runChecks } from '../../src/engines/wiring/checks';
import { terminalsOf } from '../../src/engines/wiring/circuit';
import { IsolationSession } from '../../src/engines/safety/isolation';
import type { FaultJson } from '../../src/engines/wiring/types';
import { expectedFor } from '../../src/features/learn/MeasureStep';
import { Circuit as Sim } from '../../src/engines/wiring/circuit';

const allText = (o: unknown): string[] =>
  typeof o === 'string' ? [o] : Array.isArray(o) ? o.flatMap(allText) : o && typeof o === 'object' ? Object.values(o).flatMap(allText) : [];

describe('circuits', () => {
  for (const c of Object.values(circuits)) {
    it(`${c.id}: every wire lands on a real, drawn terminal`, () => {
      const parts = new Map(c.parts.map((p) => [p.id, p]));
      for (const w of c.wires) {
        for (const end of [w.a, w.b]) {
          const [pid, t] = end.split(':');
          const p = parts.get(pid);
          expect(p, `${w.id} → ${end}`).toBeTruthy();
          expect(terminalsOf(p!)).toContain(t);
          expect(p!.pins[t], `${end} has no drawn position`).toBeTruthy();
        }
      }
      expect(new Set(c.wires.map((w) => w.id)).size).toBe(c.wires.length);
    });
  }
});

describe('lessons', () => {
  it('every catalog lesson exists', () => {
    for (const m of catalog.modules) for (const id of m.lessons) expect(lessons.find((l) => l.id === id), id).toBeTruthy();
  });

  for (const l of lessons) {
    describe(l.id, () => {
      it('glossary links all resolve', () => {
        for (const t of allText(l)) for (const m of t.matchAll(/\[\[([^\]]+)\]\]/g)) expect(glossary[m[1]], `missing glossary term "${m[1]}"`).toBeTruthy();
      });

      it('quiz answers are valid, and at least two questions are critical', () => {
        for (const q of l.prove.questions) expect(q.answer).toBeLessThan(q.options.length);
        expect(l.prove.questions.filter((q) => q.critical).length).toBeGreaterThanOrEqual(2);
        expect(l.prove.passMark).toBe(0.8);
      });

      it('has at least three faults, each with a distinct report', () => {
        expect(l.break.faults.length).toBeGreaterThanOrEqual(3);
        const reports = [...l.break.faults.map((f) => f.report), ...l.break.extraReports];
        expect(new Set(reports).size).toBe(reports.length);
      });

      if (l.build.kind === 'circuit') {
        const b = l.build;
        const def = circuit(b.circuit);
        it('the correct circuit passes every functional check', () => {
          const r = runChecks(def, def.wires, b.checks);
          expect(r.failures).toEqual([]);
          expect(r.passed).toBe(true);
        });
        it('removed wires exist, and with them removed the checks fail', () => {
          for (const set of [b.guided.removeWires, b.unguided.removeWires]) {
            for (const id of set) expect(def.wires.some((w) => w.id === id), id).toBe(true);
            expect(runChecks(def, def.wires.filter((w) => !set.includes(w.id)), b.checks).passed).toBe(false);
          }
        });
        it('leaving out any one control or power wire is caught by the checks', () => {
          for (const id of b.unguided.removeWires) {
            const r = runChecks(def, def.wires.filter((w) => w.id !== id), b.checks);
            expect(r.passed, `missing wire ${id} was not detected`).toBe(false);
          }
        });
      }

      if (l.build.kind === 'measure') {
        const b = l.build;
        it('every measurement task has a real, safe expected value', () => {
          const def = circuit(b.circuit);
          for (const t of [...b.guided.tasks, ...b.unguided.tasks]) {
            const sim = new Sim(def);
            expect(sim.hasTerminal(t.a) && sim.hasTerminal(t.b), `${t.id} points`).toBe(true);
            expect(expectedFor(b.circuit, t), `${t.id} expected value`).not.toBeNull();
          }
        });
      }

      if (l.break.kind === 'circuit' && (l.break.symptomChecks || l.build.kind === 'circuit')) {
        const br = l.break;
        const checks = br.symptomChecks ?? (l.build as unknown as { checks: never[] }).checks;
        it('every fault is diagnosable: it changes how the circuit behaves', () => {
          const def = circuit(br.circuit);
          expect(runChecks(def, def.wires, checks).passed, 'healthy circuit must pass the symptom checks').toBe(true);
          for (const f of br.faults) {
            const r = runChecks(def, def.wires, checks, [f as FaultJson]);
            expect(r.passed, `fault ${f.id} has no symptom`).toBe(false);
          }
        });
      }

      if (l.break.kind === 'isolation') {
        const br = l.break;
        it('every isolation fault stops a careless declaration from passing', () => {
          const def = circuit(br.scenario.circuit);
          for (const f of br.faults) {
            const s = new IsolationSession(def, br.scenario, [f as FaultJson]);
            // The careless learner: switch off and lock the isolator labelled for the job, test once and declare.
            const labelled = s.isolators().find((i) => s.circuit.tagOf(i) === br.scenario.jobTag)!;
            s.switchIsolator(labelled, false);
            s.lock(labelled);
            s.prove();
            s.requiredPairs().forEach(([a, b]) => s.test(a, b));
            s.prove();
            expect(s.declareDead().passed, `fault ${f.id} would not be noticed`).toBe(false);
          }
        });
      }
    });
  }
});
