import { useEffect, useRef, useState, type ReactNode, type KeyboardEvent } from 'react';
import type { Circuit } from '../engines/wiring/circuit';
import { terminalsOf } from '../engines/wiring/circuit';
import type { Command, PartJson } from '../engines/wiring/types';

export interface CanvasProps {
  circuit: Circuit;
  /** Bumped by the parent after each change so React redraws. */
  version: number;
  onTerminal?: (ref: string) => void;
  selectedTerminal?: string | null;
  probes?: { red?: string | null; black?: string | null };
  selectedWire?: string | null;
  onWire?: (id: string) => void;
  onCommand?: (cmd: Command) => void;
  controlsEnabled?: boolean;
  showLive?: boolean;
  /** Parts whose control buttons are hidden (e.g. the lab controls isolators elsewhere). */
  hideControlsFor?: string[];
}

type XY = [number, number];
const INK = '#1d2530';
const LIVE_AC = '#b45309';
const LIVE_DC = '#c1121f';

export function CircuitCanvas(props: CanvasProps) {
  const { circuit, onTerminal, selectedTerminal, probes, selectedWire, onWire, showLive } = props;
  const [w, h] = circuit.def.size;
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const wrapRef = useRef<HTMLDivElement>(null);
  // On narrow screens, fitting the whole drawing makes terminals too small to tap: scroll instead.
  useEffect(() => {
    const cw = wrapRef.current?.clientWidth ?? w;
    if (cw < w * 0.7) setZoom(0.85);
  }, [w]);
  const pin = (ref: string): XY | null => {
    const [pid, t] = ref.split(':');
    return circuit.def.parts.find((p) => p.id === pid)?.pins[t] ?? null;
  };

  const wireColour = (a: string) => {
    if (!showLive) return INK;
    const p = circuit.potAt(a);
    if (!p) return INK;
    if (Math.hypot(p.re, p.im) > 12) return LIVE_AC;
    if (Math.abs(p.dc) > 12) return LIVE_DC;
    return INK;
  };

  const style = zoom === 'fit' ? { width: '100%' } : { width: `${w * zoom}px` };

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <div className="canvas-tools" role="group" aria-label="Zoom">
        <button type="button" onClick={() => setZoom((z) => Math.max(0.6, (z === 'fit' ? 1 : z) - 0.2))} aria-label="Zoom out">−</button>
        <button type="button" onClick={() => setZoom('fit')}>Fit</button>
        <button type="button" onClick={() => setZoom((z) => Math.min(2.4, (z === 'fit' ? 1 : z) + 0.2))} aria-label="Zoom in">+</button>
        {showLive && <span className="hint legend"><span style={{ color: LIVE_AC }}>■</span> live AC <span style={{ color: LIVE_DC }}>■</span> live 24 V</span>}
      </div>
      <div className="canvas-scroll">
        <svg viewBox={`0 0 ${w} ${h}`} style={style} className="circuit" role="img" aria-label={circuit.def.title}>
          {circuit.def.notes?.map((n, i) => (
            <text key={i} x={n.at[0]} y={n.at[1]} className="note">{n.text}</text>
          ))}
          {/* wires under parts */}
          {circuit.wires.map((wire, idx) => {
            const a = pin(wire.a);
            const b = pin(wire.b);
            if (!a || !b) return null;
            // Stagger horizontal runs so parallel wires do not draw on top of each other.
            const my = wire.route ?? (a[1] + b[1]) / 2 + ((idx % 5) - 2) * 7;
            const d = wire.via
              ? `M${a[0]},${a[1]} ${wire.via.map(([x, y]) => `L${x},${y}`).join(' ')} L${b[0]},${b[1]}`
              : a[0] === b[0] || a[1] === b[1]
                ? `M${a[0]},${a[1]} L${b[0]},${b[1]}`
                : `M${a[0]},${a[1]} L${a[0]},${my} L${b[0]},${my} L${b[0]},${b[1]}`;
            const sel = wire.id === selectedWire;
            return (
              <g key={wire.id} className="wire" data-wire={wire.id}>
                <path d={d} stroke={sel ? '#ff8c00' : wireColour(wire.a)} strokeWidth={sel ? 6 : 3} fill="none" strokeLinejoin="round" />
                {onWire && (
                  <path
                    d={d}
                    stroke="transparent"
                    strokeWidth={18}
                    fill="none"
                    className="wire-hit"
                    role="button"
                    aria-label={`Wire ${wire.a} to ${wire.b}`}
                    onClick={() => onWire(wire.id)}
                  />
                )}
              </g>
            );
          })}
          {circuit.def.parts.map((p) => (
            <PartView key={p.id} part={p} {...props} />
          ))}
          {/* terminals on top */}
          {circuit.def.parts.flatMap((p) =>
            terminalsOf(p)
              .filter((t) => p.pins[t])
              .map((t) => {
                const ref = `${p.id}:${t}`;
                const [x, y] = p.pins[t];
                const isSel = selectedTerminal === ref;
                const isRed = probes?.red === ref;
                const isBlack = probes?.black === ref;
                return (
                  <g key={ref}>
                    <circle cx={x} cy={y} r={6} fill="#fff" stroke={INK} strokeWidth={2} />
                    {p.type !== 'supply3' && <text x={x + 8} y={y - 6} className="tlabel">{t === 'P' ? '+' : t === 'M' ? '−' : t}</text>}
                    {isSel && <circle cx={x} cy={y} r={12} fill="none" stroke="#ff8c00" strokeWidth={4} />}
                    {isRed && <ProbeMark x={x} y={y} colour="#d00000" sign="+" />}
                    {isBlack && <ProbeMark x={x} y={y} colour="#111" sign="−" />}
                    {onTerminal && (
                      <circle
                        cx={x}
                        cy={y}
                        r={17}
                        fill="transparent"
                        className="term-hit"
                        data-term={ref}
                        role="button"
                        tabIndex={0}
                        aria-label={`${p.id} terminal ${t}`}
                        onClick={() => onTerminal(ref)}
                        onKeyDown={(e) => activate(e, () => onTerminal(ref))}
                      />
                    )}
                  </g>
                );
              }),
          )}
        </svg>
      </div>
    </div>
  );
}

function ProbeMark({ x, y, colour, sign }: { x: number; y: number; colour: string; sign: string }) {
  return (
    <g pointerEvents="none">
      <circle cx={x} cy={y} r={11} fill={colour} opacity={0.85} />
      <text x={x} y={y + 5} textAnchor="middle" className="probe-sign">{sign}</text>
    </g>
  );
}

const activate = (e: KeyboardEvent, fn: () => void) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
};

function Btn({ x, y, w = 64, label, onClick, onDown, onUp, kind = 'normal', enabled, aria, testId }: {
  x: number; y: number; w?: number; label: string; onClick?: () => void; onDown?: () => void; onUp?: () => void;
  kind?: 'normal' | 'go' | 'stop' | 'warn'; enabled: boolean; aria: string; testId: string;
}) {
  const fill = { normal: '#fff', go: '#1f7a3a', stop: '#b3121b', warn: '#ffd23f' }[kind];
  const ink = kind === 'go' || kind === 'stop' ? '#fff' : INK;
  return (
    <g
      className={`ctl ${enabled ? '' : 'ctl-off'}`}
      role="button"
      tabIndex={enabled ? 0 : -1}
      aria-label={aria}
      aria-disabled={!enabled}
      data-control={testId}
      onClick={enabled ? onClick : undefined}
      onPointerDown={enabled && onDown ? (e) => { try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* synthetic events have no pointer */ } onDown(); } : undefined}
      onPointerUp={enabled ? onUp : undefined}
      onPointerCancel={enabled ? onUp : undefined}
      onKeyDown={enabled ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDown?.(); onClick?.(); } } : undefined}
      onKeyUp={enabled ? (e) => { if (e.key === 'Enter' || e.key === ' ') onUp?.(); } : undefined}
    >
      <rect x={x} y={y} width={w} height={30} rx={6} fill={fill} stroke={INK} strokeWidth={2} />
      <text x={x + w / 2} y={y + 20} textAnchor="middle" className="ctl-text" fill={ink}>{label}</text>
    </g>
  );
}

function PartView(props: CanvasProps & { part: PartJson }) {
  const { part: p, circuit, onCommand, controlsEnabled = true, hideControlsFor = [] } = props;
  const st = circuit.status(p.id);
  const P = (t: string) => p.pins[t];
  const cmd = (c: Command) => onCommand?.(c);
  const els: ReactNode[] = [];
  const [lx, ly] = p.labelAt ?? [p.pins[Object.keys(p.pins)[0]][0], p.pins[Object.keys(p.pins)[0]][1] - 20];
  const tag = circuit.tagOf(p.id);
  const ctl = controlsEnabled && !!onCommand && !hideControlsFor.includes(p.id);
  const by = ly + 8;

  const contact = (a: string, b: string, closed: boolean, nc = false, k = a) => {
    const A = P(a);
    const B = P(b);
    if (!A || !B) return;
    const x = A[0];
    const y1 = A[1] + (B[1] - A[1]) * 0.3;
    const y2 = B[1] - (B[1] - A[1]) * 0.3;
    els.push(
      <g key={`c${k}`} stroke={INK} strokeWidth={2.5} fill="none">
        <line x1={x} y1={A[1]} x2={x} y2={y1} />
        <line x1={x} y1={y2} x2={x} y2={B[1]} />
        {nc && <line x1={x} y1={y1} x2={x + 9} y2={y1} />}
        {closed ? <line x1={x} y1={y2} x2={nc ? x + 8 : x} y2={y1} /> : <line x1={x} y1={y2} x2={nc ? x + 14 : x - 13} y2={y1 + (nc ? -6 : 3)} />}
      </g>,
    );
  };
  const thermal = (a: string, b: string) => {
    const A = P(a);
    const B = P(b);
    if (!A || !B) return;
    const x = A[0];
    const m = (A[1] + B[1]) / 2;
    els.push(
      <g key={`t${a}`} stroke={INK} strokeWidth={2.5} fill="none">
        <line x1={x} y1={A[1]} x2={x} y2={m - 9} />
        <path d={`M${x},${m - 9} h8 v9 h-16 v9 h8`} />
        <line x1={x} y1={m + 9} x2={x} y2={B[1]} />
      </g>,
    );
  };
  const box = (a: string, b: string, filled: boolean, text: string) => {
    const A = P(a);
    const B = P(b);
    if (!A || !B) return;
    const x = A[0];
    const m = (A[1] + B[1]) / 2;
    els.push(
      <g key={`b${a}`}>
        <line x1={x} y1={A[1]} x2={x} y2={m - 10} stroke={INK} strokeWidth={2.5} />
        <line x1={x} y1={m + 10} x2={x} y2={B[1]} stroke={INK} strokeWidth={2.5} />
        <rect x={x - 16} y={m - 10} width={32} height={20} fill={filled ? '#ffd23f' : '#fff'} stroke={INK} strokeWidth={2.5} />
        <text x={x + 22} y={m + 5} className="state">{text}</text>
      </g>,
    );
  };
  const link = (terms: string[], open: boolean) => {
    const pts = terms.map((t) => P(t)).filter(Boolean) as XY[];
    if (pts.length < 2) return;
    const y = pts[0][1] + 16;
    els.push(<line key={`l${terms[0]}`} x1={pts[0][0] - (open ? 8 : 0)} y1={y} x2={pts[pts.length - 1][0] - (open ? 8 : 0)} y2={y} stroke={INK} strokeDasharray="4 4" strokeWidth={1.5} />);
  };

  switch (p.type) {
    case 'supply3':
      for (const t of ['L1', 'L2', 'L3', 'N', 'PE']) {
        const A = P(t);
        if (A) els.push(<text key={t} x={A[0]} y={A[1] - 12} textAnchor="middle" className="rail">{t}</text>);
      }
      break;
    case 'isolator3':
    case 'mpcb3': {
      const closed = !!st.on;
      contact('1', '2', closed);
      contact('3', '4', closed);
      contact('5', '6', closed);
      link(['1', '3', '5'], !closed);
      const stateText = p.type === 'isolator3' ? (st.locked ? 'OFF · LOCKED' : st.on ? 'ON' : 'OFF') : st.tripped ? 'TRIPPED' : st.on ? 'ON' : 'OFF';
      els.push(<text key="st" x={lx} y={ly + (p.type === 'isolator3' ? 74 : 56)} className={`state ${st.tripped || st.locked ? 'state-warn' : ''}`}>{stateText}</text>);
      if (ctl) {
        els.push(<Btn key="b1" x={lx} y={by} label={st.on ? 'Switch OFF' : 'Switch ON'} w={96} enabled={!(p.type === 'isolator3' && st.locked)} aria={`${p.id} switch ${st.on ? 'off' : 'on'}`} testId={`${p.id}:toggle`} onClick={() => cmd({ kind: 'switch', part: p.id, on: !st.on })} />);
        if (p.type === 'isolator3') {
          els.push(<Btn key="b2" x={lx + 102} y={by} w={78} label={st.locked ? 'Unlock' : 'Lock'} enabled={!st.on || !!st.locked} aria={`${p.id} ${st.locked ? 'remove lock' : 'fit lock and tag'}`} testId={`${p.id}:lock`} onClick={() => cmd({ kind: st.locked ? 'unlock' : 'lock', part: p.id })} />);
        }
      }
      break;
    }
    case 'mcb2': {
      const closed = !!st.on;
      contact('1', '2', closed);
      contact('3', '4', closed);
      link(['1', '3'], !closed);
      els.push(<text key="st" x={(P('3')?.[0] ?? lx) + 24} y={(P('1')?.[1] ?? ly) + 60} className={`state ${st.tripped ? 'state-warn' : ''}`}>{st.tripped ? 'TRIPPED' : st.on ? 'ON' : 'OFF'}</text>);
      if (ctl) els.push(<Btn key="b1" x={(P('3')?.[0] ?? lx) + 24} y={(P('1')?.[1] ?? ly) + 10} w={84} label={st.on ? 'OFF' : 'ON'} enabled aria={`${p.id} switch ${st.on ? 'off' : 'on'}`} testId={`${p.id}:toggle`} onClick={() => cmd({ kind: 'switch', part: p.id, on: !st.on })} />);
      break;
    }
    case 'contactor': {
      const on = !!st.energised;
      contact('1', '2', on);
      contact('3', '4', on);
      contact('5', '6', on);
      link(['1', '3', '5'], !on);
      contact('13', '14', on);
      contact('43', '44', on);
      contact('21', '22', !on, true);
      box('A1', 'A2', on, st.burnt ? 'BURNT' : on ? 'ON' : 'off');
      const A1 = P('A1');
      if (A1) els.push(<text key="cl" x={A1[0] - 20} y={A1[1] + 30} textAnchor="end" className="plabel">{p.id}</text>);
      for (const [a, t] of [['13', `${p.id}`], ['43', `${p.id}`]] as const) {
        const A = P(a);
        if (A) els.push(<text key={`al${a}`} x={A[0] - 18} y={A[1] + 30} textAnchor="end" className="plabel">{t}</text>);
      }
      break;
    }
    case 'overload': {
      thermal('1', '2');
      thermal('3', '4');
      thermal('5', '6');
      contact('95', '96', !st.tripped, true);
      contact('97', '98', !!st.tripped);
      for (const a of ['95', '97']) {
        const A = P(a);
        if (A) els.push(<text key={`ol${a}`} x={A[0] - 18} y={A[1] + 30} textAnchor="end" className="plabel">{p.id}</text>);
      }
      els.push(<text key="st" x={lx} y={ly + 56} className={`state ${st.tripped ? 'state-warn' : ''}`}>{st.tripped ? 'TRIPPED' : `OK · heat ${st.thermalPct}%`} · set {p.params?.setting} A</text>);
      if (ctl) {
        els.push(<Btn key="t" x={lx} y={by} label="TEST" enabled aria={`${p.id} test trip`} testId={`${p.id}:test`} onClick={() => cmd({ kind: 'trip-test', part: p.id })} />);
        els.push(<Btn key="r" x={lx + 70} y={by} label="RESET" kind={st.tripped ? 'warn' : 'normal'} enabled aria={`${p.id} reset`} testId={`${p.id}:reset`} onClick={() => cmd({ kind: 'reset', part: p.id })} />);
      }
      break;
    }
    case 'pb_no':
    case 'pb_nc': {
      const nc = p.type === 'pb_nc';
      const [a, b] = nc ? ['11', '12'] : ['13', '14'];
      contact(a, b, nc ? !st.pressed : !!st.pressed, nc);
      if (ctl) {
        const A = P(a)!;
        const name = p.label.split(' ').slice(1).join(' ') || p.id;
        els.push(
          <Btn key="pb" x={A[0] - 120} y={A[1] + 2} w={86} label={st.pressed ? `${name} ●` : name} kind={nc ? 'stop' : 'go'} enabled
            aria={`${p.label}: press and hold`} testId={`${p.id}:press`}
            onDown={() => cmd({ kind: 'press', part: p.id })} onUp={() => cmd({ kind: 'release', part: p.id })} />,
        );
      }
      break;
    }
    case 'lamp24': {
      const A = P('X1');
      const B = P('X2');
      if (A && B) {
        const x = A[0];
        const m = (A[1] + B[1]) / 2;
        els.push(
          <g key="lamp">
            <line x1={x} y1={A[1]} x2={x} y2={m - 12} stroke={INK} strokeWidth={2.5} />
            <line x1={x} y1={m + 12} x2={x} y2={B[1]} stroke={INK} strokeWidth={2.5} />
            <circle cx={x} cy={m} r={12} fill={st.lit ? '#ffd23f' : '#fff'} stroke={INK} strokeWidth={2.5} />
            <path d={`M${x - 8},${m - 8} L${x + 8},${m + 8} M${x + 8},${m - 8} L${x - 8},${m + 8}`} stroke={INK} strokeWidth={2} />
            <text x={x - 18} y={m + 5} textAnchor="end" className="state">{st.burnt ? 'BURNT' : st.lit ? 'LIT' : 'off'}</text>
          </g>,
        );
      }
      break;
    }
    case 'resistor': {
      box('1', '2', false, `${p.params?.ohms ?? '?'} Ω`);
      break;
    }
    case 'sw_no': {
      contact('13', '14', !!st.on);
      if (ctl) {
        const A = P('13')!;
        els.push(
          <Btn key="sw" x={A[0] - 120} y={A[1] + 2} w={86} label={st.on ? 'Turn OFF' : 'Turn ON'} kind={st.on ? 'warn' : 'normal'} enabled
            aria={`${p.label}: turn ${st.on ? 'off' : 'on'}`} testId={`${p.id}:toggle`} onClick={() => cmd({ kind: 'switch', part: p.id, on: !st.on })} />,
        );
      }
      els.push(<text key="swst" x={(P('14')?.[0] ?? lx) + 10} y={(P('14')?.[1] ?? ly) + 20} className="state">{st.on ? 'ON' : 'OFF'}</text>);
      break;
    }
    case 'tstrip': {
      const pts = Object.values(p.pins);
      if (pts.length) {
        const xs = pts.map((q) => q[0]);
        const y = pts[0][1];
        els.push(<rect key="strip" x={Math.min(...xs) - 18} y={y - 14} width={Math.max(...xs) - Math.min(...xs) + 36} height={28} rx={3} fill="#e8eefb" stroke={INK} strokeWidth={2} />);
        for (const q of pts) els.push(<line key={`d${q[0]}`} x1={q[0] + 20} y1={y - 14} x2={q[0] + 20} y2={y + 14} stroke={INK} strokeWidth={1} />);
      }
      break;
    }
    case 'psu24': {
      const pts = ['L', 'N', 'P', 'M'].map((t) => P(t)).filter(Boolean) as XY[];
      if (pts.length === 4) {
        const x0 = Math.min(...pts.map((q) => q[0])) - 22;
        const x1 = Math.max(...pts.map((q) => q[0])) + 22;
        const y0 = Math.min(...pts.map((q) => q[1])) + 12;
        const y1 = Math.max(...pts.map((q) => q[1])) - 12;
        els.push(
          <g key="psu">
            <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={st.psuOn ? '#e5f4ea' : '#fff'} stroke={INK} strokeWidth={2.5} rx={4} />
            <text x={(x0 + x1) / 2} y={(y0 + y1) / 2 - 3} textAnchor="middle" className="state">24 V DC</text>
            <text x={(x0 + x1) / 2} y={(y0 + y1) / 2 + 14} textAnchor="middle" className={`state ${st.psuOn ? '' : 'state-warn'}`}>{st.psuOn ? 'OUTPUT ON' : 'OUTPUT OFF'}</text>
          </g>,
        );
      }
      break;
    }
    case 'motor3': {
      const U = P('U1');
      const W = P('W1');
      const E = P('PE');
      if (U && W) {
        const cx = (U[0] + W[0]) / 2;
        const cy = U[1] + 42;
        const m = st.motor!;
        const stateText: Record<string, string> = {
          stopped: 'STOPPED', starting: 'STARTING', running: 'RUNNING', stalled: 'STALLED (humming)', 'single-phasing': 'TWO PHASES ONLY', coasting: 'COASTING',
        };
        els.push(
          <g key="mot">
            {['U1', 'V1', 'W1'].map((t) => {
              const T = P(t)!;
              return <line key={t} x1={T[0]} y1={T[1]} x2={cx + (T[0] - cx) * 0.4} y2={cy - 22} stroke={INK} strokeWidth={2.5} />;
            })}
            {E && <path d={`M${E[0]},${E[1]} V${cy} H${cx + 28}`} stroke="#2e7d32" strokeWidth={2.5} fill="none" strokeDasharray="6 3" />}
            <circle cx={cx} cy={cy} r={28} fill={m.state === 'running' ? '#e5f4ea' : m.state === 'stalled' || m.state === 'single-phasing' ? '#fde8ea' : '#fff'} stroke={INK} strokeWidth={2.5} />
            <text x={cx} y={cy - 2} textAnchor="middle" className="state">M</text>
            <text x={cx} y={cy + 14} textAnchor="middle" className="tlabel">3~</text>
            <text x={cx + 40} y={cy + 36} className={`state ${m.state === 'stalled' || m.state === 'single-phasing' ? 'state-warn' : ''}`}>{stateText[m.state]}{m.direction ? (m.direction === 'forward' ? ' ⟳' : ' ⟲') : ''}</text>
            <text x={cx + 40} y={cy + 52} className="tlabel">{Math.abs(m.rpm)} rpm · {m.amps} A</text>
          </g>,
        );
      }
      break;
    }
  }

  return (
    <g data-part={p.id}>
      {els}
      <text x={lx} y={ly} className="plabel">{p.label}</text>
      {tag && <text x={lx} y={ly + 56} className="tag-label">Tag: {tag}</text>}
    </g>
  );
}
