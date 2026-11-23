import { describe, expect, it } from 'vitest';
import measureJson from '../../content/circuits/m1-measure.json';
import termJson from '../../content/circuits/m1-terminals.json';
import { Circuit, terminalsOf } from '../../src/engines/wiring/circuit';
import { measure } from '../../src/engines/wiring/meter';
import type { CircuitJson } from '../../src/engines/wiring/types';

const m = measureJson as unknown as CircuitJson;
const t = termJson as unknown as CircuitJson;

describe('M1 circuits', () => {
  it('terminal strips are numbered 1..count', () => {
    expect(terminalsOf(t.parts.find((p) => p.id === 'X1')!)).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('measurement circuit: supply, 24 V, open switch voltage, lamp', () => {
    const c = new Circuit(m);
    expect(measure(c, 'SUP:L1', 'SUP:L2', 'VAC').display).toBe('400 V~');
    expect(measure(c, 'SUP:N', 'SUP:PE', 'VAC').display).toBe('0 V~');
    expect(measure(c, 'G1:P', 'G1:M', 'VDC').display).toBe('24.0 V=');
    expect(measure(c, 'S1:13', 'S1:14', 'VDC').display).toBe('24.0 V='); // full voltage across an open switch
    expect(c.status('H1').lit).toBe(false);
    c.command({ kind: 'switch', part: 'S1', on: true });
    expect(c.status('H1').lit).toBe(true);
    expect(measure(c, 'S1:13', 'S1:14', 'VDC').display).toBe('0.0 V=');
  });

  it('resistance of R1 and the lamp, only when isolated', () => {
    const c = new Circuit(m);
    expect(measure(c, 'R1:1', 'R1:2', 'OHM').unsafe).toBe(true);
    c.command({ kind: 'switch', part: 'F1', on: false });
    expect(measure(c, 'R1:1', 'R1:2', 'OHM').display).toBe('470.0 Ω');
    expect(measure(c, 'H1:X1', 'H1:X2', 'OHM').display).toBe('576.0 Ω');
    c.command({ kind: 'switch', part: 'S1', on: true });
    expect(measure(c, 'R1:1', 'R1:2', 'OHM').display).toBe('258.8 Ω'); // R1 in parallel with the lamp
  });

  it('an open lamp filament stops the lamp and reads open', () => {
    const c = new Circuit(m, [{ id: 'x', kind: 'load-open', part: 'H1', report: '' }]);
    c.command({ kind: 'switch', part: 'S1', on: true });
    expect(c.status('H1').lit).toBe(false);
    expect(measure(c, 'H1:X1', 'H1:X2', 'VDC').display).toBe('24.0 V=');
  });

  it('terminal circuit: selector pulls in K1 and lights the field lamp', () => {
    const c = new Circuit(t);
    expect(c.status('K1').energised).toBe(false);
    c.command({ kind: 'switch', part: 'S1', on: true });
    expect(c.status('K1').energised).toBe(true);
    expect(c.status('H1').lit).toBe(true);
    expect(measure(c, 'X1:2', 'X1:4', 'VDC').display).toBe('24.0 V=');
  });
});
