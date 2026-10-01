import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { LiveStore, type StoreEvent } from '../live/store';

/** One live store for the app: Supabase (battle state), DexScreener (markets), Jupiter (swaps). */
const store = new LiveStore();
const Ctx = createContext<LiveStore>(store);

export function DataProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

/** Subscribe to the store; re-renders on every change. */
export function useData() {
  const e = useContext(Ctx);
  useSyncExternalStore((cb) => e.subscribe(cb), () => e.version);
  return e;
}

export function useEngine() {
  return useContext(Ctx);
}

export function useEngineEvent(cb: (e: StoreEvent) => void, deps: unknown[] = []) {
  const e = useContext(Ctx);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => e.onEvent(cb), [e, ...deps]);
}

/** Load a battle's live detail (snapshots, trades, feed, chat, checks) while mounted. */
export function useBattleDetail(id: string | undefined) {
  const e = useData();
  useEffect(() => (id ? e.watch(id) : undefined), [e, id]);
  return id ? e.detail(id) : undefined;
}
