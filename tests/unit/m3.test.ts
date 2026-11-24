import { describe, expect, it } from 'vitest';
import linksJson from '../../content/circuits/m3-links.json';
import frJson from '../../content/circuits/m3-fwd-rev.json';
import sdJson from '../../content/circuits/m3-star-delta.json';
import ssJson from '../../content/circuits/m3-soft-starter.json';
import { Circuit } from '../../src/engines/wiring/circuit';
import { measure, measureValue } from '../../src/engines/wiring/meter';
import { makeRng } from '../../src/engines/core/rng';
import type { CircuitJson, WireJson } from '../../src/engines/wiring/types';
import { runChecks } from '../../src/engines/wiring/checks';
import { lessonById } from '../../src/content';

const links = linksJson as unknown as CircuitJson;
const fr = frJson as unknown as CircuitJson;
const sd = sdJson as unknown as CircuitJson;
const ss = ssJson as unknown as CircuitJson;
const run = (c: Circuit, ms: number) => {
  for (let t = 0; t < ms; t += 10) c.step(10);
};
const tap = (c: Circuit, part: string) => {
  c.command({ kind: 'press', part });
  c.command({ kind: 'release', part });
};
const flc = 1500 / (Math.sqrt(3) * 400 * 0.82 * 0.8);

describe('6-terminal motor and terminal box links', () => {
  it('star links on a 230 V Δ / 400 V Y motor at 400 V: runs, windings correct', () => {
    const c = new Circuit(links);
    c.command({ kind: 'switch', part: 'Q1', on: true });
    run(c, 2000);
    const m = c.status('M1').motor!;
    expect(m.state).toBe('running');
    expect(m.connection).toBe('correct');
    expect(c.voltage('M1:U1', 'M1:U2').ac).toBeCloseTo(231, 0);
  });
  it('delta links on the same motor: windings over-voltage, current far too high', () => {
    const w: WireJson[] = [...links.wires.filter((x) => !x.id.startsWith('s')), { id: 'd1', a: 'M1:U1', b: 'M1:W2' }, { id: 'd2', a: 'M1:V1', b: 'M1:U2' }, { id: 'd3', a: 'M1:W1', b: 'M1:V2' }];
    const c = new Circuit(links, [], w);
    c.command({ kind: 'switch', part: 'Q1', on: true });
    run(c, 2000);
    const m = c.status('M1').motor!;
    expect(m.connection).toBe('high');
    expect(m.amps).toBeGreaterThan(2 * flc);
  });
  it('no links: no current flows and the motor does not turn', () => {
    const c = new Circuit(links, [], links.wires.filter((x) => !x.id.startsWith('s')));
    c.command({ kind: 'switch', part: 'Q1', on: true });
    run(c, 2000);
    expect(c.status('M1').motor!.state).toBe('stopped');
  });
  it('an open winding stalls the motor', () => {
    const c = new Circuit(links, [{ id: 'f', kind: 'winding-open', part: 'M1', winding: 'V', report: '' }]);
    c.command({ kind: 'switch', part: 'Q1', on: true });
    run(c, 2000);
    expect(c.status('M1').motor!.state).toBe('stalled');
  });
  it('winding resistance: 12 Ω with links off, 24 Ω between line terminals in star', () => {
    const off = new Circuit(links, [], links.wires.filter((x) => !x.id.startsWith('s')));
    off.command({ kind: 'switch', part: 'Q0', on: false });
    expect(measureValue(off, 'M1:U1', 'M1:U2', 'OHM')).toBeCloseTo(12, 1);
    const star = new Circuit(links);
    star.command({ kind: 'switch', part: 'Q0', on: false });
    expect(measureValue(star, 'M1:U1', 'M1:V1', 'OHM')).toBeCloseTo(24, 0);
  });
  it('insulation test: healthy motor reads high, a damaged winding reads low, live test is unsafe', () => {
    const live = new Circuit(links);
    live.command({ kind: 'switch', part: 'Q1', on: true });
    expect(measure(live, 'M1:U1', 'M1:PE', 'IR').unsafe).toBe(true);
    const ok = new Circuit(links);
    ok.command({ kind: 'switch', part: 'Q0', on: false });
    expect(measureValue(ok, 'M1:U1', 'M1:PE', 'IR')!).toBeGreaterThan(100);
    const bad = new Circuit(links, [{ id: 'f', kind: 'insulation', part: 'M1', megohms: 0.4, report: '' }]);
    bad.command({ kind: 'switch', part: 'Q0', on: false });
    expect(measureValue(bad, 'M1:U1', 'M1:PE', 'IR')!).toBeLessThan(1);
    // A multimeter cannot see healthy insulation: it reads OL.
    expect(measure(ok, 'M1:U1', 'M1:PE', 'OHM').display).toMatch(/OL/);
  });
});

describe('forward / reverse', () => {
  it('runs forward and reverse, and the interlock blocks the other direction', () => {
    const c = new Circuit(fr);
    tap(c, 'S1');
    run(c, 2000);
    expect(c.status('M1').motor!).toMatchObject({ state: 'running', direction: 'forward' });
    tap(c, 'S2');
    run(c, 100);
    expect(c.status('KM2').energised).toBe(false);
    expect(c.status('KM1').energised).toBe(true);
    tap(c, 'S0');
    run(c, 3000);
    tap(c, 'S2');
    run(c, 3000);
    expect(c.status('M1').motor!).toMatchObject({ state: 'running', direction: 'reverse' });
  });
  it('without the interlock, both contactors close and Q1 trips on the phase-to-phase short', () => {
    const c = new Circuit(fr, [{ id: 'f', kind: 'contact-closed', part: 'KM1', a: '21', b: '22', report: '' }, { id: 'g', kind: 'contact-closed', part: 'KM2', a: '21', b: '22', report: '' }]);
    tap(c, 'S1');
    run(c, 500);
    c.command({ kind: 'press', part: 'S2' });
    run(c, 100);
    expect(c.status('Q1').tripped).toBe(true);
  });
});

describe('star-delta: master case', () => {
  it('star start current is one third of DOL, then it changes to delta and runs at full current', () => {
    const c = new Circuit(sd);
    tap(c, 'S1');
    run(c, 100);
    const m = c.status('M1').motor!;
    expect(c.status('KM2').energised).toBe(true);
    expect(m.connection).toBe('low');
    const flc55 = 5500 / (Math.sqrt(3) * 400 * 0.88 * 0.84);
    expect(m.amps / flc55).toBeCloseTo(2, 1); // DOL would be 6 × FLC
    run(c, 4500);
    expect(c.status('KM3').energised).toBe(true);
    expect(c.status('KM2').energised).toBe(false);
    expect(c.status('M1').motor!).toMatchObject({ state: 'running', connection: 'correct' });
    run(c, 60000);
    expect(c.status('F2').tripped).toBe(false);
  });
  it('star and delta contactors are never closed together, whatever buttons are pressed', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const rnd = makeRng(seed);
      const c = new Circuit(sd);
      for (let i = 0; i < 400; i++) {
        const r = rnd.next();
        if (r < 0.05) c.command({ kind: 'press', part: 'S1' });
        else if (r < 0.1) c.command({ kind: 'release', part: 'S1' });
        else if (r < 0.13) c.command({ kind: 'press', part: 'S0' });
        else if (r < 0.16) c.command({ kind: 'release', part: 'S0' });
        for (let t = 0; t < 50; t += 10) {
          c.step(10);
          expect(c.status('KM2').energised && c.status('KM3').energised).toBe(false);
        }
      }
      expect(c.status('Q1').tripped).toBe(false);
    }
  });
  it('stuck in star (timer contact 15-16 welded): the overload trips', () => {
    const c = new Circuit(sd, [{ id: 'f', kind: 'contact-closed', part: 'KT', a: '15', b: '16', report: '' }]);
    tap(c, 'S1');
    run(c, 60000);
    expect(c.status('KM3').energised).toBe(false);
    expect(c.status('F2').tripped).toBe(true);
  });
  it('timer contact 17-18 open: star drops out, delta never comes in, the motor coasts to a stop', () => {
    const c = new Circuit(sd, [{ id: 'f', kind: 'contact-open', part: 'KT', a: '17', b: '18', report: '' }]);
    tap(c, 'S1');
    run(c, 6000);
    expect(c.status('KM2').energised).toBe(false);
    expect(c.status('KM3').energised).toBe(false);
    expect(c.status('M1').motor!.state).toBe('coasting');
  });
});

describe('soft starter', () => {
  it('limits starting current and ramps over the set time', () => {
    const c = new Circuit(ss);
    tap(c, 'S1');
    run(c, 1000);
    const m = c.status('M1').motor!;
    expect(m.state).toBe('starting');
    expect(m.amps).toBeLessThanOrEqual(3 * 20.8 + 0.5);
    run(c, 7500);
    expect(c.status('M1').motor!.state).toBe('running');
  });
  it('trips on phase loss', () => {
    const c = new Circuit(ss, [{ id: 'f', kind: 'contact-open', part: 'KM1', a: '5', b: '6', report: '' }]);
    tap(c, 'S1');
    run(c, 2000);
    expect(c.status('SS1').mode).toMatch(/FAULT/);
    expect(c.status('M1').motor!.state).not.toBe('running');
  });
});

describe('interlocks are really needed (contactor release time)', () => {
  const checksOf = (id: string) => (lessonById(id)!.build as unknown as { checks: never[] }).checks;
  it('star-delta wired without the KM2/KM3 interlocks fails: star and delta overlap at changeover', () => {
    const w: WireJson[] = [...sd.wires.filter((x) => !['c14', 'c15', 'c16', 'c17'].includes(x.id)), { id: 'n1', a: 'KT:16', b: 'KM2:A1' }, { id: 'n2', a: 'KT:18', b: 'KM3:A1' }];
    const r = runChecks(sd, w, checksOf('m3-l4'));
    expect(r.passed).toBe(false);
    expect(r.failures[0]).toMatch(/both energised|at the same time/);
  });
  it('the correct star-delta passes, so the interlock contacts make the difference', () => {
    expect(runChecks(sd, sd.wires, checksOf('m3-l4')).passed).toBe(true);
  });
  it('forward/reverse wired without interlocks fails the checks', () => {
    const w: WireJson[] = [...fr.wires.filter((x) => !['c10', 'c11', 'c16', 'c17'].includes(x.id)), { id: 'n1', a: 'S1:14', b: 'KM1:A1' }, { id: 'n2', a: 'S2:14', b: 'KM2:A1' }];
    expect(runChecks(fr, w, checksOf('m3-l3')).passed).toBe(false);
  });
});
