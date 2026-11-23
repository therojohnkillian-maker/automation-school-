import { describe, expect, it } from 'vitest';
import sensorsJson from '../../content/circuits/m2-sensors.json';
import loopJson from '../../content/circuits/m2-loop.json';
import tankJson from '../../content/circuits/t4-tank.json';
import { Circuit, rawCount, signalStatus } from '../../src/engines/wiring/circuit';
import { measure } from '../../src/engines/wiring/meter';
import type { CircuitJson } from '../../src/engines/wiring/types';

const S = sensorsJson as unknown as CircuitJson;
const L = loopJson as unknown as CircuitJson;
const T = tankJson as unknown as CircuitJson;
const set = (c: Circuit, part: string, value: number) => c.command({ kind: 'set', part, value });

describe('digital sensors', () => {
  it('PNP sensor switches +24 V to a sinking input', () => {
    const c = new Circuit(S);
    expect(c.status('DI1').inputs?.I0).toBe(false);
    set(c, 'B1', 1);
    expect(c.status('B1').output).toBe(true);
    expect(c.status('DI1').inputs?.I0).toBe(true);
    expect(measure(c, 'B1:BK', 'B1:BU', 'VDC').display).toBe('24.0 V=');
  });
  it('NPN sensor switches 0 V to a sourcing input', () => {
    const c = new Circuit(S);
    set(c, 'B2', 1);
    expect(c.status('DI2').inputs?.I0).toBe(true);
    expect(measure(c, 'B2:BK', 'B2:BU', 'VDC').display).toBe('0.0 V=');
  });
  it('a sensor with no 0 V supply does not switch', () => {
    const c = new Circuit(S, [{ id: 'x', kind: 'wire-open', wire: 'b2', report: '' }]);
    set(c, 'B1', 1);
    expect(c.status('B1').output).toBe(false);
    expect(c.status('DI1').inputs?.I0).toBe(false);
  });
  it('an NPN sensor on a sinking input never turns the input on', () => {
    const def = structuredClone(S);
    def.wires.find((w) => w.id === 'b3')!.a = 'B2:BK';
    const c = new Circuit(def);
    set(c, 'B2', 1);
    expect(c.status('DI1').inputs?.I0).toBe(false);
  });
});

describe('4-20 mA loop', () => {
  it('master case: 12 mA on 0-10 bar = 5 bar, raw 13824', () => {
    const c = new Circuit(L);
    expect(c.status('PT1').mA).toBe(12);
    expect(c.status('AI1')).toMatchObject({ mA: 12, raw: 13824, eng: 5, signal: 'OK' });
    expect(measure(c, 'AI1:+', 'AI1:-', 'VDC').display).toBe('3.0 V='); // 12 mA × 250 Ω
    expect(measure(c, 'PT1:+', 'PT1:-', 'VDC').display).toBe('21.0 V=');
  });
  it('follows the process from 0 to 10 bar', () => {
    const c = new Circuit(L);
    set(c, 'PT1', 0);
    expect(c.status('AI1')).toMatchObject({ mA: 4, raw: 0, eng: 0 });
    set(c, 'PT1', 10);
    expect(c.status('AI1')).toMatchObject({ mA: 20, raw: 27648, eng: 10 });
    set(c, 'PT1', 12);
    expect(c.status('AI1').mA).toBe(20.5); // saturates above range
  });
  it('a broken field wire reads 0 mA and wire break', () => {
    const c = new Circuit(L, [{ id: 'x', kind: 'wire-open', wire: 'f2', report: '' }]);
    expect(c.status('AI1').mA).toBe(0);
    expect(c.status('AI1').signal).toMatch(/WIRE BREAK/);
  });
  it('a high-resistance termination limits the current (compliance)', () => {
    const c = new Circuit(L, [{ id: 'x', kind: 'high-resistance', wire: 'f1', ohms: 600, report: '' }]);
    set(c, 'PT1', 5);
    expect(c.status('AI1').mA).toBe(12); // enough voltage at mid range
    set(c, 'PT1', 10);
    // 24 V − 10 V minimum = 14 V across 850 Ω → about 16.5 mA at most.
    expect(c.status('AI1').mA).toBeCloseTo(16.47, 1);
  });
  it('a short across the transmitter drives the input over range', () => {
    const c = new Circuit(L, [{ id: 'x', kind: 'extra-wire', a: 'PT1:+', b: 'PT1:-', report: '' }]);
    expect(c.status('AI1').mA).toBe(96);
    expect(c.status('AI1').signal).toMatch(/OVER RANGE/);
    expect(c.status('AI1').raw).toBe(32767);
  });
  it('a failed transmitter sends 3.6 mA; wrong scaling misreads', () => {
    expect(new Circuit(L, [{ id: 'x', kind: 'tx-failed', part: 'PT1', report: '' }]).status('AI1').mA).toBe(3.6);
    const c = new Circuit(L, [{ id: 'y', kind: 'config', part: 'AI1', rangeLo: 0, rangeHi: 16, report: '' }]);
    expect(c.status('AI1').eng).toBe(8);
  });
  it('reversed transmitter wiring gives no current', () => {
    const def = structuredClone(L);
    def.wires.find((w) => w.id === 'f1')!.b = 'PT1:-';
    def.wires.find((w) => w.id === 'f2')!.a = 'PT1:+';
    expect(new Circuit(def).status('AI1').mA).toBe(0);
  });
  it('status helpers', () => {
    expect(signalStatus(2)).toMatch(/WIRE BREAK/);
    expect(rawCount(4)).toBe(0);
    expect(rawCount(20)).toBe(27648);
  });
});

describe('tank level template circuit', () => {
  it('two inputs in series share one loop current', () => {
    const c = new Circuit(T);
    expect(c.status('KF1').mA).toBe(12);
    expect(c.status('AI1').eng).toBe(2);
  });
  it('high and low alarms with hysteresis', () => {
    const c = new Circuit(T);
    set(c, 'LT1', 3.6);
    expect(c.status('H1').lit).toBe(true);
    set(c, 'LT1', 3.45);
    expect(c.status('H1').lit).toBe(true); // still above 3.5 − 0.1
    set(c, 'LT1', 3.3);
    expect(c.status('H1').lit).toBe(false);
    set(c, 'LT1', 0.4);
    expect(c.status('H2').lit).toBe(true);
  });
  it('a wire break looks like a low level to the trip amplifier', () => {
    const c = new Circuit(T, [{ id: 'x', kind: 'wire-open', wire: 'l3', report: '' }]);
    expect(c.status('H2').lit).toBe(true);
    expect(c.status('AI1').signal).toMatch(/WIRE BREAK/);
  });
});
