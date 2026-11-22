import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Circuit } from '../../engines/wiring/circuit';
import type { Command, PartStatus } from '../../engines/wiring/types';
import { Notice } from '../../components/ui';
import { buildEquipment, type EquipmentModel, type ViewId } from './models';

export interface Equipment3DProps {
  circuit: Circuit;
  version: number;
  onCommand: (c: Command) => void;
  onTerminal?: (ref: string) => void;
  probes?: { red?: string | null; black?: string | null };
}

/**
 * Generic 3D view of the DOL equipment. It shows what the circuit simulator reports and sends button presses back to it.
 * Terminal labels are real buttons: tapping one places a meter probe, exactly like the drawing.
 */
export default function Equipment3D({ circuit, version, onCommand, onTerminal, probes }: Equipment3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [labels, setLabels] = useState(true);
  const api = useRef<{
    model: EquipmentModel;
    goTo: (v: ViewId) => void;
    dirty: () => void;
    termEls: Map<string, HTMLButtonElement>;
    plateEls: { el: HTMLDivElement; text: (s: Map<string, PartStatus>) => string }[];
    setLabels: (on: boolean) => void;
  } | null>(null);
  const cbs = useRef({ onCommand, onTerminal, circuit });
  cbs.current = { onCommand, onTerminal, circuit };

  // Build the scene once.
  useEffect(() => {
    const host = hostRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setFailed('This device or browser cannot show 3D graphics (WebGL is off or not supported). Use the drawing view instead.');
      return;
    }
    const overload = circuit.def.parts.find((p) => p.type === 'overload');
    const motor = circuit.def.parts.find((p) => p.type === 'motor3');
    const model = buildEquipment({ overloadSetting: overload?.params?.setting ?? 4.6, ratedRpm: motor?.params?.ratedRpm });

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef1f4);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(20, 30, 40);
    scene.add(sun);
    scene.add(model.root);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 400);
    camera.position.copy(model.views.overview.position);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.setAttribute('aria-label', '3D view of the DOL starter equipment. Drag to turn, pinch or scroll to zoom.');
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.className = 'gl';
    host.appendChild(renderer.domElement);

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.domElement.className = 'labels3d';
    host.appendChild(labelRenderer.domElement);

    const termEls = new Map<string, HTMLButtonElement>();
    const termObjs: CSS2DObject[] = [];
    for (const t of model.terminals) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `t3d${t.ref ? '' : ' t3d-static'}`;
      el.textContent = t.label;
      if (t.ref) {
        el.dataset.term3d = t.ref;
        el.setAttribute('aria-label', `${t.ref.split(':')[0]} terminal ${t.ref.split(':')[1]}`);
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          cbs.current.onTerminal?.(t.ref!);
        });
        termEls.set(t.ref, el);
      } else {
        el.disabled = true;
        el.setAttribute('aria-label', `Motor terminal ${t.label} (joined by a delta link)`);
      }
      const o = new CSS2DObject(el);
      o.position.set(0, t.below ? -0.95 : 0.95, 0.5);
      t.object.add(o);
      termObjs.push(o);
    }
    const plateEls = model.plates.map((p) => {
      const el = document.createElement('div');
      el.className = 'plate3d';
      const o = new CSS2DObject(el);
      p.object.add(o);
      return { el, text: p.text };
    });

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(model.views.overview.target);
    controls.minDistance = 6;
    controls.maxDistance = 90;
    controls.update();

    let needsRender = true;
    const dirty = () => {
      needsRender = true;
    };
    controls.addEventListener('change', dirty);

    let tween: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; start: number } | null = null;
    const goTo = (v: ViewId) => {
      tween = { from: camera.position.clone(), to: model.views[v].position.clone(), tFrom: controls.target.clone(), tTo: model.views[v].target.clone(), start: performance.now() };
    };

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      renderer.setSize(w, h);
      labelRenderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      dirty();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    // Pressing a 3D button or handle drives the simulator.
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let held: string | null = null;
    const hit = (ev: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      for (const c of model.controls) {
        if (ray.intersectObject(c.object, true).length) return c;
      }
      return null;
    };
    const down = (ev: PointerEvent) => {
      const c = hit(ev);
      if (!c) return;
      controls.enabled = false;
      const send = cbs.current.onCommand;
      if (c.action === 'hold') {
        held = c.part;
        send({ kind: 'press', part: c.part });
      } else if (c.action === 'toggle') send({ kind: 'switch', part: c.part, on: !cbs.current.circuit.status(c.part).on });
      else if (c.action === 'test') send({ kind: 'trip-test', part: c.part });
      else send({ kind: 'reset', part: c.part });
    };
    const up = () => {
      if (held) cbs.current.onCommand({ kind: 'release', part: held });
      held = null;
      controls.enabled = true;
    };
    renderer.domElement.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);

    let labelsOn = true;
    let labelsNear = true;
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      let animating = model.tick(dt);
      if (tween) {
        const k = Math.min(1, (now - tween.start) / 450);
        const e = k * (2 - k);
        camera.position.lerpVectors(tween.from, tween.to, e);
        controls.target.lerpVectors(tween.tFrom, tween.tTo, e);
        controls.update();
        if (k >= 1) tween = null;
        animating = true;
      }
      // Terminal labels appear once you zoom in, so the whole-starter view stays readable.
      const near = camera.position.distanceTo(controls.target) < 36;
      if (near !== labelsNear) {
        labelsNear = near;
        termObjs.forEach((o) => (o.visible = labelsOn && near));
        needsRender = true;
      }
      if (animating || needsRender) {
        renderer.render(scene, camera);
        labelRenderer.render(scene, camera);
        needsRender = false;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    api.current = {
      model,
      goTo,
      dirty,
      termEls,
      plateEls,
      setLabels: (on) => {
        labelsOn = on;
        termObjs.forEach((o) => (o.visible = on && labelsNear));
        dirty();
      },
    };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      controls.dispose();
      model.dispose();
      renderer.dispose();
      host.replaceChildren();
      api.current = null;
    };
    // The scene is built once per circuit drawing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circuit.def]);

  // Push simulator state into the model after every tick.
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const s = new Map<string, PartStatus>(circuit.allStatus().map((x) => [x.id, x]));
    a.model.update(s);
    for (const p of a.plateEls) p.el.textContent = p.text(s);
    for (const [ref, el] of a.termEls) {
      el.classList.toggle('probe-red', probes?.red === ref);
      el.classList.toggle('probe-black', probes?.black === ref);
    }
    a.dirty();
  }, [version, circuit, probes]);

  useEffect(() => api.current?.setLabels(labels), [labels]);

  if (failed) return <Notice kind="warn">{failed}</Notice>;

  const views: [ViewId, string][] = [
    ['overview', 'Whole starter'],
    ['contactor', 'KM1 + F2'],
    ['mpcb', 'Q1'],
    ['station', 'Buttons'],
    ['motor', 'Motor box'],
  ];
  const hold = (part: string) => ({
    onPointerDown: () => onCommand({ kind: 'press', part }),
    onPointerUp: () => onCommand({ kind: 'release', part }),
    onPointerLeave: () => circuit.status(part).pressed && onCommand({ kind: 'release', part }),
  });
  const q1 = circuit.status('Q1');
  return (
    <div className="eq3d">
      <div className="canvas-tools" role="group" aria-label="3D view">
        {views.map(([id, label]) => (
          <button key={id} type="button" onClick={() => api.current?.goTo(id)}>{label}</button>
        ))}
        <button type="button" aria-pressed={labels} onClick={() => setLabels(!labels)}>{labels ? 'Hide labels' : 'Show labels'}</button>
      </div>
      <div className="eq3d-host" ref={hostRef} />
      <div className="actions eq3d-controls" role="group" aria-label="Operate the equipment">
        <button type="button" data-ctl3d="Q1" onClick={() => onCommand({ kind: 'switch', part: 'Q1', on: !q1.on })}>Q1 {q1.on ? 'OFF' : 'ON'}</button>
        <button type="button" className="go" data-ctl3d="S2" {...hold('S2')}>START (hold)</button>
        <button type="button" className="stop" data-ctl3d="S1" {...hold('S1')}>STOP (hold)</button>
        <button type="button" data-ctl3d="F2-test" onClick={() => onCommand({ kind: 'trip-test', part: 'F2' })}>F2 TEST</button>
        <button type="button" data-ctl3d="F2-reset" onClick={() => onCommand({ kind: 'reset', part: 'F2' })}>F2 RESET</button>
      </div>
      <p className="hint">Drag to turn, pinch or scroll to zoom. Zoom in to see terminal labels, then tap one to place a meter probe. You can also press the 3D buttons and the Q1 handle. Generic equipment, not a real product. Supply, F1 and G1 appear in the drawing only.</p>
    </div>
  );
}
