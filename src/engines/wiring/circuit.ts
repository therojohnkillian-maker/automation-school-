/**
 * Circuit simulator. Calculates behaviour from what the learner wired; nothing is scripted.
 *
 * Each solve:
 *  1. Joins terminals that are connected by wires or closed contacts into nodes (union-find).
 *  2. Gives source nodes their potential (L1, L2, L3, N, PE, +24 V, 0 V).
 *  3. If a node touches two different potentials, that is a short: the nearest protective device trips.
 *  4. Works out every other node's potential through loads (coils, lamps, motor windings) by nodal analysis,
 *     so back-feed through windings and open neutrals read like they do on a real meter.
 *  5. Energises coils, updates contacts, and repeats until nothing changes.
 *
 * Simplifications (documented for learners in docs/SIMULATORS.md):
 *  ideal sources, no voltage drop or transients, contacts are fully open or closed, cable length ignored,
 *  MPCB/MCB trip only on short circuit, N-PE faults do not trip an RCD.
 */
import { solveLinear, UnionFind } from '../core/linear';
import { fullLoadCurrent, rotation, synchronousSpeed, type PhaseName } from '../motor/calc';
import type {
  CircuitJson,
  Command,
  FaultJson,
  LogEntry,
  MotorState,
  PartJson,
  PartStatus,
  PartType,
  SafetyEvent,
  WireJson,
} from './types';

type Source = 'L1' | 'L2' | 'L3' | 'N' | 'PE' | 'P24' | 'M0V';
export interface Pot {
  re: number;
  im: number;
  dc: number;
}

/** UK nominal 230/400 V: phase magnitude chosen so line-to-line is exactly 400 V. */
const VPH = 400 / Math.sqrt(3);
const ang = (deg: number): Pot => ({ re: VPH * Math.cos((deg * Math.PI) / 180), im: VPH * Math.sin((deg * Math.PI) / 180), dc: 0 });
const ZERO: Pot = { re: 0, im: 0, dc: 0 };
export const SOURCE_POT: Record<Source, Pot> = {
  L1: ang(0),
  L2: ang(-120),
  L3: ang(120),
  N: ZERO,
  PE: ZERO,
  P24: { re: 0, im: 0, dc: 24 },
  M0V: ZERO,
};

export const PART_TERMINALS: Record<PartType, string[]> = {
  supply3: ['L1', 'L2', 'L3', 'N', 'PE'],
  isolator3: ['1', '2', '3', '4', '5', '6'],
  mpcb3: ['1', '2', '3', '4', '5', '6'],
  mcb2: ['1', '2', '3', '4'],
  psu24: ['L', 'N', 'P', 'M'],
  contactor: ['A1', 'A2', '1', '2', '3', '4', '5', '6', '13', '14', '21', '22', '43', '44'],
  overload: ['1', '2', '3', '4', '5', '6', '95', '96', '97', '98'],
  pb_no: ['13', '14'],
  pb_nc: ['11', '12'],
  lamp24: ['X1', 'X2'],
  motor3: ['U1', 'V1', 'W1', 'PE'],
  resistor: ['1', '2'],
  sw_no: ['13', '14'],
  tstrip: [], // named 1..count, see terminalsOf
  tx2w: ['+', '-'],
  ai: ['+', '-'],
  trip: ['+', '-', '13', '14', '23', '24'],
  prox_pnp: ['BN', 'BU', 'BK'],
  prox_npn: ['BN', 'BU', 'BK'],
  di: ['I0', 'I1', 'M'],
};

/** The terminals a part has. Terminal strips are numbered 1..count. */
export function terminalsOf(p: PartJson): string[] {
  if (p.type === 'tstrip') return Array.from({ length: p.params?.count ?? 0 }, (_, i) => String(i + 1));
  return PART_TERMINALS[p.type];
}

const COIL_OHMS = 120; // 24 V DC coil, about 5 W
const LAMP_OHMS = 576; // 24 V, 1 W
const PICK_UP_V = 20; // 85 % of 24 V
const DROP_OUT_V = 10;
const LIVE_V = 12; // above this a node counts as live for safety checks
const START_MULTIPLE = 6; // VERIFY: typical DOL starting current multiple
const STALL_TWO_PHASE_MULTIPLE = 5;
const SINGLE_PHASING_MULTIPLE = 1.73;
const ACCEL_MS = 1200;
const OL_TAU_MS = 100_000; // VERIFY: simplified Class 10 thermal model
const OL_TRIP = 1.44; // trips above about 1.2 × setting
const OL_RESET_BELOW = 1.0;
const AI_OHMS = 250; // analog input / trip amplifier input resistance
const DI_OHMS = 3000; // digital input, about 8 mA at 24 V
const PROX_OHMS = 2400; // sensor supply consumption, about 10 mA
const DI_ON_V = 15; // IEC 61131-2 type 1 style: ON above 15 V (VERIFY)
const PROX_MIN_V = 18;
const NAMUR_LOW = 3.8; // VERIFY: NE 43 saturation limits
const NAMUR_HIGH = 20.5;
const TX_FAIL_MA = 3.6;
export const RAW_SPAN = 27648;

/** Signal status text for a loop current, using NAMUR NE 43 style limits (VERIFY). */
export function signalStatus(mA: number): string {
  if (mA < 3.6) return 'WIRE BREAK / FAULT (below 3.6 mA)';
  if (mA < 3.8) return 'BELOW RANGE';
  if (mA > 21) return 'FAULT / OVER RANGE (above 21 mA)';
  if (mA > 20.5) return 'ABOVE RANGE';
  return 'OK';
}

/** Siemens-style raw count: 4 mA = 0, 20 mA = 27648. Outside the module's limits it reports 32767 (VERIFY). */
export function rawCount(mA: number): number {
  const raw = Math.round(((mA - 4) / 16) * RAW_SPAN);
  return raw > 32511 || raw < -4864 ? 32767 : raw;
}

interface Runtime {
  def: PartJson;
  on: boolean;
  tripped: boolean;
  locked: boolean;
  pressed: boolean;
  energised: boolean;
  psuOn: boolean;
  burnt: boolean;
  thermal: number;
  motor: { state: MotorState; rpm: number; amps: number; direction: 'forward' | 'reverse' | null };
  value: number;
  loopA: number;
  relays: { hi: boolean; lo: boolean };
  config?: { rangeLo: number; rangeHi: number };
}

interface Analysis {
  uf: UnionFind;
  nodeSrc: Map<string, Source[]>;
  conflicts: string[];
  pots: Map<string, Pot | undefined>;
}

const key = (part: string, term: string) => `${part}:${term}`;
const potEq = (a: Pot, b: Pot) => Math.abs(a.re - b.re) < 1e-6 && Math.abs(a.im - b.im) < 1e-6 && Math.abs(a.dc - b.dc) < 1e-6;

export class Circuit {
  readonly def: CircuitJson;
  readonly faults: FaultJson[];
  wires: WireJson[];
  parts = new Map<string, Runtime>();
  t = 0;
  log: LogEntry[] = [];
  safety: SafetyEvent[] = [];
  unstable = false;
  supplyFault = false;
  private wireSeq = 1;
  private cache: Analysis | null = null;

  constructor(def: CircuitJson, faults: FaultJson[] = [], wires?: WireJson[]) {
    this.def = def;
    this.faults = faults;
    this.wires = (wires ?? def.wires).map((w) => ({ ...w }));
    for (const f of faults) {
      if (f.kind === 'wire-moved') {
        const w = this.wires.find((x) => x.id === f.wire);
        if (w) w[f.end] = f.to;
      }
    }
    for (const p of def.parts) {
      this.parts.set(p.id, {
        def: p,
        on: p.init?.on ?? false,
        tripped: p.init?.tripped ?? false,
        locked: false,
        pressed: false,
        energised: false,
        psuOn: false,
        burnt: false,
        thermal: 0,
        motor: { state: 'stopped', rpm: 0, amps: 0, direction: null },
        value: p.init?.value ?? 0,
        loopA: 0,
        relays: { hi: false, lo: false },
      });
    }
    for (const f of faults) {
      if (f.kind === 'config') {
        const rt = this.parts.get(f.part);
        if (rt) rt.config = { rangeLo: f.rangeLo, rangeHi: f.rangeHi };
      }
    }
    this.solve(true);
  }

  // ---------------- wiring edits (Build step) ----------------

  hasTerminal(ref: string): boolean {
    const [pid, term] = ref.split(':');
    const p = this.parts.get(pid);
    return !!p && terminalsOf(p.def).includes(term);
  }

  addWire(a: string, b: string): WireJson | null {
    if (a === b || !this.hasTerminal(a) || !this.hasTerminal(b)) return null;
    if (this.wires.some((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a))) return null;
    let id = `u${this.wireSeq++}`;
    while (this.wires.some((w) => w.id === id)) id = `u${this.wireSeq++}`;
    const w = { id, a, b };
    this.wires.push(w);
    this.solve();
    return w;
  }

  removeWire(id: string) {
    this.wires = this.wires.filter((w) => w.id !== id);
    this.solve();
  }

  // ---------------- labels (for the labels-swapped fault) ----------------

  tagOf(partId: string): string | undefined {
    const swap = this.faults.find((f) => f.kind === 'labels-swapped') as Extract<FaultJson, { kind: 'labels-swapped' }> | undefined;
    if (swap && swap.parts.includes(partId)) {
      const other = swap.parts[0] === partId ? swap.parts[1] : swap.parts[0];
      return this.parts.get(other)?.def.params?.tag;
    }
    return this.parts.get(partId)?.def.params?.tag;
  }

  // ---------------- commands ----------------

  command(cmd: Command) {
    const p = this.parts.get(cmd.part);
    if (!p) return;
    const name = cmd.part;
    switch (cmd.kind) {
      case 'press':
        if (p.def.type === 'pb_no' || p.def.type === 'pb_nc') p.pressed = true;
        break;
      case 'release':
        if (p.def.type === 'pb_no' || p.def.type === 'pb_nc') p.pressed = false;
        break;
      case 'switch':
        if (p.def.type === 'isolator3' && cmd.on && p.locked) {
          this.note(`${name} is locked off. Remove the lock before switching on.`);
          return;
        }
        if (p.def.type === 'sw_no') {
          p.on = cmd.on;
          this.note(`${name} switched ${cmd.on ? 'on' : 'off'}.`);
          break;
        }
        if (['isolator3', 'mpcb3', 'mcb2'].includes(p.def.type)) {
          if (cmd.on && p.tripped) this.note(`${name} reset and switched on.`);
          else this.note(`${name} switched ${cmd.on ? 'on' : 'off'}.`);
          p.on = cmd.on;
          if (cmd.on) p.tripped = false;
        }
        break;
      case 'lock':
        if (p.def.type !== 'isolator3') return;
        if (p.on) {
          this.note(`${name} must be switched off before it can be locked.`);
          return;
        }
        p.locked = true;
        this.note(`${name} locked off and tagged.`);
        break;
      case 'unlock':
        if (p.def.type !== 'isolator3') return;
        p.locked = false;
        this.note(`${name} lock removed.`);
        break;
      case 'set':
        if (p.def.type === 'tx2w') {
          const lo = p.def.params?.rangeLo ?? 0;
          const hi = p.def.params?.rangeHi ?? 100;
          p.value = Math.min(hi + (hi - lo) * 0.1, Math.max(lo - (hi - lo) * 0.1, cmd.value));
          this.note(`${name} process value set to ${round2(p.value)} ${p.def.params?.unit ?? ''}.`);
        } else if (p.def.type === 'prox_pnp' || p.def.type === 'prox_npn') {
          p.value = cmd.value ? 1 : 0;
          this.note(`${name}: target ${p.value ? 'in front of the sensor' : 'moved away'}.`);
        }
        break;
      case 'config':
        if (p.def.type === 'ai' || p.def.type === 'trip') {
          p.config = { rangeLo: cmd.rangeLo, rangeHi: cmd.rangeHi };
          this.note(`${name} scaling set: 4 mA = ${cmd.rangeLo}, 20 mA = ${cmd.rangeHi} ${p.def.params?.unit ?? ''}.`);
        }
        break;
      case 'trip-test':
        if (p.def.type === 'overload' || p.def.type === 'mpcb3') {
          if (!p.tripped) {
            p.tripped = true;
            this.note(`${name} tripped (test).`);
          }
        }
        break;
      case 'reset':
        if (p.def.type === 'overload') {
          if (!p.tripped) return;
          if (p.thermal >= OL_RESET_BELOW) {
            this.note(`${name} cannot be reset yet: it is still too hot. Let it cool.`);
            return;
          }
          p.tripped = false;
          this.note(`${name} reset.`);
        } else if (p.def.type === 'supply3') {
          this.supplyFault = false;
          this.note('Supply restored.');
        }
        break;
    }
    this.solve();
  }

  // ---------------- topology ----------------

  private faultSet(kind: 'contact-open' | 'contact-closed') {
    const s = new Set<string>();
    for (const f of this.faults) {
      if (f.kind === kind) {
        s.add(`${f.part}:${f.a}-${f.b}`);
        s.add(`${f.part}:${f.b}-${f.a}`);
      }
    }
    return s;
  }

  private coilOpen(id: string) {
    return this.faults.some((f) => (f.kind === 'coil-open' || f.kind === 'load-open') && f.part === id);
  }

  private links(): [string, string][] {
    const out: [string, string][] = [];
    const open = new Set(this.faults.filter((f) => f.kind === 'wire-open' || f.kind === 'high-resistance').map((f) => (f as { wire: string }).wire));
    for (const w of this.wires) if (!open.has(w.id)) out.push([w.a, w.b]);
    for (const f of this.faults) if (f.kind === 'extra-wire') out.push([f.a, f.b]); // a hidden short or stray link
    const stuckOpen = this.faultSet('contact-open');
    const stuckClosed = this.faultSet('contact-closed');
    for (const [id, p] of this.parts) {
      const pairs: [string, string][] = [];
      const all: [string, string][] = [];
      const t = p.def.type;
      const add = (closed: boolean, ...ps: [string, string][]) => {
        for (const pr of ps) {
          all.push(pr);
          if (closed) pairs.push(pr);
        }
      };
      if (t === 'isolator3' || t === 'mpcb3') add(p.on && !p.tripped, ['1', '2'], ['3', '4'], ['5', '6']);
      else if (t === 'mcb2') add(p.on && !p.tripped, ['1', '2'], ['3', '4']);
      else if (t === 'contactor') {
        add(p.energised, ['1', '2'], ['3', '4'], ['5', '6'], ['13', '14'], ['43', '44']);
        add(!p.energised, ['21', '22']);
      } else if (t === 'overload') {
        add(true, ['1', '2'], ['3', '4'], ['5', '6']);
        add(!p.tripped, ['95', '96']);
        add(p.tripped, ['97', '98']);
      } else if (t === 'pb_no') add(p.pressed, ['13', '14']);
      else if (t === 'pb_nc') add(!p.pressed, ['11', '12']);
      else if (t === 'sw_no') add(p.on, ['13', '14']);
      else if (t === 'prox_pnp') add(p.energised, ['BN', 'BK']);
      else if (t === 'prox_npn') add(p.energised, ['BK', 'BU']);
      else if (t === 'trip') {
        add(p.relays.hi, ['13', '14']);
        add(p.relays.lo, ['23', '24']);
      }
      for (const [a, b] of all) {
        const k = `${id}:${a}-${b}`;
        const closed = (pairs.some(([x, y]) => x === a && y === b) && !stuckOpen.has(k)) || stuckClosed.has(k);
        if (closed) out.push([key(id, a), key(id, b)]);
      }
    }
    return out;
  }

  /** Loads conduct for potential and resistance purposes: [termA, termB, ohms]. */
  private loads(): [string, string, number][] {
    const out: [string, string, number][] = [];
    for (const [id, p] of this.parts) {
      if (p.def.type === 'contactor' && !p.burnt && !this.coilOpen(id)) out.push([key(id, 'A1'), key(id, 'A2'), COIL_OHMS]);
      if (p.def.type === 'lamp24' && !p.burnt && !this.coilOpen(id)) out.push([key(id, 'X1'), key(id, 'X2'), LAMP_OHMS]);
      if (p.def.type === 'resistor' && !this.coilOpen(id)) out.push([key(id, '1'), key(id, '2'), p.def.params?.ohms ?? 1000]);
      if (p.def.type === 'ai' || p.def.type === 'trip') out.push([key(id, '+'), key(id, '-'), AI_OHMS]);
      if (p.def.type === 'di') out.push([key(id, 'I0'), key(id, 'M'), DI_OHMS], [key(id, 'I1'), key(id, 'M'), DI_OHMS]);
      if (p.def.type === 'prox_pnp' || p.def.type === 'prox_npn') out.push([key(id, 'BN'), key(id, 'BU'), PROX_OHMS]);
      if (p.def.type === 'motor3') {
        const r = p.def.params?.windingOhms ?? 6;
        out.push([key(id, 'U1'), key(id, 'V1'), r], [key(id, 'V1'), key(id, 'W1'), r], [key(id, 'W1'), key(id, 'U1'), r]);
      }
    }
    for (const f of this.faults) {
      if (f.kind === 'high-resistance') {
        const w = this.wires.find((x) => x.id === f.wire);
        if (w) out.push([w.a, w.b, f.ohms]); // a corroded or loose termination
      }
    }
    return out;
  }

  /** Set current of each loop-powered transmitter, in amps. */
  private txSetpoint(p: Runtime): number {
    if (this.faults.some((f) => f.kind === 'tx-failed' && f.part === p.def.id)) return TX_FAIL_MA / 1000;
    const lo = p.def.params?.rangeLo ?? 0;
    const hi = p.def.params?.rangeHi ?? 100;
    const mA = 4 + (16 * (p.value - lo)) / (hi - lo);
    return Math.min(NAMUR_HIGH, Math.max(NAMUR_LOW, mA)) / 1000;
  }

  private analyse(): Analysis {
    const uf = new UnionFind();
    for (const [id, p] of this.parts) for (const t of terminalsOf(p.def)) uf.find(key(id, t));
    for (const [a, b] of this.links()) uf.union(a, b);

    const nodeSrc = new Map<string, Source[]>();
    const addSrc = (term: string, s: Source) => {
      const r = uf.find(term);
      const list = nodeSrc.get(r) ?? [];
      list.push(s);
      nodeSrc.set(r, list);
    };
    for (const [id, p] of this.parts) {
      if (p.def.type === 'supply3' && !this.supplyFault) for (const s of ['L1', 'L2', 'L3', 'N', 'PE'] as Source[]) addSrc(key(id, s), s);
      if (p.def.type === 'psu24' && p.psuOn && !p.tripped) {
        addSrc(key(id, 'P'), 'P24');
        addSrc(key(id, 'M'), 'M0V');
      }
    }
    const conflicts: string[] = [];
    for (const [r, list] of nodeSrc) {
      const first = SOURCE_POT[list[0]];
      if (list.some((s) => !potEq(SOURCE_POT[s], first))) conflicts.push(r);
    }
    const pots = conflicts.length ? new Map<string, Pot | undefined>() : this.nodal(uf, nodeSrc);
    return { uf, nodeSrc, conflicts, pots };
  }

  /** Potentials of every node. Nodes with no path to a source are floating (undefined). */
  private nodal(uf: UnionFind, nodeSrc: Map<string, Source[]>): Map<string, Pot | undefined> {
    // Loop-powered transmitters are current sources that need a minimum voltage (compliance).
    const txs = [...this.parts.values()].filter((p) => p.def.type === 'tx2w');
    if (!txs.length) return this.nodalWith(uf, nodeSrc, []) ?? this.nodalWith(uf, nodeSrc, [], true)!;
    const term = (p: Runtime, t: string) => uf.find(key(p.def.id, t));
    const vtx = (pots: Map<string, Pot | undefined> | null, p: Runtime) => {
      const a = pots?.get(term(p, '+'));
      const b = pots?.get(term(p, '-'));
      return a && b ? a.dc - b.dc : undefined;
    };
    const zero = this.nodalWith(uf, nodeSrc, [])!;
    const amps = txs.map((p) => {
      const v0 = vtx(zero, p);
      return v0 !== undefined && v0 >= (p.def.params?.minVolts ?? 10) ? this.txSetpoint(p) : 0;
    });
    const src = () => txs.map((p, i) => [term(p, '+'), term(p, '-'), amps[i]] as [string, string, number]);
    let full = this.nodalWith(uf, nodeSrc, src());
    if (!full) {
      amps.fill(0);
      full = zero;
    }
    txs.forEach((p, i) => {
      const min = p.def.params?.minVolts ?? 10;
      const v0 = vtx(zero, p);
      const v1 = vtx(full, p);
      if (amps[i] > 0 && v0 !== undefined && v1 !== undefined && v1 < min) {
        const k = (v1 - v0) / amps[i];
        amps[i] = k < 0 ? Math.max(0, Math.min(amps[i], (min - v0) / k)) : 0;
      }
    });
    const final = this.nodalWith(uf, nodeSrc, src()) ?? zero;
    txs.forEach((p, i) => (p.loopA = amps[i]));
    return final;
  }

  /** Nodal analysis with optional current sources [from node, to node, amps]. Returns null if the network cannot be solved. */
  private nodalWith(uf: UnionFind, nodeSrc: Map<string, Source[]>, currents: [string, string, number][], force = false): Map<string, Pot | undefined> | null {
    const pots = new Map<string, Pot | undefined>();
    const roots = new Set<string>();
    for (const [id, p] of this.parts) for (const t of terminalsOf(p.def)) roots.add(uf.find(key(id, t)));
    for (const r of roots) pots.set(r, nodeSrc.has(r) ? SOURCE_POT[nodeSrc.get(r)![0]] : undefined);

    const edges = this.loads()
      .map(([a, b, ohm]) => [uf.find(a), uf.find(b), 1 / ohm] as [string, string, number])
      .filter(([a, b]) => a !== b);
    const unknown = [...roots].filter((r) => !nodeSrc.has(r));
    // Unknown nodes that can reach a known node through loads.
    const adj = new Map<string, string[]>();
    for (const [a, b] of edges) {
      adj.set(a, [...(adj.get(a) ?? []), b]);
      adj.set(b, [...(adj.get(b) ?? []), a]);
    }
    const reach = new Set<string>();
    void force;
    const stack = [...roots].filter((r) => nodeSrc.has(r));
    const seen = new Set(stack);
    while (stack.length) {
      const n = stack.pop()!;
      for (const m of adj.get(n) ?? []) {
        if (!seen.has(m)) {
          seen.add(m);
          if (!nodeSrc.has(m)) reach.add(m);
          stack.push(m);
        }
      }
    }
    const solveFor = unknown.filter((r) => reach.has(r));
    if (!solveFor.length) return pots;
    const idx = new Map(solveFor.map((r, i) => [r, i]));
    const A = solveFor.map(() => solveFor.map(() => 0));
    const B = solveFor.map(() => [0, 0, 0]);
    for (const [a, b, g] of edges) {
      for (const [x, y] of [
        [a, b],
        [b, a],
      ]) {
        const i = idx.get(x);
        if (i === undefined) continue;
        A[i][i] += g;
        const j = idx.get(y);
        if (j !== undefined) A[i][j] -= g;
        else {
          const py = pots.get(y);
          if (py) {
            B[i][0] += g * py.re;
            B[i][1] += g * py.im;
            B[i][2] += g * py.dc;
          }
        }
      }
    }
    for (const [from, to, amps] of currents) {
      if (!amps) continue;
      const i = idx.get(from);
      const j = idx.get(to);
      if (i !== undefined) B[i][2] -= amps;
      if (j !== undefined) B[j][2] += amps;
    }
    const x = solveLinear(A, B);
    if (!x) return currents.some(([, , a]) => a) ? null : pots;
    solveFor.forEach((r, i) => pots.set(r, { re: x[i][0], im: x[i][1], dc: x[i][2] }));
    return pots;
  }

  private tripForShort(a: Analysis): boolean {
    const involvesDc = a.conflicts.some((r) => a.nodeSrc.get(r)!.some((s) => s === 'P24' || s === 'M0V'));
    const candidates = [...this.parts.values()].filter((p) => {
      if (p.def.type === 'psu24') return involvesDc && p.psuOn && !p.tripped;
      if (p.def.type === 'mcb2' || p.def.type === 'mpcb3') return p.on && !p.tripped;
      return false;
    });
    const order: PartType[] = ['psu24', 'mcb2', 'mpcb3'];
    candidates.sort((x, y) => order.indexOf(x.def.type) - order.indexOf(y.def.type));
    for (const c of candidates) {
      c.tripped = true;
      const after = this.analyse();
      if (after.conflicts.length < a.conflicts.length) {
        if (c.def.type === 'psu24') {
          c.psuOn = false;
          this.note(`${c.def.id} power supply switched its output off: short circuit on the 24 V side.`);
        } else this.note(`${c.def.id} tripped: short circuit.`);
        return true;
      }
      c.tripped = false;
    }
    this.supplyFault = true;
    this.note('Upstream protection operated: there is a short circuit that no device on this drawing protects. Switch off, find the short, then restore the supply.');
    return true;
  }

  /** Re-solves the circuit until stable. */
  solve(quiet = false) {
    this.unstable = false;
    for (let iter = 0; iter < 40; iter++) {
      const a = this.analyse();
      if (a.conflicts.length) {
        this.tripForShort(a);
        continue;
      }
      const v = (pa: string, pb: string) => voltageBetween(a.pots.get(a.uf.find(pa)), a.pots.get(a.uf.find(pb)));
      let changed = false;
      for (const [id, p] of this.parts) {
        if (p.def.type !== 'psu24') continue;
        const ok = v(key(id, 'L'), key(id, 'N')).ac >= 180;
        if (!ok && p.tripped) p.tripped = false; // power-cycling clears the PSU's protection
        const want = ok && !p.tripped;
        if (p.psuOn !== want) {
          p.psuOn = want;
          if (!quiet) this.note(`${id} 24 V supply ${want ? 'on' : 'off'}.`);
          changed = true;
        }
      }
      if (changed) continue;
      for (const [id, p] of this.parts) {
        const pair = p.def.type === 'contactor' ? ['A1', 'A2'] : p.def.type === 'lamp24' ? ['X1', 'X2'] : null;
        if (!pair || p.burnt) continue;
        const vv = v(key(id, pair[0]), key(id, pair[1]));
        if (vv.ac >= 100) {
          p.burnt = true;
          p.energised = false;
          this.note(`${id} burnt out: ${Math.round(vv.ac)} V AC on a 24 V DC ${p.def.type === 'lamp24' ? 'lamp' : 'coil'}.`);
          this.safety.push({ t: this.t, critical: false, text: `${id} was connected to the wrong voltage and damaged.` });
          changed = true;
        }
      }
      if (changed) continue;
      for (const [id, p] of this.parts) {
        if (p.def.type === 'prox_pnp' || p.def.type === 'prox_npn') {
          const powered = v(key(id, 'BN'), key(id, 'BU')).dc >= PROX_MIN_V;
          const want = powered && p.value > 0;
          if (want !== p.energised) {
            p.energised = want;
            if (!quiet) this.note(`${id} output ${want ? 'switched on (LED lit)' : 'off'}.`);
            changed = true;
          }
        }
        if (p.def.type === 'trip') {
          const val = this.engValue(id, v(key(id, '+'), key(id, '-')).dc / AI_OHMS * 1000);
          const prm = p.def.params ?? {};
          const hy = prm.hyst ?? 0;
          const hi = p.relays.hi ? val >= (prm.setHi ?? Infinity) - hy : val >= (prm.setHi ?? Infinity);
          const lo = p.relays.lo ? val <= (prm.setLo ?? -Infinity) + hy : val <= (prm.setLo ?? -Infinity);
          if (hi !== p.relays.hi || lo !== p.relays.lo) {
            if (!quiet && hi !== p.relays.hi) this.note(`${id} HIGH alarm relay ${hi ? 'energised' : 'reset'}.`);
            if (!quiet && lo !== p.relays.lo) this.note(`${id} LOW alarm relay ${lo ? 'energised' : 'reset'}.`);
            p.relays = { hi, lo };
            changed = true;
          }
        }
      }
      if (changed) continue;
      for (const [id, p] of this.parts) {
        if (p.def.type !== 'contactor') continue;
        const vv = Math.abs(v(key(id, 'A1'), key(id, 'A2')).dc);
        const want = !p.burnt && !this.coilOpen(id) && (p.energised ? vv >= DROP_OUT_V : vv >= PICK_UP_V);
        if (want !== p.energised) {
          p.energised = want;
          if (!quiet) this.note(want ? `${id} coil energised: contactor pulls in.` : `${id} coil de-energised: contactor drops out.`);
          changed = true;
        }
      }
      if (!changed) {
        this.cache = a;
        return;
      }
    }
    this.unstable = true;
    this.cache = this.analyse();
    this.note('The circuit will not settle (relay chatter). Check the control wiring.');
  }

  // ---------------- time ----------------

  step(ms: number) {
    this.t += ms;
    let topologyChanged = false;
    for (const [id, p] of this.parts) if (p.def.type === 'motor3') this.updateMotor(id, p, ms);
    for (const [id, p] of this.parts) {
      if (p.def.type !== 'overload') continue;
      const motor = this.motorFedBy(id);
      const setting = p.def.params?.setting ?? 1;
      const amps = motor ? this.parts.get(motor)!.motor.amps : 0;
      p.thermal += ((amps / setting) ** 2 - p.thermal) * (ms / OL_TAU_MS);
      if (!p.tripped && p.thermal >= OL_TRIP) {
        p.tripped = true;
        this.note(`${id} overload tripped: motor current too high for too long.`);
        topologyChanged = true;
      }
    }
    if (topologyChanged) this.solve();
  }

  private phaseAt(term: string): PhaseName | null {
    const p = this.potAt(term);
    if (!p || p.dc !== 0) return null;
    if (Math.hypot(p.re, p.im) < 150) return null;
    for (const s of ['L1', 'L2', 'L3'] as PhaseName[]) {
      const sp = SOURCE_POT[s];
      if (Math.hypot(p.re - sp.re, p.im - sp.im) < 60) return s;
    }
    return null;
  }

  private updateMotor(id: string, p: Runtime, ms: number) {
    const prm = p.def.params ?? {};
    const flc = fullLoadCurrent(prm.kW ?? 2.2, prm.volts ?? 400, prm.efficiency ?? 0.85, prm.powerFactor ?? 0.82);
    const rated = prm.ratedRpm ?? synchronousSpeed(prm.hz ?? 50, prm.poles ?? 4) * 0.96;
    const u = this.phaseAt(key(id, 'U1'));
    const v = this.phaseAt(key(id, 'V1'));
    const w = this.phaseAt(key(id, 'W1'));
    const distinct = new Set([u, v, w].filter(Boolean));
    const m = p.motor;
    const prev = m.state;
    if (u && v && w && distinct.size === 3) {
      const dir = rotation(u, v, w) as 'forward' | 'reverse';
      const target = (dir === 'forward' ? 1 : -1) * rated;
      if (m.state !== 'running' || Math.sign(m.rpm) !== Math.sign(target)) {
        if (m.state !== 'starting') this.note(`${id} starting (${dir}).`);
        m.state = 'starting';
        m.direction = dir;
        m.amps = START_MULTIPLE * flc;
        const stepRpm = (rated * ms) / ACCEL_MS;
        m.rpm = target > m.rpm ? Math.min(target, m.rpm + stepRpm) : Math.max(target, m.rpm - stepRpm);
        if (m.rpm === target) {
          m.state = 'running';
          m.amps = flc;
          this.note(`${id} running ${dir}: ${Math.round(rated)} rpm, ${flc.toFixed(1)} A.`);
        }
      } else m.amps = flc;
    } else if (distinct.size === 2) {
      if (m.state === 'running' || m.state === 'starting' || m.state === 'single-phasing') {
        if (m.state !== 'single-phasing') this.note(`${id} has lost a phase: still turning on two phases, current is high.`);
        m.state = 'single-phasing';
        m.amps = SINGLE_PHASING_MULTIPLE * flc;
        m.rpm = Math.sign(m.rpm || 1) * rated * 0.95;
      } else {
        if (m.state !== 'stalled') this.note(`${id} hums but will not turn: only two phases.`);
        m.state = 'stalled';
        m.amps = STALL_TWO_PHASE_MULTIPLE * flc;
        m.rpm = 0;
      }
    } else {
      m.amps = 0;
      if (Math.abs(m.rpm) > 5) {
        if (m.state !== 'coasting') this.note(`${id} supply off: coasting to a stop.`);
        m.state = 'coasting';
        m.rpm *= Math.exp(-ms / 1500);
      } else if (prev !== 'stopped') {
        m.rpm = 0;
        m.state = 'stopped';
        m.direction = null;
        this.note(`${id} stopped.`);
      }
    }
  }

  // ---------------- measurements and status ----------------

  private get a(): Analysis {
    if (!this.cache) this.solve(true);
    return this.cache!;
  }

  nodeOf(term: string): string {
    return this.a.uf.find(term);
  }

  potAt(term: string): Pot | undefined {
    return this.a.pots.get(this.a.uf.find(term));
  }

  voltage(a: string, b: string) {
    return voltageBetween(this.potAt(a), this.potAt(b));
  }

  isLive(term: string): boolean {
    const p = this.potAt(term);
    return !!p && (Math.hypot(p.re, p.im) >= LIVE_V || Math.abs(p.dc) >= LIVE_V);
  }

  /**
   * Resistance between two terminals as an ohmmeter would read it, with loads as resistors.
   * Returns live: true if any conductor reachable from the probes is live (an unsafe test).
   */
  resistance(a: string, b: string): { ohms: number | null; live: boolean } {
    const an = this.a;
    const ra = an.uf.find(a);
    const rb = an.uf.find(b);
    const edges = this.loads()
      .map(([x, y, ohm]) => [an.uf.find(x), an.uf.find(y), 1 / ohm] as [string, string, number])
      .filter(([x, y]) => x !== y);
    const adj = new Map<string, string[]>();
    for (const [x, y] of edges) {
      adj.set(x, [...(adj.get(x) ?? []), y]);
      adj.set(y, [...(adj.get(y) ?? []), x]);
    }
    const comp = new Set([ra]);
    const stack = [ra, rb];
    comp.add(rb);
    while (stack.length) {
      const n = stack.pop()!;
      for (const m of adj.get(n) ?? []) if (!comp.has(m)) {
        comp.add(m);
        stack.push(m);
      }
    }
    // Live means energised now, or still connected to a supply conductor (N and 0 V included). Earth alone is fine.
    const isLiveNode = (r: string) => {
      const p = an.pots.get(r);
      if (p && (Math.hypot(p.re, p.im) >= LIVE_V || Math.abs(p.dc) >= LIVE_V)) return true;
      return (an.nodeSrc.get(r) ?? []).some((s) => s !== 'PE');
    };
    if ([...comp].some(isLiveNode)) return { ohms: null, live: true };
    if (ra === rb) return { ohms: 0, live: false };
    // Component of ra only (through loads).
    const compA = new Set([ra]);
    const st = [ra];
    while (st.length) {
      const n = st.pop()!;
      for (const m of adj.get(n) ?? []) if (!compA.has(m)) {
        compA.add(m);
        st.push(m);
      }
    }
    if (!compA.has(rb)) return { ohms: null, live: false };
    const nodes = [...compA].filter((n) => n !== rb);
    const idx = new Map(nodes.map((n, i) => [n, i]));
    const A = nodes.map(() => nodes.map(() => 0));
    const B = nodes.map((n) => [n === ra ? 1 : 0]);
    for (const [x, y, g] of edges) {
      if (!compA.has(x)) continue;
      for (const [p, q] of [
        [x, y],
        [y, x],
      ]) {
        const i = idx.get(p);
        if (i === undefined) continue;
        A[i][i] += g;
        const j = idx.get(q);
        if (j !== undefined) A[i][j] -= g;
      }
    }
    const sol = solveLinear(A, B);
    return { ohms: sol ? sol[idx.get(ra)!][0] : null, live: false };
  }

  /** The motor whose U1/V1/W1 are on the same nodes as this overload's 2/4/6 (any order). */
  motorFedBy(overloadId: string): string | null {
    const outs = ['2', '4', '6'].map((t) => this.nodeOf(key(overloadId, t))).sort().join('|');
    for (const [id, p] of this.parts) {
      if (p.def.type !== 'motor3') continue;
      const ins = ['U1', 'V1', 'W1'].map((t) => this.nodeOf(key(id, t))).sort().join('|');
      if (ins === outs && new Set(outs.split('|')).size === 3) return id;
    }
    return null;
  }

  /** Engineering value for an analog input or trip amplifier at a given current. */
  engValue(id: string, mA: number): number {
    const p = this.parts.get(id)!;
    const lo = p.config?.rangeLo ?? p.def.params?.rangeLo ?? 0;
    const hi = p.config?.rangeHi ?? p.def.params?.rangeHi ?? 100;
    return lo + ((mA - 4) / 16) * (hi - lo);
  }

  status(id: string): PartStatus {
    const p = this.parts.get(id)!;
    const s: PartStatus = { id, type: p.def.type, label: p.def.label };
    switch (p.def.type) {
      case 'isolator3':
        s.on = p.on;
        s.locked = p.locked;
        break;
      case 'mpcb3':
      case 'mcb2':
        s.on = p.on && !p.tripped;
        s.tripped = p.tripped;
        break;
      case 'psu24':
        s.psuOn = p.psuOn && !p.tripped;
        s.tripped = p.tripped;
        break;
      case 'contactor':
        s.energised = p.energised;
        s.burnt = p.burnt;
        break;
      case 'overload':
        s.tripped = p.tripped;
        s.thermalPct = Math.min(100, Math.round((p.thermal / OL_TRIP) * 100));
        break;
      case 'pb_no':
      case 'pb_nc':
        s.pressed = p.pressed;
        break;
      case 'sw_no':
        s.on = p.on;
        break;
      case 'lamp24': {
        const vv = this.voltage(key(id, 'X1'), key(id, 'X2'));
        s.lit = !p.burnt && !this.coilOpen(id) && Math.abs(vv.dc) >= PICK_UP_V;
        s.burnt = p.burnt;
        break;
      }
      case 'tx2w':
        s.value = round2(p.value);
        s.unit = p.def.params?.unit;
        s.rangeLo = p.def.params?.rangeLo;
        s.rangeHi = p.def.params?.rangeHi;
        s.mA = round2(p.loopA * 1000);
        break;
      case 'ai':
      case 'trip': {
        const mA = (this.voltage(key(id, '+'), key(id, '-')).dc / AI_OHMS) * 1000;
        s.mA = round2(mA);
        s.raw = rawCount(mA);
        s.eng = round2(this.engValue(id, mA));
        s.unit = p.def.params?.unit;
        s.rangeLo = p.config?.rangeLo ?? p.def.params?.rangeLo;
        s.rangeHi = p.config?.rangeHi ?? p.def.params?.rangeHi;
        s.signal = signalStatus(mA);
        if (p.def.type === 'trip') s.relays = { ...p.relays };
        break;
      }
      case 'prox_pnp':
      case 'prox_npn':
        s.value = p.value;
        s.output = p.energised;
        break;
      case 'di':
        s.inputs = Object.fromEntries(['I0', 'I1'].map((t) => [t, Math.abs(this.voltage(key(id, t), key(id, 'M')).dc) >= DI_ON_V]));
        break;
      case 'motor3':
        s.motor = { ...p.motor, rpm: Math.round(p.motor.rpm), amps: Math.round(p.motor.amps * 10) / 10 };
        break;
    }
    return s;
  }

  allStatus(): PartStatus[] {
    return [...this.parts.keys()].map((id) => this.status(id));
  }

  private note(text: string) {
    this.log.push({ t: this.t, text });
    if (this.log.length > 300) this.log.shift();
  }

  /** A fresh copy with the same wiring and faults, for running checks without touching the learner's circuit. */
  clone(): Circuit {
    return new Circuit(this.def, this.faults.filter((f) => f.kind !== 'wire-moved'), this.wires);
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function voltageBetween(pa: Pot | undefined, pb: Pot | undefined): { ac: number; dc: number; floating: boolean } {
  if (!pa || !pb) return { ac: 0, dc: 0, floating: true };
  return { ac: Math.hypot(pa.re - pb.re, pa.im - pb.im), dc: pa.dc - pb.dc, floating: false };
}
