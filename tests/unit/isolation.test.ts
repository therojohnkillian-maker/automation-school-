import { describe, expect, it } from 'vitest';
import isoJson from '../../content/circuits/m0-isolation.json';
import { IsolationSession, type IsolationScenario } from '../../src/engines/safety/isolation';
import type { CircuitJson, FaultJson } from '../../src/engines/wiring/types';

const def = isoJson as unknown as CircuitJson;
const scenario: IsolationScenario = { circuit: 'm0-isolation', target: 'M1', jobTag: 'P-101 PUMP', points: ['M1:U1', 'M1:V1', 'M1:W1', 'M1:PE'] };
const session = (faults: FaultJson[] = []) => new IsolationSession(def, scenario, faults);
const testAll = (s: IsolationSession) => s.requiredPairs().map(([a, b]) => s.test(a, b));

describe('safe isolation procedure', () => {
  it('passes when isolated, locked and prove-test-prove is done', () => {
    const s = session();
    s.switchIsolator('Q0A', false);
    s.lock('Q0A');
    expect(s.prove().ok).toBe(true);
    expect(testAll(s).every((r) => r.volts === 0)).toBe(true);
    s.prove();
    expect(s.nextHint()).toMatch(/declare/);
    const e = s.declareDead();
    expect(e.problems).toEqual([]);
    expect(e.passed).toBe(true);
  });

  it('critical: declaring dead without isolating', () => {
    const e = session().declareDead();
    expect(e.actuallyDead).toBe(false);
    expect(e.problems.some((p) => p.critical && /still live/.test(p.text))).toBe(true);
  });

  it('critical: skipping the prove after testing', () => {
    const s = session();
    s.switchIsolator('Q0A', false);
    s.lock('Q0A');
    s.prove();
    testAll(s);
    const e = s.declareDead();
    expect(e.passed).toBe(false);
    expect(e.problems.map((p) => p.text).join()).toMatch(/prove the tester again/);
  });

  it('critical: missing a test pair', () => {
    const s = session();
    s.switchIsolator('Q0A', false);
    s.lock('Q0A');
    s.prove();
    s.requiredPairs().slice(0, 5).forEach(([a, b]) => s.test(a, b));
    s.prove();
    expect(s.declareDead().problems.map((p) => p.text).join()).toMatch(/Missing: V1–PE|Missing: W1–PE|Missing/);
  });

  it('critical: no lock fitted', () => {
    const s = session();
    s.switchIsolator('Q0A', false);
    s.prove();
    testAll(s);
    s.prove();
    expect(s.declareDead().problems.map((p) => p.text).join()).toMatch(/not locked/);
  });

  it('fault: wrong labels — the labelled isolator leaves the pump live; the other one makes it dead', () => {
    const s = session([{ id: 'labels', kind: 'labels-swapped', parts: ['Q0A', 'Q0B'], report: '' }]);
    expect(s.circuit.tagOf('Q0B')).toBe('P-101 PUMP');
    s.switchIsolator('Q0B', false); // labelled P-101 but feeds the fan
    s.lock('Q0B');
    s.prove();
    expect(testAll(s).some((r) => r.volts > 0)).toBe(true);
    expect(s.feeder()).toBe('Q0A');
    s.switchIsolator('Q0A', false);
    s.lock('Q0A');
    s.prove();
    expect(testAll(s).every((r) => r.volts === 0)).toBe(true);
    s.prove();
    expect(s.declareDead().passed).toBe(true);
  });

  it('fault: faulty tester fails proving, and tests only count after replacing it', () => {
    const s = session([{ id: 't', kind: 'tester-faulty', report: '' }]);
    s.switchIsolator('Q0A', false);
    s.lock('Q0A');
    expect(s.prove().ok).toBe(false);
    testAll(s);
    s.prove();
    expect(s.declareDead().passed).toBe(false);
    s.replaceTester();
    s.prove();
    testAll(s);
    s.prove();
    expect(s.declareDead().passed).toBe(true);
  });

  it('fault: welded pole — voltage is found and the circuit can never be declared dead', () => {
    const s = session([{ id: 'w', kind: 'contact-closed', part: 'Q0A', a: '3', b: '4', report: '' }]);
    s.switchIsolator('Q0A', false);
    s.lock('Q0A');
    s.prove();
    const readings = testAll(s);
    expect(readings.filter((r) => r.volts > 200).length).toBe(3); // each phase to PE
    s.prove();
    expect(s.nextHint()).toMatch(/not dead/);
    const e = s.declareDead();
    expect(e.actuallyDead).toBe(false);
    expect(e.passed).toBe(false);
  });
});
