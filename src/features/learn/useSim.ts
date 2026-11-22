import { useCallback, useEffect, useRef, useState } from 'react';
import type { Circuit } from '../../engines/wiring/circuit';

/**
 * Runs a circuit in real time (10 ms engine steps) and re-renders after each tick or change.
 * The engine stays pure; this hook only owns the clock.
 */
export function useSim(make: () => Circuit, deps: unknown[] = []) {
  const ref = useRef<Circuit | null>(null);
  const [version, setVersion] = useState(0);
  const [running, setRunning] = useState(true);

  if (ref.current === null) ref.current = make();

  const reset = useCallback(() => {
    ref.current = make();
    setVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Rebuild only when the inputs change after mount; the first circuit is already built above.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      ref.current!.step(10);
      ref.current!.step(10);
      ref.current!.step(10);
      ref.current!.step(10);
      ref.current!.step(10);
      setVersion((v) => v + 1);
    }, 50);
    return () => window.clearInterval(id);
  }, [running]);

  const apply = useCallback((fn: (c: Circuit) => void) => {
    fn(ref.current!);
    setVersion((v) => v + 1);
  }, []);

  return { circuit: ref.current!, version, running, setRunning, reset, apply };
}
