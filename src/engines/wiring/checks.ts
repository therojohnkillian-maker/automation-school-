/**
 * Functional tests for a learner's wiring, written as data in the lesson.
 * Passing means the circuit behaves correctly, however it was wired.
 */
import { Circuit } from './circuit';
import type { Command, CircuitJson, FaultJson, WireJson } from './types';

export type Expectation =
  | { part: string; energised: boolean }
  | { part: string; tripped: boolean }
  | { part: string; lit: boolean }
  | { part: string; psuOn: boolean }
  | { part: string; pressed: boolean }
  | { part: string; motor: 'running' | 'starting' | 'stopped-or-coasting' | 'not-powered'; direction?: 'forward' | 'reverse' }
  | { part: string; feedsMotor: string }
  | { connected: [string, string] }
  | { part: string; input: string; on: boolean }
  | { part: string; output: boolean }
  | { part: string; mA: [number, number] }
  | { part: string; value: [number, number] }
  | { part: string; relay: 'hi' | 'lo'; on: boolean }
  | { part: string; timerDone: boolean }
  | { part: string; locked: boolean }
  | { part: string; connection: 'correct' | 'low' | 'high' }
  | { part: string; ampsBelow: number }
  | { insulation: [string, string]; minMOhm: number }
  | { noShorts: true }
  | { stable: true };

export type CheckStep =
  | { do: Command }
  | { wait: number }
  | { expect: Expectation; fail: string }
  /** From here on, these two contactors must never be energised at the same moment (checked every 10 ms). */
  | { watchNotBoth: [string, string]; fail: string };

export interface CheckResult {
  passed: boolean;
  /** Messages for each failed expectation, in order. Checking stops at the first failure. */
  failures: string[];
  passedCount: number;
  total: number;
}

export function holds(c: Circuit, e: Expectation): boolean {
  if ('noShorts' in e) {
    return ![...c.parts.values()].some((p) => (p.def.type === 'mcb2' || p.def.type === 'mpcb3' || p.def.type === 'psu24') && p.tripped) && !c.supplyFault;
  }
  if ('stable' in e) return !c.unstable;
  if ('connected' in e) return c.nodeOf(e.connected[0]) === c.nodeOf(e.connected[1]);
  if ('insulation' in e) {
    const r = c.resistance(e.insulation[0], e.insulation[1]);
    return !r.live && (r.ohms === null || r.ohms / 1e6 >= e.minMOhm);
  }
  if ('feedsMotor' in e) return c.motorFedBy(e.part) === e.feedsMotor;
  const s = c.status(e.part);
  if ('input' in e) return !!s.inputs?.[e.input] === e.on;
  if ('output' in e) return !!s.output === e.output;
  if ('mA' in e) return s.mA !== undefined && s.mA >= e.mA[0] && s.mA <= e.mA[1];
  if ('value' in e) return s.eng !== undefined && s.eng >= e.value[0] && s.eng <= e.value[1];
  if ('relay' in e) return !!s.relays?.[e.relay] === e.on;
  if ('locked' in e) return !!s.locked === e.locked;
  if ('timerDone' in e) return !!s.done === e.timerDone;
  if ('connection' in e) return s.motor?.connection === e.connection;
  if ('ampsBelow' in e) return (s.motor?.amps ?? 0) < e.ampsBelow;
  if ('energised' in e) return !!s.energised === e.energised;
  if ('tripped' in e) return !!s.tripped === e.tripped;
  if ('lit' in e) return !!s.lit === e.lit;
  if ('psuOn' in e) return !!s.psuOn === e.psuOn;
  if ('pressed' in e) return !!s.pressed === e.pressed;
  if ('motor' in e) {
    const m = s.motor!;
    if (e.motor === 'starting') return m.state === 'starting';
    if (e.motor === 'running') return m.state === 'running' && (!e.direction || m.direction === e.direction);
    if (e.motor === 'stopped-or-coasting') return m.state === 'stopped' || m.state === 'coasting';
    if (e.motor === 'not-powered') return m.state === 'stopped' || m.state === 'coasting';
  }
  return false;
}

/** `before` replays settings the learner made (such as analog scaling) on the fresh copy before the checks run. */
export function runChecks(def: CircuitJson, wires: WireJson[], steps: CheckStep[], faults: FaultJson[] = [], before: Command[] = []): CheckResult {
  const c = new Circuit(def, faults, wires);
  for (const cmd of before) c.command(cmd);
  const total = steps.filter((s) => 'expect' in s).length;
  let passedCount = 0;
  const watches: { pair: [string, string]; fail: string }[] = [];
  const bothOn = () => watches.find((w) => c.status(w.pair[0]).energised && c.status(w.pair[1]).energised);
  for (const s of steps) {
    if ('watchNotBoth' in s) {
      watches.push({ pair: s.watchNotBoth, fail: s.fail });
      continue;
    }
    if ('do' in s) {
      c.command(s.do);
      const w = bothOn();
      if (w) return { passed: false, failures: [w.fail], passedCount, total };
    } else if ('wait' in s) {
      for (let t = 0; t < s.wait; t += 10) {
        c.step(10);
        const w = bothOn();
        if (w) return { passed: false, failures: [w.fail], passedCount, total };
      }
    } else {
      const w = bothOn();
      if (w) return { passed: false, failures: [w.fail], passedCount, total };
      if (!holds(c, s.expect)) return { passed: false, failures: [s.fail], passedCount, total };
      passedCount++;
    }
  }
  return { passed: true, failures: [], passedCount, total };
}
