/**
 * Safe isolation procedure for M0: isolate, secure, prove-test-prove, then decide.
 * Readings come from the circuit engine, so wrong labels, welded poles and back-feed behave as they would on site.
 * The order of steps follows common UK practice and must be checked against the site procedure (VERIFY #5).
 */
import { Circuit } from '../wiring/circuit';
import { indicate } from '../wiring/meter';
import type { CircuitJson, FaultJson } from '../wiring/types';

export interface IsolationScenario {
  circuit: string;
  /** The motor the job is on. */
  target: string;
  /** Plant tag the job card names, matched against isolator tags. */
  jobTag: string;
  /** Test points at the point of work. */
  points: string[];
}

export type IsoEvent =
  | { kind: 'switch'; part: string; on: boolean }
  | { kind: 'lock'; part: string }
  | { kind: 'unlock'; part: string }
  | { kind: 'prove'; ok: boolean }
  | { kind: 'test'; a: string; b: string; volts: number }
  | { kind: 'replace-tester' }
  | { kind: 'declare' }
  | { kind: 'report'; text: string };

export interface Problem {
  critical: boolean;
  text: string;
}

export interface Evaluation {
  actuallyDead: boolean;
  feeder: string | null;
  problems: Problem[];
  passed: boolean;
}

const pairKey = (a: string, b: string) => [a, b].sort().join('~');

export class IsolationSession {
  readonly circuit: Circuit;
  readonly scenario: IsolationScenario;
  testerWorks: boolean;
  events: IsoEvent[] = [];

  constructor(def: CircuitJson, scenario: IsolationScenario, faults: FaultJson[] = []) {
    this.circuit = new Circuit(def, faults);
    this.scenario = scenario;
    this.testerWorks = !faults.some((f) => f.kind === 'tester-faulty');
  }

  /** All pairs that must be tested: every point against every other point. */
  requiredPairs(): [string, string][] {
    const p = this.scenario.points;
    const out: [string, string][] = [];
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) out.push([p[i], p[j]]);
    return out;
  }

  isolators(): string[] {
    return [...this.circuit.parts.values()].filter((p) => p.def.type === 'isolator3').map((p) => p.def.id);
  }

  switchIsolator(part: string, on: boolean) {
    const before = this.circuit.status(part).on;
    this.circuit.command({ kind: 'switch', part, on });
    if (this.circuit.status(part).on !== before) this.events.push({ kind: 'switch', part, on });
  }

  lock(part: string) {
    this.circuit.command({ kind: 'lock', part });
    if (this.circuit.status(part).locked) this.events.push({ kind: 'lock', part });
  }

  unlock(part: string) {
    this.circuit.command({ kind: 'unlock', part });
    this.events.push({ kind: 'unlock', part });
  }

  prove(): { ok: boolean; display: string } {
    const ok = this.testerWorks;
    this.events.push({ kind: 'prove', ok });
    return { ok, display: ok ? 'Proving unit: tester lights at every range. Tester works.' : 'Proving unit: NO indication. This tester is faulty.' };
  }

  test(a: string, b: string): { volts: number; display: string } {
    const r = indicate(this.circuit, a, b, this.testerWorks);
    this.events.push({ kind: 'test', a, b, volts: r.volts });
    return r;
  }

  replaceTester() {
    this.testerWorks = true;
    this.events.push({ kind: 'replace-tester' });
  }

  report(text: string) {
    this.events.push({ kind: 'report', text });
  }

  /** True if no target terminal is live to any other point. */
  actuallyDead(): boolean {
    return this.requiredPairs().every(([a, b]) => indicate(this.circuit, a, b, true).volts === 0);
  }

  /** The isolator wired to the target: switching it alone changes the potential at the target terminals. */
  feeder(): string | null {
    for (const iso of this.isolators()) {
      const probe = this.circuit.clone();
      for (const other of this.isolators()) probe.command({ kind: 'switch', part: other, on: true });
      const before = this.scenario.points.map((t) => JSON.stringify(probe.potAt(t)));
      probe.command({ kind: 'switch', part: iso, on: false });
      const after = this.scenario.points.map((t) => JSON.stringify(probe.potAt(t)));
      if (before.some((v, i) => v !== after[i])) return iso;
    }
    return null;
  }

  /** What the learner should do next (guided mode). */
  nextHint(): string {
    const feeder = this.feeder();
    const lockedByMe = this.isolators().filter((i) => this.circuit.status(i).locked);
    const anyOff = this.isolators().some((i) => !this.circuit.status(i).on);
    if (!anyOff) return `Find the isolator tagged "${this.scenario.jobTag}" and switch it off.`;
    if (!lockedByMe.length) return 'Fit your own padlock and a tag to the isolator you switched off.';
    const s = this.progress(feeder);
    if (!s.provedBefore) return 'Prove your tester on the proving unit before you test.';
    if (s.missing.length) return `Test at the motor terminals. Still to test: ${s.missing.map(([a, b]) => `${short(a)}–${short(b)}`).join(', ')}.`;
    if (s.liveFound) return 'You found voltage. Stop: this circuit is not dead. Report it and do not start work.';
    if (!s.provedAfter) return 'Prove your tester again on the proving unit.';
    return 'All tests done and the tester proved before and after. You can declare the circuit dead.';
  }

  /** Progress of prove-test-prove since the feeder was last locked. */
  progress(feeder: string | null) {
    let start = -1;
    this.events.forEach((e, i) => {
      if (e.kind === 'lock' && (feeder === null || e.part === feeder)) start = i;
    });
    if (start < 0) {
      // Fall back to the last lock of any isolator, so guided hints still make sense.
      this.events.forEach((e, i) => {
        if (e.kind === 'lock') start = i;
      });
    }
    let provedBefore = false;
    let provedAfter = false;
    let liveFound = false;
    let tested = new Set<string>();
    for (const e of this.events.slice(start + 1)) {
      if (e.kind === 'replace-tester') {
        provedBefore = false;
        provedAfter = false;
        tested = new Set();
      } else if (e.kind === 'prove') {
        if (!e.ok) {
          provedBefore = false;
          provedAfter = false;
          tested = new Set();
        } else if (!provedBefore) provedBefore = true;
        else if (tested.size) provedAfter = this.requiredPairs().every(([a, b]) => tested.has(pairKey(a, b)));
      } else if (e.kind === 'test' && provedBefore) {
        if (provedAfter) provedAfter = false; // tested again after proving: needs another prove
        tested.add(pairKey(e.a, e.b));
        if (e.volts > 0) liveFound = true;
      } else if (e.kind === 'switch' || e.kind === 'unlock') {
        provedAfter = false;
      }
    }
    const missing = this.requiredPairs().filter(([a, b]) => !tested.has(pairKey(a, b)));
    return { provedBefore, provedAfter, missing, liveFound };
  }

  /** Called when the learner declares the circuit dead and safe to work on. */
  declareDead(): Evaluation {
    this.events.push({ kind: 'declare' });
    const feeder = this.feeder();
    const dead = this.actuallyDead();
    const problems: Problem[] = [];
    if (!dead) {
      problems.push({ critical: true, text: 'The motor terminals were still live. If you had started work you could have received a fatal shock.' });
    }
    if (feeder && !this.circuit.status(feeder).locked) {
      problems.push({ critical: true, text: `The isolator that actually feeds this motor (${feeder}) was not locked off with your own lock.` });
    }
    const s = this.progress(feeder);
    if (!s.provedBefore) problems.push({ critical: true, text: 'You did not prove your tester on the proving unit before testing (or the tester failed and was not replaced).' });
    if (s.missing.length) {
      problems.push({ critical: true, text: `You did not test between every conductor. Missing: ${s.missing.map(([a, b]) => `${short(a)}–${short(b)}`).join(', ')}.` });
    }
    if (s.provedBefore && !s.missing.length && !s.provedAfter) {
      problems.push({ critical: true, text: 'You did not prove the tester again after testing. If it had failed during the test, a live circuit would have looked dead.' });
    }
    if (s.liveFound) problems.push({ critical: true, text: 'One of your tests showed voltage, but you still declared the circuit dead.' });
    return { actuallyDead: dead, feeder, problems, passed: problems.length === 0 };
  }
}

export const short = (term: string) => term.split(':')[1] ?? term;
