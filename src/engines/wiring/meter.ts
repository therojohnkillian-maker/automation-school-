import type { Circuit } from './circuit';

export type MeterMode = 'VAC' | 'VDC' | 'OHM';

export interface Reading {
  display: string;
  /** True if this measurement was a resistance test on a live circuit. */
  unsafe: boolean;
}

/**
 * A true-RMS multimeter with GS38-style probes.
 * V~ shows the AC part only, V= the DC part only, so the wrong mode reads about zero, as on a real meter.
 * Ω refuses to give a reading on a live circuit and records a safety event.
 */
export function measure(c: Circuit, red: string, black: string, mode: MeterMode): Reading {
  if (mode === 'OHM') {
    const r = c.resistance(red, black);
    if (r.live) return { display: 'LIVE! Ω test not allowed', unsafe: true };
    if (r.ohms === null) return { display: 'OL (open)', unsafe: false };
    if (r.ohms < 0.05) return { display: '0.0 Ω', unsafe: false };
    return { display: r.ohms < 1000 ? `${r.ohms.toFixed(1)} Ω` : `${(r.ohms / 1000).toFixed(2)} kΩ`, unsafe: false };
  }
  const v = c.voltage(red, black);
  if (mode === 'VAC') return { display: `${Math.round(v.ac)} V~`, unsafe: false };
  return { display: `${v.dc.toFixed(1)} V=`, unsafe: false };
}

/**
 * Two-pole voltage indicator (the tester used to prove dead). No modes: it shows any AC or DC voltage present.
 * A faulty tester shows nothing, which is why it must be proved before and after use.
 */
export function indicate(c: Circuit, a: string, b: string, testerWorks: boolean): { volts: number; display: string } {
  if (!testerWorks) return { volts: 0, display: 'No indication' };
  const v = c.voltage(a, b);
  const volts = Math.max(Math.round(v.ac), Math.round(Math.abs(v.dc)));
  if (volts < 12) return { volts: 0, display: 'No indication' };
  // Indicators show voltage bands, not exact values.
  const band = [12, 24, 50, 120, 230, 400, 690].reduce((best, b) => (volts >= b * 0.85 ? b : best), 12);
  return { volts, display: `${band} V ${v.ac >= Math.abs(v.dc) ? '~' : '='} lit` };
}
