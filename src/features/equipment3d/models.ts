/**
 * Generic 3D models of the DOL starter equipment, built from simple shapes in code.
 * They are deliberately not copies of any manufacturer's product. 1 unit = 1 cm.
 *
 * The model has no knowledge of electricity: it only shows the state the circuit simulator reports.
 */
import * as THREE from 'three';
import type { PartStatus } from '../../engines/wiring/types';

export type ViewId = 'overview' | 'mpcb' | 'contactor' | 'station' | 'motor';

export interface TerminalAnchor {
  /** Circuit terminal reference, e.g. "KM1:A1". Null for terminals the simulator does not model (W2, U2, V2). */
  ref: string | null;
  label: string;
  object: THREE.Object3D;
  /** Draw the label under the terminal (bottom rows), so rows do not overlap. */
  below?: boolean;
}

export interface ControlTarget {
  object: THREE.Object3D;
  part: string;
  action: 'hold' | 'toggle' | 'test' | 'reset';
  label: string;
}

export interface NamePlate {
  object: THREE.Object3D;
  text: (s: Map<string, PartStatus>) => string;
}

export interface EquipmentModel {
  root: THREE.Group;
  terminals: TerminalAnchor[];
  controls: ControlTarget[];
  plates: NamePlate[];
  views: Record<ViewId, { label: string; target: THREE.Vector3; position: THREE.Vector3 }>;
  update: (status: Map<string, PartStatus>) => void;
  /** Advances animation. Returns true while something is still moving. */
  tick: (seconds: number) => boolean;
  /** Read-only state for tests. */
  probe: () => { handleDeg: number; flagX: number; dialDeg: number; tripFlagY: number; shaftRevPerSec: number; s1Depth: number; s2Depth: number; h1Lit: boolean; h2Lit: boolean };
  dispose: () => void;
}

const MAT = {
  device: new THREE.MeshStandardMaterial({ color: 0xd3d6da, roughness: 0.7 }),
  deviceDark: new THREE.MeshStandardMaterial({ color: 0x3b4149, roughness: 0.6 }),
  metal: new THREE.MeshStandardMaterial({ color: 0xb9bdc3, metalness: 0.85, roughness: 0.35 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.8, roughness: 0.35 }),
  plate: new THREE.MeshStandardMaterial({ color: 0xa3a9b0, metalness: 0.4, roughness: 0.6 }),
  rail: new THREE.MeshStandardMaterial({ color: 0xc4c8cc, metalness: 0.7, roughness: 0.4 }),
  motor: new THREE.MeshStandardMaterial({ color: 0x46627e, roughness: 0.55 }),
  motorDark: new THREE.MeshStandardMaterial({ color: 0x2c3a48, roughness: 0.6 }),
  red: new THREE.MeshStandardMaterial({ color: 0xc1121f, roughness: 0.5 }),
  green: new THREE.MeshStandardMaterial({ color: 0x1f7a3a, roughness: 0.5 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.5 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.5 }),
  earth: new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.5 }),
};

const box = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const cyl = (r: number, h: number, m: THREE.Material, seg = 24) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number) => {
  o.position.set(x, y, z);
  return o;
};

export function buildEquipment(opts: { overloadSetting: number; overloadRange?: [number, number]; ratedRpm?: number }): EquipmentModel {
  const root = new THREE.Group();
  root.name = 'dol-equipment';
  const terminals: TerminalAnchor[] = [];
  const controls: ControlTarget[] = [];
  const plates: NamePlate[] = [];

  /** A screw terminal facing +z. */
  const screw = (parent: THREE.Object3D, ref: string | null, label: string, x: number, y: number, z: number, below = false, mat = MAT.metal) => {
    const g = new THREE.Group();
    const clamp = box(0.9, 0.9, 0.3, MAT.deviceDark);
    const head = cyl(0.34, 0.25, mat, 16);
    head.rotation.x = Math.PI / 2;
    head.position.z = 0.25;
    const slot = box(0.5, 0.08, 0.05, MAT.deviceDark);
    slot.position.z = 0.39;
    g.add(clamp, head, slot);
    at(g, x, y, z);
    parent.add(g);
    terminals.push({ ref, label, object: g, below });
    return g;
  };

  // ---------------- back plate and DIN rails ----------------
  const plateMesh = at(box(44, 26, 0.4, MAT.plate), -4, 11, -0.2);
  root.add(plateMesh);
  for (const y of [14, 8.6]) root.add(at(box(30, 3.5, 0.75, MAT.rail), -8, y, 0.4));

  // ---------------- Q1 motor circuit breaker ----------------
  const q1 = at(new THREE.Group(), -17, 14, 0);
  q1.add(at(box(4.5, 9, 6.5, MAT.device), 0, 0, 3.25));
  q1.add(at(box(4.5, 3.2, 1, MAT.deviceDark), 0, 0.3, 7));
  ['1', '3', '5'].forEach((t, i) => screw(q1, `Q1:${t}`, t, -1.5 + i * 1.5, 3.7, 5.2));
  ['2', '4', '6'].forEach((t, i) => screw(q1, `Q1:${t}`, t, -1.5 + i * 1.5, -3.7, 5.2, true));
  const handle = new THREE.Group();
  const knob = cyl(1.4, 0.7, MAT.deviceDark);
  knob.rotation.x = Math.PI / 2;
  const pointer = at(box(0.55, 2.6, 0.7, MAT.white), 0, 0, 0.5);
  handle.add(knob, pointer);
  at(handle, 0, 0.3, 7.9);
  q1.add(handle);
  controls.push({ object: handle, part: 'Q1', action: 'toggle', label: 'Q1 handle: switch on or off' });
  root.add(q1);
  plates.push({ object: at(new THREE.Object3D(), -17, 19.6, 4), text: (s) => `Q1 · ${s.get('Q1')?.tripped ? 'TRIPPED' : s.get('Q1')?.on ? 'ON' : 'OFF'}` });

  // ---------------- KM1 contactor ----------------
  const km = at(new THREE.Group(), -4, 15, 0);
  km.add(at(box(4.5, 7, 7.5, MAT.device), 0, 0, 3.75));
  ['1', '3', '5'].forEach((t, i) => screw(km, `KM1:${t}`, t, -1.5 + i * 1.5, 3.0, 6.2));
    // KM1 2/4/6 are taken by the overload's plug-in pins (F2 1/3/5), so they are not drawn as separate terminals.
  screw(km, 'KM1:A1', 'A1', -1.7, -1.6, 7.55, true);
  screw(km, 'KM1:A2', 'A2', 1.7, -1.6, 7.55, true);
  // Front-mounted auxiliary contact block.
  const aux = at(new THREE.Group(), 0, 1.0, 7.5);
  aux.add(at(box(4.2, 2.6, 1.8, MAT.device), 0, 0, 0.9));
  [['13', '14'], ['21', '22'], ['43', '44']].forEach(([top, bottom], i) => {
    screw(aux, `KM1:${top}`, top, -1.4 + i * 1.4, 0.65, 1.85);
    screw(aux, `KM1:${bottom}`, bottom, -1.4 + i * 1.4, -0.65, 1.85, true);
  });
  km.add(aux);
  // Indicator window with a flag that slides when the armature pulls in.
  km.add(at(box(1.6, 0.6, 0.1, MAT.deviceDark), 0, -1.6, 7.55));
  const flag = at(box(0.6, 0.45, 0.12, MAT.white), -0.45, -1.6, 7.62);
  km.add(flag);
  root.add(km);
  plates.push({ object: at(new THREE.Object3D(), -4, 19.4, 5), text: (s) => `KM1 · ${s.get('KM1')?.energised ? 'PULLED IN (I)' : 'OPEN (O)'}` });

  // ---------------- F2 overload relay (mounted under KM1) ----------------
  const f2 = at(new THREE.Group(), -4, 9.25, 0);
  f2.add(at(box(4.5, 4.5, 7, MAT.device), 0, 0, 3.5));
  ['2', '4', '6'].forEach((t, i) => screw(f2, `F2:${t}`, t, -1.5 + i * 1.5, -1.9, 5.4, true));
  ['95', '96', '97', '98'].forEach((t, i) => screw(f2, `F2:${t}`, t, -1.65 + i * 1.1, -0.9, 7.05));
  const dial = new THREE.Group();
  const dialBody = cyl(0.75, 0.3, MAT.white);
  dialBody.rotation.x = Math.PI / 2;
  const dialPtr = at(box(0.15, 0.7, 0.1, MAT.deviceDark), 0, 0.3, 0.2);
  dial.add(dialBody, dialPtr);
  at(dial, -1.2, 1.0, 7.1);
  f2.add(dial);
  const testBtn = cyl(0.33, 0.35, MAT.red);
  testBtn.rotation.x = Math.PI / 2;
  at(testBtn, 0.5, 1.3, 7.2);
  const resetBtn = cyl(0.33, 0.35, MAT.blue);
  resetBtn.rotation.x = Math.PI / 2;
  at(resetBtn, 1.5, 1.3, 7.2);
  f2.add(testBtn, resetBtn);
  controls.push({ object: testBtn, part: 'F2', action: 'test', label: 'F2 TEST button (red)' });
  controls.push({ object: resetBtn, part: 'F2', action: 'reset', label: 'F2 RESET button (blue)' });
  const tripFlag = at(box(0.5, 0.3, 0.12, MAT.deviceDark), 1.0, 0.25, 7.05);
  f2.add(tripFlag);
  root.add(f2);
  plates.push({ object: at(new THREE.Object3D(), -4, 4.7, 6), text: (s) => `F2 · ${s.get('F2')?.tripped ? 'TRIPPED' : 'OK'} · set ${opts.overloadSetting} A` });

  // ---------------- Control station: STOP, START, RUN and TRIP lamps ----------------
  const st = at(new THREE.Group(), 11, 12, 0);
  st.add(at(box(7, 12, 5, MAT.device), 0, 0, 2.5));
  const mkButton = (mat: THREE.Material, y: number, part: string, label: string) => {
    const g = new THREE.Group();
    const collar = cyl(1.1, 0.4, MAT.deviceDark);
    collar.rotation.x = Math.PI / 2;
    const cap = cyl(0.85, 0.6, mat);
    cap.rotation.x = Math.PI / 2;
    cap.position.z = 0.5;
    g.add(collar, cap);
    at(g, -1.6, y, 5.2);
    st.add(g);
    controls.push({ object: cap, part, action: 'hold', label });
    return cap;
  };
  const s1Cap = mkButton(MAT.red, 3.5, 'S1', 'S1 STOP: press and hold');
  const s2Cap = mkButton(MAT.green, 0.5, 'S2', 'S2 START: press and hold');
  const mkLamp = (y: number, color: number) => {
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.45), roughness: 0.3, emissive: color, emissiveIntensity: 0 });
    m.userData.lit = new THREE.Color(color);
    m.userData.off = new THREE.Color(color).multiplyScalar(0.45);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.8, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), m);
    lens.rotation.x = Math.PI / 2;
    at(lens, -1.6, y, 5.2);
    st.add(lens);
    return m;
  };
  const h1Mat = mkLamp(-2.5, 0xf8f8f8);
  const h2Mat = mkLamp(-4.6, 0xffb000);
  // Terminal strip on the right side of the station, facing the front.
  const strip: [string, string][] = [['S1:11', '11'], ['S1:12', '12'], ['S2:13', '13'], ['S2:14', '14'], ['H1:X1', 'X1'], ['H1:X2', 'X2'], ['H2:X1', 'X1'], ['H2:X2', 'X2']];
  strip.forEach(([ref, label], i) => screw(st, ref, `${ref.split(':')[0]} ${label}`, 2.2, 4.8 - i * 1.3, 5.05));
  root.add(st);
  plates.push({
    object: at(new THREE.Object3D(), 13, 20.6, 3),
    text: (s) => `S1 STOP · S2 START · H1 RUN ${s.get('H1')?.lit ? 'LIT' : 'off'} · H2 TRIP ${s.get('H2')?.lit ? 'LIT' : 'off'}`,
  });

  // ---------------- M1 motor with terminal box ----------------
  const mot = at(new THREE.Group(), 8, -11, 7);
  const body = cyl(4, 11, MAT.motor, 32);
  body.rotation.z = Math.PI / 2;
  mot.add(body);
  for (let i = 0; i < 9; i++) {
    const rib = cyl(4.3, 0.3, MAT.motor, 32);
    rib.rotation.z = Math.PI / 2;
    rib.position.x = -4.6 + i * 1.15;
    mot.add(rib);
  }
  const cowl = cyl(4.2, 2.2, MAT.motorDark, 32);
  cowl.rotation.z = Math.PI / 2;
  cowl.position.x = -6.6;
  mot.add(cowl);
  for (const x of [-3.5, 3.5]) mot.add(at(box(1.6, 1.4, 8.4, MAT.motorDark), x, -4.3, 0));
  const shaft = new THREE.Group();
  const shaftBar = cyl(0.6, 3, MAT.metal);
  shaftBar.rotation.z = Math.PI / 2;
  const coupling = cyl(1.6, 0.6, MAT.metal, 32);
  coupling.rotation.z = Math.PI / 2;
  coupling.position.x = 1.6;
  const marker = at(box(0.65, 1.4, 0.35, MAT.red), 1.95, 0.75, 0);
  shaft.add(shaftBar, coupling, marker);
  at(shaft, 7, 0, 0);
  mot.add(shaft);
  // Terminal box on top, lid removed, IEC stud layout with delta links.
  const tb = at(new THREE.Group(), 0, 4.6, 0);
  tb.add(at(box(5.2, 1.4, 5.2, MAT.motorDark), 0, 0, 0));
  tb.add(at(box(4.4, 0.25, 4.4, MAT.deviceDark), 0, 0.75, 0));
  const stud = (ref: string | null, label: string, x: number, z: number) => {
    const g = new THREE.Group();
    const s = cyl(0.3, 0.9, MAT.brass, 12);
    s.position.y = 0.45;
    const nut = cyl(0.45, 0.3, MAT.metal, 6);
    nut.position.y = 0.7;
    g.add(s, nut);
    at(g, x, 0.9, z);
    tb.add(g);
    terminals.push({ ref, label, object: g });
  };
  const cols = [-1.4, 0, 1.4];
  ['W2', 'U2', 'V2'].forEach((t, i) => stud(null, t, cols[i], -1.1));
  ['U1', 'V1', 'W1'].forEach((t, i) => stud(`M1:${t}`, t, cols[i], 1.1));
  for (const x of cols) tb.add(at(box(0.55, 0.12, 2.9, MAT.brass), x, 1.75, 0)); // delta links: W2–U1, U2–V1, V2–W1
  const pe = new THREE.Group();
  const peStud = cyl(0.3, 0.9, MAT.earth, 12);
  peStud.position.y = 0.45;
  pe.add(peStud);
  at(pe, 2.2, 0.9, 2.1);
  tb.add(pe);
  terminals.push({ ref: 'M1:PE', label: 'PE', object: pe });
  mot.add(tb);
  root.add(mot);
  plates.push({
    object: at(new THREE.Object3D(), 8, -2.5, 9),
    text: (s) => {
      const m = s.get('M1')?.motor;
      if (!m) return 'M1';
      const names: Record<string, string> = { stopped: 'STOPPED', starting: 'STARTING', running: 'RUNNING', stalled: 'STALLED (humming)', 'single-phasing': 'TWO PHASES ONLY', coasting: 'COASTING' };
      return `M1 · ${names[m.state]}${m.direction ? ` · ${m.direction}` : ''} · ${Math.abs(m.rpm)} rpm (shown slowed) · ${m.amps} A`;
    },
  });

  for (const p of plates) root.add(p.object);

  // ---------------- state ----------------
  const range = opts.overloadRange ?? [4, 6.3];
  const dialDeg = -120 + ((opts.overloadSetting - range[0]) / (range[1] - range[0])) * 240;
  dial.rotation.z = (-dialDeg * Math.PI) / 180;
  const rated = opts.ratedRpm ?? 1430;
  let handleDeg = -90;
  let shaftRevPerSec = 0;
  let stalled = false;
  let s1Depth = 0;
  let s2Depth = 0;
  let h1Lit = false;
  let h2Lit = false;
  const motorHome = mot.position.clone();

  const update = (s: Map<string, PartStatus>) => {
    const q = s.get('Q1');
    handleDeg = q?.tripped ? -45 : q?.on ? 0 : -90;
    handle.rotation.z = (handleDeg * Math.PI) / 180;
    flag.position.x = s.get('KM1')?.energised ? 0.45 : -0.45;
    tripFlag.position.y = s.get('F2')?.tripped ? 0.55 : 0.25;
    s1Depth = s.get('S1')?.pressed ? 0.35 : 0;
    s2Depth = s.get('S2')?.pressed ? 0.35 : 0;
    s1Cap.position.z = 0.5 - s1Depth;
    s2Cap.position.z = 0.5 - s2Depth;
    h1Lit = !!s.get('H1')?.lit;
    h2Lit = !!s.get('H2')?.lit;
    for (const [m, lit] of [[h1Mat, h1Lit], [h2Mat, h2Lit]] as const) {
      m.emissiveIntensity = lit ? 1.1 : 0;
      m.color.copy(lit ? m.userData.lit : m.userData.off);
    }
    const m = s.get('M1')?.motor;
    // Real speed would strobe on screen, so it is shown slowed: 1.2 rev/s at rated speed.
    shaftRevPerSec = m ? (m.rpm / rated) * 1.2 : 0;
    stalled = m?.state === 'stalled';
  };

  let t = 0;
  const tick = (sec: number) => {
    t += sec;
    shaft.rotation.x += shaftRevPerSec * 2 * Math.PI * sec;
    if (stalled) mot.position.set(motorHome.x + Math.sin(t * 90) * 0.04, motorHome.y, motorHome.z);
    else mot.position.copy(motorHome);
    return shaftRevPerSec !== 0 || stalled;
  };

  const views: EquipmentModel['views'] = {
    overview: { label: 'Whole starter', target: new THREE.Vector3(-3, 4, 3), position: new THREE.Vector3(2, 8, 62) },
    mpcb: { label: 'Q1 breaker', target: new THREE.Vector3(-17, 14, 6), position: new THREE.Vector3(-13, 16, 22) },
    contactor: { label: 'KM1 + F2', target: new THREE.Vector3(-4, 11.5, 7), position: new THREE.Vector3(0, 13, 27) },
    station: { label: 'Buttons + lamps', target: new THREE.Vector3(11, 12, 4), position: new THREE.Vector3(15, 13, 24) },
    motor: { label: 'Motor terminal box', target: new THREE.Vector3(8, -6.5, 7), position: new THREE.Vector3(14, 6, 18) },
  };

  return {
    root,
    terminals,
    controls,
    plates,
    views,
    update,
    tick,
    probe: () => ({ handleDeg, flagX: flag.position.x, dialDeg, tripFlagY: tripFlag.position.y, shaftRevPerSec, s1Depth, s2Depth, h1Lit, h2Lit }),
    dispose: () => {
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      h1Mat.dispose();
      h2Mat.dispose();
    },
  };
}
