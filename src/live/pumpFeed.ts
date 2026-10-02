import { useEffect, useRef, useState } from 'react';

/** A coin as it is created on pump.fun (PumpPortal's live stream). */
export interface NewPumpCoin {
  mint: string;
  name: string;
  symbol: string;
  uri?: string;
  creator?: string;
  marketCapSol?: number;
  initialBuySol?: number;
  t: number;
  image?: string;
}

const WS_URL = 'wss://pumpportal.fun/api/data';
const MAX = 60;

/**
 * Live feed of new pump.fun coins. Connects only while `enabled`, reconnects with
 * backoff, and keeps the newest MAX coins in memory (nothing is stored server-side).
 */
export function usePumpFeed(enabled: boolean, paused: boolean) {
  const [coins, setCoins] = useState<NewPumpCoin[]>([]);
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | undefined;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const connect = () => {
      setStatus('connecting');
      try { ws = new WebSocket(WS_URL); } catch { setStatus('offline'); return; }
      ws.onopen = () => { retry = 0; setStatus('live'); ws!.send(JSON.stringify({ method: 'subscribeNewToken' })); };
      ws.onmessage = (ev) => {
        if (pausedRef.current) return;
        let m: any;
        try { m = JSON.parse(String(ev.data)); } catch { return; }
        if (!m?.mint || !m?.symbol || (m.txType && m.txType !== 'create')) return;
        const coin: NewPumpCoin = {
          mint: m.mint, name: String(m.name ?? '').slice(0, 60), symbol: String(m.symbol).slice(0, 20), uri: m.uri,
          creator: m.traderPublicKey, marketCapSol: typeof m.marketCapSol === 'number' ? m.marketCapSol : undefined,
          initialBuySol: typeof m.solAmount === 'number' ? m.solAmount : undefined, t: Date.now(),
        };
        setCoins((prev) => (prev.some((c) => c.mint === coin.mint) ? prev : [coin, ...prev].slice(0, MAX)));
      };
      ws.onclose = () => {
        if (closed) return;
        setStatus('offline');
        timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++));
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => { closed = true; clearTimeout(timer); ws?.close(); };
  }, [enabled]);

  return { coins, status };
}

/** Image URLs from the coins' metadata JSON (fetched once per coin, only for coins on screen). */
const imageCache = new Map<string, string | null>();
export function useCoinImage(uri?: string) {
  const [img, setImg] = useState<string | null | undefined>(uri ? imageCache.get(uri) : null);
  useEffect(() => {
    if (!uri || imageCache.has(uri)) return;
    let alive = true;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    fetch(uri, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { const v = typeof j?.image === 'string' ? j.image : null; imageCache.set(uri, v); if (alive) setImg(v); })
      .catch(() => { imageCache.set(uri, null); if (alive) setImg(null); })
      .finally(() => clearTimeout(t));
    return () => { alive = false; ctl.abort(); };
  }, [uri]);
  return img ?? undefined;
}
