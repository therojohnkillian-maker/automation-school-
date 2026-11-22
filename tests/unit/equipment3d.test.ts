import { describe, expect, it } from 'vitest';
import dolJson from '../../content/circuits/dol-starter.json';
import { buildEquipment } from '../../src/features/equipment3d/models';
import { Circuit, PART_TERMINALS } from '../../src/engines/wiring/circuit';
import type { CircuitJson, PartStatus } from '../../src/engines/wiring/types';

const dol = dolJson as unknown as CircuitJson;
const statusMap = (c: Circuit) => new Map<string, PartStatus>(c.allStatus().map((s) => [s.id, s]));
const run = (c: Circuit, ms: number) => {
  for (let t = 0; t < ms; t += 10) c.step(10);
};

describe('3D equipment model', () => {
  it('every 3D terminal with a reference is a real terminal in the simulator', () => {
    const m = buildEquipment({ overloadSetting: 4.6 });
    for (const t of m.terminals.filter((x) => x.ref)) {
      const [pid, term] = t.ref!.split(':');
      const part = dol.parts.find((p) => p.id === pid);
      expect(part, t.ref!).toBeTruthy();
      expect(PART_TERMINALS[part!.type]).toContain(term);
    }
  });

  it('shows every wired terminal of the modelled devices (except the KM1 2/4/6 to F2 1/3/5 plug-in joint)', () => {
    const m = buildEquipment({ overloadSetting: 4.6 });
    const refs = new Set(m.terminals.map((t) => t.ref));
    const modelled = ['Q1', 'KM1', 'F2', 'S1', 'S2', 'H1', 'H2', 'M1'];
    for (const w of dol.wires) {
      for (const end of [w.a, w.b]) {
        if (!modelled.includes(end.split(':')[0])) continue;
        if (['F2:1', 'F2:3', 'F2:5', 'KM1:2', 'KM1:4', 'KM1:6'].includes(end)) continue;
        expect(refs.has(end), `${end} missing in 3D`).toBe(true);
      }
    }
  });

  it('follows the simulator: handle, contactor flag, lamps, trip flag and shaft', () => {
    const c = new Circuit(dol);
    const m = buildEquipment({ overloadSetting: 4.6 });
    m.update(statusMap(c));
    expect(m.probe()).toMatchObject({ handleDeg: 0, flagX: -0.45, h1Lit: false, shaftRevPerSec: 0 });
    c.command({ kind: 'press', part: 'S2' });
    m.update(statusMap(c));
    expect(m.probe().s2Depth).toBeGreaterThan(0);
    c.command({ kind: 'release', part: 'S2' });
    run(c, 2000);
    m.update(statusMap(c));
    expect(m.probe()).toMatchObject({ flagX: 0.45, h1Lit: true, s2Depth: 0 });
    expect(m.probe().shaftRevPerSec).toBeCloseTo(1.2);
    expect(m.tick(0.1)).toBe(true);
    c.command({ kind: 'trip-test', part: 'F2' });
    m.update(statusMap(c));
    expect(m.probe()).toMatchObject({ flagX: -0.45, h2Lit: true, tripFlagY: 0.55 });
    c.command({ kind: 'switch', part: 'Q1', on: false });
    m.update(statusMap(c));
    expect(m.probe().handleDeg).toBe(-90);
  });

  it('a reversed motor turns the other way', () => {
    const def = structuredClone(dol);
    def.wires.find((w) => w.id === 'p10')!.b = 'M1:V1';
    def.wires.find((w) => w.id === 'p11')!.b = 'M1:U1';
    const c = new Circuit(def);
    c.command({ kind: 'press', part: 'S2' });
    c.command({ kind: 'release', part: 'S2' });
    run(c, 2000);
    const m = buildEquipment({ overloadSetting: 4.6 });
    m.update(statusMap(c));
    expect(m.probe().shaftRevPerSec).toBeLessThan(0);
  });

  it('the overload dial points at its setting', () => {
    expect(buildEquipment({ overloadSetting: 4 }).probe().dialDeg).toBe(-120);
    expect(buildEquipment({ overloadSetting: 6.3 }).probe().dialDeg).toBeCloseTo(120);
  });
});
