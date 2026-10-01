import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { SimEngine } from '../sim/engine';
import type { EngineEvent } from './provider';

/**
 * The prototype binds the UI to `SimEngine`. To go live, construct a provider
 * backed by chain data here instead — components only use `useData()`.
 */
const engine = new SimEngine();
engine.start();
if (import.meta.env.DEV) (window as unknown as { battle: SimEngine }).battle = engine;

const Ctx = createContext<SimEngine>(engine);

export function DataProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={engine}>{children}</Ctx.Provider>;
}

/** Subscribe to the data provider; re-renders on every state change (≈2.5Hz). */
export function useData() {
  const e = useContext(Ctx);
  useSyncExternalStore(
    (cb) => e.subscribe(cb),
    () => e.version,
  );
  return e;
}

/** Non-reactive access (for event handlers). */
export function useEngine() {
  return useContext(Ctx);
}

export function useEngineEvent(cb: (e: EngineEvent) => void, deps: unknown[] = []) {
  const e = useContext(Ctx);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => e.onEvent(cb), [e, ...deps]);
}
