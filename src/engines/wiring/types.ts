/** Data shapes for circuits. Circuits are content (JSON), the engine never hard-codes a circuit. */

export type PartType =
  | 'supply3'
  | 'isolator3'
  | 'mpcb3'
  | 'mcb2'
  | 'psu24'
  | 'contactor'
  | 'overload'
  | 'pb_no'
  | 'pb_nc'
  | 'lamp24'
  | 'motor3';

export interface PartJson {
  id: string;
  type: PartType;
  /** Shown on the drawing, e.g. "KM1 Main contactor". */
  label: string;
  /** Where each terminal is drawn. Terminals without a position exist but cannot be wired. */
  pins: Record<string, [number, number]>;
  labelAt?: [number, number];
  params?: {
    kW?: number;
    volts?: number;
    efficiency?: number;
    powerFactor?: number;
    poles?: number;
    hz?: number;
    ratedRpm?: number;
    windingOhms?: number;
    /** Overload current setting in amps. */
    setting?: number;
    /** Plant tag shown on isolators, e.g. "P-101 PUMP". */
    tag?: string;
  };
  init?: { on?: boolean; tripped?: boolean };
}

export interface WireJson {
  id: string;
  a: string; // "PART:TERMINAL"
  b: string;
  /** Optional y level for the horizontal run of the wire, for a tidy drawing. */
  route?: number;
  /** Optional corner points for a hand-drawn route (content wires only). */
  via?: [number, number][];
}

export interface CircuitJson {
  id: string;
  version: string;
  title: string;
  size: [number, number];
  parts: PartJson[];
  wires: WireJson[];
  /** Free text drawn on the canvas, e.g. "Power circuit". */
  notes?: { at: [number, number]; text: string }[];
}

export type FaultJson =
  | { id: string; kind: 'wire-open'; wire: string; report: string }
  | { id: string; kind: 'wire-moved'; wire: string; end: 'a' | 'b'; to: string; report: string }
  | { id: string; kind: 'contact-open'; part: string; a: string; b: string; report: string }
  | { id: string; kind: 'contact-closed'; part: string; a: string; b: string; report: string }
  | { id: string; kind: 'coil-open'; part: string; report: string }
  | { id: string; kind: 'labels-swapped'; parts: [string, string]; report: string }
  | { id: string; kind: 'tester-faulty'; report: string };

export type Command =
  | { kind: 'press'; part: string }
  | { kind: 'release'; part: string }
  | { kind: 'switch'; part: string; on: boolean }
  | { kind: 'trip-test'; part: string }
  | { kind: 'reset'; part: string }
  | { kind: 'lock'; part: string }
  | { kind: 'unlock'; part: string };

export type MotorState = 'stopped' | 'starting' | 'running' | 'stalled' | 'single-phasing' | 'coasting';

export interface PartStatus {
  id: string;
  type: PartType;
  label: string;
  on?: boolean;
  tripped?: boolean;
  locked?: boolean;
  pressed?: boolean;
  energised?: boolean;
  lit?: boolean;
  psuOn?: boolean;
  burnt?: boolean;
  motor?: { state: MotorState; rpm: number; amps: number; direction: 'forward' | 'reverse' | null };
  thermalPct?: number;
}

export interface LogEntry {
  t: number; // ms of simulated time
  text: string;
}

export interface SafetyEvent {
  t: number;
  critical: boolean;
  text: string;
}
