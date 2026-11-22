/** Motor formulas used across lessons and simulators. */

/** Full-load line current of a three-phase motor: I = P / (√3 × V × η × pf). */
export function fullLoadCurrent(kW: number, volts: number, efficiency: number, powerFactor: number): number {
  return (kW * 1000) / (Math.sqrt(3) * volts * efficiency * powerFactor);
}

/** Synchronous speed in rpm: n = 120 × f / poles. */
export function synchronousSpeed(hz: number, poles: number): number {
  return (120 * hz) / poles;
}

/** Star starting: line current and torque are one third of the delta (DOL) values. */
export const STAR_FACTOR = 1 / 3;
export function starStartCurrent(deltaLineCurrent: number): number {
  return deltaLineCurrent * STAR_FACTOR;
}
export function starStartTorque(deltaTorque: number): number {
  return deltaTorque * STAR_FACTOR;
}

/** Phase rotation of the supply seen at U1, V1, W1. */
export type PhaseName = 'L1' | 'L2' | 'L3';
export function rotation(u: PhaseName, v: PhaseName, w: PhaseName): 'forward' | 'reverse' | 'invalid' {
  const seq = `${u}${v}${w}`;
  if (new Set([u, v, w]).size !== 3) return 'invalid';
  return ['L1L2L3', 'L2L3L1', 'L3L1L2'].includes(seq) ? 'forward' : 'reverse';
}
