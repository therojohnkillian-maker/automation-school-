import { describe, expect, it } from 'vitest';
import dolJson from '../../content/circuits/dol-starter.json';
import isoJson from '../../content/circuits/m0-isolation.json';
import { Circuit } from '../../src/engines/wiring/circuit';
import { measure, indicate } from '../../src/engines/wiring/meter';
import type { CircuitJson } from '../../src/engines/wiring/types';
import { fullLoadCurrent, synchronousSpeed, starStartCurrent, starStartTorque, rotation } from '../../src/engines/motor/calc';
import { mAToValue, mAToRaw } from '../../src/engines/loop/scaling';

const dol = dolJson as unknown as CircuitJson;
const iso = isoJson as unknown as CircuitJson;
const run = (c: Circuit, ms: number) => {
  for (let t = 0; t < ms; t += 10) c.step(10);
};
const start = (c: Circuit) => {
  c.command({ kind: 'press', part: 'S2' });
  c.command({ kind: 'release', part: 'S2' });
  run(c, 2000);
};

describe('master prompt formula cases', () => {
  it('11 kW, 400 V, η 0.90, pf 0.85 ≈ 20.8 A', () => {
    expect(fullLoadCurrent(11, 400, 0.9, 0.85)).toBeCloseTo(20.75, 1);
  });
  it('4-pole motor: 1500 rpm at 50 Hz, 750 rpm at 25 Hz', () => {
    expect(synchronousSpeed(50, 4)).toBe(1500);
    expect(synchronousSpeed(25, 4)).toBe(750);
  });
  it('star start is one third of delta current and torque', () => {
    expect(starStartCurrent(60)).toBeCloseTo(20);
    expect(starStartTorque(30)).toBeCloseTo(10);
  });
  it('12 mA on 0-10 bar = 5 bar, raw 13824', () => {
    expect(mAToValue(12, 0, 10)).toBe(5);
    expect(mAToRaw(12)).toBe(13824);
  });
  it('swapping two phases reverses rotation', () => {
    expect(rotation('L1', 'L2', 'L3')).toBe('forward');
    expect(rotation('L2', 'L1', 'L3')).toBe('reverse');
    expect(rotation('L1', 'L3', 'L2')).toBe('reverse');
  });
});

describe('DOL starter simulation', () => {
  it('starts idle with the 24 V supply on', () => {
    const c = new Circuit(dol);
    expect(c.status('G1').psuOn).toBe(true);
    expect(c.status('KM1').energised).toBe(false);
    expect(Math.round(c.voltage('G1:P', 'G1:M').dc)).toBe(24);
    expect(Math.round(c.voltage('SUP:L1', 'SUP:L2').ac)).toBe(400);
    expect(Math.round(c.voltage('SUP:L1', 'SUP:N').ac)).toBe(231);
  });

  it('latches on START, runs forward, and stops on STOP', () => {
    const c = new Circuit(dol);
    start(c);
    expect(c.status('KM1').energised).toBe(true);
    expect(c.status('M1').motor).toMatchObject({ state: 'running', direction: 'forward', rpm: 1430 });
    expect(c.status('H1').lit).toBe(true);
    c.command({ kind: 'press', part: 'S1' });
    expect(c.status('KM1').energised).toBe(false);
    c.command({ kind: 'release', part: 'S1' });
    expect(c.status('KM1').energised).toBe(false); // does not restart
    run(c, 10_000);
    expect(c.status('M1').motor?.state).toBe('stopped');
  });

  it('draws about 6 × FLC while starting and FLC when running', () => {
    const c = new Circuit(dol);
    c.command({ kind: 'press', part: 'S2' });
    run(c, 100);
    const flc = fullLoadCurrent(2.2, 400, 0.85, 0.82);
    expect(c.status('M1').motor?.amps).toBeCloseTo(6 * flc, 0);
    run(c, 2000);
    expect(c.status('M1').motor?.amps).toBeCloseTo(flc, 0);
  });

  it('losing the normally closed stop circuit stops the motor', () => {
    const c = new Circuit(dol);
    start(c);
    c.removeWire('c6'); // S1-12 to S2-13 broken
    expect(c.status('KM1').energised).toBe(false);
  });

  it('resetting an overload trip never restarts the motor', () => {
    const c = new Circuit(dol);
    start(c);
    c.command({ kind: 'trip-test', part: 'F2' });
    expect(c.status('KM1').energised).toBe(false);
    expect(c.status('H2').lit).toBe(true);
    c.command({ kind: 'reset', part: 'F2' });
    run(c, 1000);
    expect(c.status('F2').tripped).toBe(false);
    expect(c.status('KM1').energised).toBe(false);
  });

  it('swapping two motor phases reverses the motor', () => {
    const def = structuredClone(dol);
    def.wires.find((w) => w.id === 'p10')!.b = 'M1:V1';
    def.wires.find((w) => w.id === 'p11')!.b = 'M1:U1';
    const c = new Circuit(def);
    start(c);
    expect(c.status('M1').motor).toMatchObject({ state: 'running', direction: 'reverse' });
  });

  it('a missing phase stalls the motor and the overload trips within seconds', () => {
    const c = new Circuit(dol, [{ id: 'x', kind: 'contact-open', part: 'Q1', a: '5', b: '6', report: '' }]);
    c.command({ kind: 'press', part: 'S2' });
    c.command({ kind: 'release', part: 'S2' });
    run(c, 500);
    expect(c.status('M1').motor?.state).toBe('stalled');
    run(c, 9000);
    expect(c.status('F2').tripped).toBe(true);
    expect(c.status('KM1').energised).toBe(false);
  });

  it('a short across the 24 V supply switches the PSU output off, and is cleared by power cycling', () => {
    const c = new Circuit(dol);
    const w = c.addWire('G1:P', 'G1:M')!;
    expect(c.status('G1').psuOn).toBe(false);
    c.removeWire(w.id);
    expect(c.status('G1').psuOn).toBe(false); // latched off
    c.command({ kind: 'switch', part: 'F1', on: false });
    c.command({ kind: 'switch', part: 'F1', on: true });
    expect(c.status('G1').psuOn).toBe(true);
  });

  it('a phase-to-phase short trips Q1', () => {
    const c = new Circuit(dol);
    c.addWire('KM1:1', 'KM1:3');
    expect(c.status('Q1').tripped).toBe(true);
  });

  it('230 V on a 24 V coil burns it out', () => {
    const def = structuredClone(dol);
    def.wires.find((w) => w.id === 'c5')!.a = 'F1:2'; // learner fed the stop circuit from 230 V
    const c = new Circuit(def);
    c.command({ kind: 'press', part: 'S2' });
    expect(c.status('KM1').burnt).toBe(true);
  });

  it('meter: V= reads 24 V across the coil when energised and about 0 in V~ mode', () => {
    const c = new Circuit(dol);
    start(c);
    expect(measure(c, 'KM1:A1', 'KM1:A2', 'VDC').display).toBe('24.0 V=');
    expect(measure(c, 'KM1:A1', 'KM1:A2', 'VAC').display).toBe('0 V~');
  });

  it('meter: resistance on a live circuit is refused and flagged', () => {
    const c = new Circuit(dol);
    const r = measure(c, 'KM1:A1', 'KM1:A2', 'OHM');
    expect(r.unsafe).toBe(true);
  });

  it('meter: coil and winding resistance read correctly when isolated', () => {
    const c = new Circuit(dol);
    c.command({ kind: 'switch', part: 'Q1', on: false });
    expect(measure(c, 'KM1:A1', 'KM1:A2', 'OHM').display).toBe('120.0 Ω');
    // Delta windings, 9 Ω each, measured across one: 9 ∥ 18 = 6 Ω.
    expect(measure(c, 'M1:U1', 'M1:V1', 'OHM').display).toBe('6.0 Ω');
    expect(measure(c, 'S1:11', 'S1:12', 'OHM').display).toBe('0.0 Ω');
    expect(measure(c, 'S2:13', 'S2:14', 'OHM').display).toBe('OL (open)');
  });

  it('an open coil reads 24 V across it; a broken A2 wire reads 24 V from A2 to 0 V', () => {
    const coil = new Circuit(dol, [{ id: 'x', kind: 'coil-open', part: 'KM1', report: '' }]);
    coil.command({ kind: 'press', part: 'S2' });
    expect(Math.round(coil.voltage('KM1:A1', 'KM1:A2').dc)).toBe(24);
    const wire = new Circuit(dol, [{ id: 'y', kind: 'wire-open', wire: 'c11', report: '' }]);
    wire.command({ kind: 'press', part: 'S2' });
    expect(Math.round(wire.voltage('KM1:A1', 'KM1:A2').dc)).toBe(0);
    expect(Math.round(wire.voltage('KM1:A2', 'G1:M').dc)).toBe(24);
  });

  it('is deterministic: the same commands give the same log', () => {
    const a = new Circuit(dol);
    const b = new Circuit(dol);
    for (const c of [a, b]) {
      start(c);
      c.command({ kind: 'trip-test', part: 'F2' });
      run(c, 3000);
    }
    expect(a.log).toEqual(b.log);
  });
});

describe('isolation circuit', () => {
  it('back-feed: a welded pole leaves every motor terminal live to earth', () => {
    const c = new Circuit(iso, [{ id: 'w', kind: 'contact-closed', part: 'Q0A', a: '3', b: '4', report: '' }]);
    c.command({ kind: 'switch', part: 'Q0A', on: false });
    for (const t of ['U1', 'V1', 'W1']) expect(indicate(c, `M1:${t}`, 'M1:PE', true).volts).toBeGreaterThan(200);
    expect(indicate(c, 'M1:U1', 'M1:V1', true).volts).toBe(0);
  });

  it('a correctly isolated motor is dead between every pair', () => {
    const c = new Circuit(iso);
    c.command({ kind: 'switch', part: 'Q0A', on: false });
    const pts = ['U1', 'V1', 'W1', 'PE'];
    for (const a of pts) for (const b of pts) expect(indicate(c, `M1:${a}`, `M1:${b}`, true).volts).toBe(0);
    expect(indicate(c, 'M2:U1', 'M2:PE', true).display).toBe('230 V ~ lit');
  });

  it('cannot switch on a locked isolator', () => {
    const c = new Circuit(iso);
    c.command({ kind: 'switch', part: 'Q0A', on: false });
    c.command({ kind: 'lock', part: 'Q0A' });
    c.command({ kind: 'switch', part: 'Q0A', on: true });
    expect(c.status('Q0A').on).toBe(false);
  });
});
