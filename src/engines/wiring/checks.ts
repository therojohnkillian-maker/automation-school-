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
  | { part: string; motor: 'running' | 'stopped-or-coasting' | 'not-powered'; direction?: 'forward' | 'reverse' }
  | { part: string; feedsMotor: string }
  | { noShorts: true }
  | { stable: true };

export type CheckStep =
  | { do: Command }
  | { wait: number }
  | { expect: Expectation; fail: string };

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
  if ('feedsMotor' in e) return c.motorFedBy(e.part) === e.feedsMotor;
  const s = c.status(e.part);
  if ('energised' in e) return !!s.energised === e.energised;
  if ('tripped' in e) return !!s.tripped === e.tripped;
  if ('lit' in e) return !!s.lit === e.lit;
  if ('psuOn' in e) return !!s.psuOn === e.psuOn;
  if ('pressed' in e) return !!s.pressed === e.pressed;
  if ('motor' in e) {
    const m = s.motor!;
    if (e.motor === 'running') return m.state === 'running' && (!e.direction || m.direction === e.direction);
    if (e.motor === 'stopped-or-coasting') return m.state === 'stopped' || m.state === 'coasting';
    if (e.motor === 'not-powered') return m.state === 'stopped' || m.state === 'coasting';
  }
  return false;
}

export function runChecks(def: CircuitJson, wires: WireJson[], steps: CheckStep[], faults: FaultJson[] = []): CheckResult {
  const c = new Circuit(def, faults, wires);
  const total = steps.filter((s) => 'expect' in s).length;
  let passedCount = 0;
  for (const s of steps) {
    if ('do' in s) c.command(s.do);
    else if ('wait' in s) {
      for (let t = 0; t < s.wait; t += 10) c.step(10);
    } else {
      if (!holds(c, s.expect)) return { passed: false, failures: [s.fail], passedCount, total };
      passedCount++;
    }
  }
  return { passed: true, failures: [], passedCount, total };
}
