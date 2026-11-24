import type { Circuit } from '../engines/wiring/circuit';
import { measure, type MeterMode } from '../engines/wiring/meter';

export interface ProbeState {
  red: string | null;
  black: string | null;
  next: 'red' | 'black';
  mode: MeterMode;
}

export const emptyProbes: ProbeState = { red: null, black: null, next: 'red', mode: 'VAC' };

/** Places the active probe on a terminal and moves to the other probe. */
export function placeProbe(p: ProbeState, ref: string): ProbeState {
  return p.next === 'red' ? { ...p, red: ref, next: 'black' } : { ...p, black: ref, next: 'red' };
}

/** `withIR` adds the 500 V insulation resistance tester range (M3 onwards). */
export function Meter({ circuit, probes, onChange, version: _v, withIR = !!circuit.def.irTester }: { circuit: Circuit; probes: ProbeState; onChange: (p: ProbeState) => void; version: number; withIR?: boolean }) {
  const reading = probes.red && probes.black ? measure(circuit, probes.red, probes.black, probes.mode) : null;
  const modes: { id: MeterMode; label: string; aria: string }[] = [
    { id: 'VAC', label: 'V~', aria: 'AC volts' },
    { id: 'VDC', label: 'V=', aria: 'DC volts' },
    { id: 'OHM', label: 'Ω', aria: 'Resistance' },
    ...(withIR ? [{ id: 'IR' as MeterMode, label: 'IR 500 V', aria: 'Insulation test 500 volts' }] : []),
  ];
  return (
    <div className="meter" aria-label="Multimeter">
      <div className={`lcd ${reading?.unsafe ? 'lcd-danger' : ''}`} aria-live="polite" data-testid="meter-reading">
        {reading ? reading.display : 'Place both probes'}
      </div>
      <div className="seg" role="group" aria-label="Meter mode">
        {modes.map((m) => (
          <button key={m.id} type="button" aria-pressed={probes.mode === m.id} aria-label={m.aria} className={probes.mode === m.id ? 'on' : ''} onClick={() => onChange({ ...probes, mode: m.id })}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="probes">
        <button type="button" className={`probe red ${probes.next === 'red' ? 'next' : ''}`} onClick={() => onChange({ ...probes, next: 'red' })}>
          <span aria-hidden="true">●</span> Red: {probes.red ?? '—'}
        </button>
        <button type="button" className={`probe black ${probes.next === 'black' ? 'next' : ''}`} onClick={() => onChange({ ...probes, next: 'black' })}>
          <span aria-hidden="true">●</span> Black: {probes.black ?? '—'}
        </button>
      </div>
      <p className="hint">Tap a terminal to place the {probes.next} probe.</p>
    </div>
  );
}
