import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/** Status chips always pair an icon with a word, never colour alone. */
export type Status = 'locked' | 'open' | 'progress' | 'awaiting' | 'passed' | 'signed' | 'failed' | 'planned';
const STATUS: Record<Status, { icon: string; label: string }> = {
  locked: { icon: '🔒', label: 'Locked' },
  open: { icon: '○', label: 'Open' },
  progress: { icon: '▶', label: 'In progress' },
  awaiting: { icon: '⏳', label: 'Awaiting sign-off' },
  passed: { icon: '✔', label: 'Passed' },
  signed: { icon: '✔', label: 'Passed and signed' },
  failed: { icon: '✖', label: 'Not passed' },
  planned: { icon: '🛠', label: 'Being built' },
};

export function StatusChip({ status, label }: { status: Status; label?: string }) {
  const s = STATUS[status];
  return (
    <span className={`chip chip-${status}`}>
      <span aria-hidden="true">{s.icon}</span> {label ?? s.label}
    </span>
  );
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      {title && <h2>{title}</h2>}
      {children}
      {actions && <div className="actions">{actions}</div>}
    </section>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'ok' | 'error'; children: ReactNode }) {
  const icon = { info: 'ℹ', warn: '⚠', ok: '✔', error: '✖' }[kind];
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span aria-hidden="true" className="notice-icon">{icon}</span>
      <div>{children}</div>
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog ref={ref} className="modal" aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

/** Runs an async action and keeps its error message for display. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

export function downloadText(fileName: string, text: string, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function readFileText(file: File): Promise<string> {
  return file.text();
}
