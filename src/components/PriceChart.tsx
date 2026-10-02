import { useEffect, useMemo, useRef, useState } from 'react';
import type { Battle, Token } from '../data/types';
import { useData } from '../data/DataContext';
import { fetchCandles, type Candle, type Timeframe } from '../live/market';
import { clock, pct, price as fmtPrice, usd } from '../lib/format';
import { sideColor } from './ui';

type View = 'a' | 'b' | 'compare';
const alpha = (hsl: string, a: number) => hsl.replace(')', ` / ${a})`);
const INTERVALS: { k: string; tf: Timeframe; ms: number }[] = [
  { k: '1m', tf: { tf: 'minute', aggregate: 1 }, ms: 60_000 },
  { k: '5m', tf: { tf: 'minute', aggregate: 5 }, ms: 300_000 },
  { k: '15m', tf: { tf: 'minute', aggregate: 15 }, ms: 900_000 },
  { k: '1h', tf: { tf: 'hour', aggregate: 1 }, ms: 3_600_000 },
  { k: 'ALL', tf: { tf: 'minute', aggregate: 5 }, ms: 300_000 },
];

/** Real OHLCV from GeckoTerminal, refreshed every 60s. */
function useCandles(token: Token | undefined, tf: Timeframe) {
  const [data, setData] = useState<{ candles: Candle[]; error?: string; loading: boolean }>({ candles: [], loading: true });
  useEffect(() => {
    if (!token?.pairAddress) return;
    let alive = true;
    const load = () => fetchCandles(token.pairAddress, token.mint, tf)
      .then((candles) => alive && setData({ candles, loading: false }))
      .catch((e) => alive && setData((d) => ({ ...d, loading: false, error: (e as Error).message })));
    setData((d) => ({ ...d, loading: true }));
    void load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [token?.pairAddress, token?.mint, tf.tf, tf.aggregate]); // eslint-disable-line react-hooks/exhaustive-deps
  return data;
}

export function PriceChart({ battle, height = 360 }: { battle: Battle; height?: number }) {
  const e = useData();
  const [view, setView] = useState<View>('compare');
  const [iv, setIv] = useState('5m');
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const ta = e.tokens[battle.a.tokenId];
  const tb = e.tokens[battle.b.tokenId];
  const interval = INTERVALS.find((x) => x.k === iv)!;
  const A = useCandles(ta, interval.tf);
  const B = useCandles(tb, interval.tf);
  const started = battle.startedAt;

  useEffect(() => {
    const ro = new ResizeObserver(([en]) => setW(Math.floor(en.contentRect.width)));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const series = useMemo(() => {
    const since = iv === 'ALL' && started ? started - interval.ms : 0;
    const ca = A.candles.filter((c) => c.t >= since);
    const cb = B.candles.filter((c) => c.t >= since);
    if (view === 'compare') {
      // Normalise to % since battle start (or since the first visible candle before the battle starts).
      const baseA = battle.a.startPrice ?? ca.find((c) => !started || c.t >= started - interval.ms)?.o ?? ca[0]?.o;
      const baseB = battle.b.startPrice ?? cb.find((c) => !started || c.t >= started - interval.ms)?.o ?? cb[0]?.o;
      const pts = (cs: Candle[], base?: number) => (base ? cs.map((c) => ({ t: c.t, v: c.c / base - 1, vol: c.v })) : []);
      return { kind: 'compare' as const, ca: pts(ca, baseA), cb: pts(cb, baseB) };
    }
    const cs = view === 'a' ? ca : cb;
    return { kind: iv === 'ALL' ? ('line' as const) : ('candle' as const), c: cs };
  }, [A.candles, B.candles, view, iv, started, battle.a.startPrice, battle.b.startPrice, interval.ms]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !ta || !tb) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr;
    cv.height = height * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, height);
    const padR = 70, padL = 8, padT = 14, volH = 46, padB = 22;
    const plotH = height - padT - padB - volH;
    const plotW = w - padL - padR;
    const colA = sideColor(ta.hue), colB = sideColor(tb.hue);
    ctx.font = '10.5px JetBrains Mono, monospace';

    const allT = series.kind === 'compare' ? [...series.ca, ...series.cb].map((p) => p.t) : series.c.map((c) => c.t);
    if (!allT.length) return;
    const maxCandles = Math.max(20, Math.floor(plotW / 7));
    let t0 = Math.min(...allT);
    const t1 = Math.max(...allT) + interval.ms;
    if (series.kind === 'candle') t0 = Math.max(t0, t1 - maxCandles * interval.ms);
    const X = (t: number) => padL + ((t - t0) / (t1 - t0 || 1)) * plotW;

    const vis = <T extends { t: number }>(arr: T[]) => arr.filter((p) => p.t >= t0);
    let vals: number[];
    if (series.kind === 'compare') vals = [...vis(series.ca).map((p) => p.v), ...vis(series.cb).map((p) => p.v), 0];
    else if (series.kind === 'line') vals = vis(series.c).map((c) => c.c);
    else vals = vis(series.c).flatMap((c) => [c.h, c.l]);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 1e-12) { lo -= Math.abs(lo) * 0.01 + 1e-9; hi += Math.abs(hi) * 0.01 + 1e-9; }
    const pad = (hi - lo) * 0.08;
    lo -= pad; hi += pad;
    const Y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * plotH;

    ctx.strokeStyle = 'rgba(15,23,42,0.043)';
    ctx.fillStyle = 'rgba(71,85,105,0.6)';
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) * i) / 4;
      const y = Math.round(Y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
      ctx.fillText(series.kind === 'compare' ? pct(v, 1) : fmtPrice(v), padL + plotW + 6, y + 3);
    }
    for (let i = 0; i <= 4; i++) {
      const t = t0 + ((t1 - t0) * i) / 4;
      const label = started ? (t >= started ? `T+${clock(t - started).replace(/^0:/, '')}` : `T−${clock(started - t).replace(/^0:/, '')}`) : new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      ctx.fillText(label, padL + (plotW * i) / 4 - (i === 4 ? 56 : 0), height - 6);
    }

    const marker = (t: number | undefined, label: string, color: string) => {
      if (!t || t < t0 || t > t1) return;
      const x = Math.round(X(t)) + 0.5;
      ctx.strokeStyle = color; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH + volH); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = color; ctx.font = 'bold 9.5px Inter, sans-serif'; ctx.fillText(label, x + 5, padT + 10);
      ctx.font = '10.5px JetBrains Mono, monospace';
    };
    marker(started, 'BATTLE START', 'rgba(57,227,255,0.7)');
    if (started) marker(started + battle.rules.randomEnd.minDurationMs, 'RANDOM END ZONE →', 'rgba(255,181,71,0.75)');
    marker(battle.endedAt, '🏁 BATTLE ENDED', 'rgba(255,207,90,0.95)');

    const volBase = padT + plotH + volH;
    const line = (pts: { t: number; v: number }[], col: string, fill: boolean) => {
      if (!pts.length) return;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p.v)) : ctx.moveTo(X(p.t), Y(p.v))));
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0;
      if (fill) {
        const g = ctx.createLinearGradient(0, padT, 0, padT + plotH);
        g.addColorStop(0, alpha(col, 0.22)); g.addColorStop(1, alpha(col, 0));
        ctx.lineTo(X(pts.at(-1)!.t), padT + plotH); ctx.lineTo(X(pts[0].t), padT + plotH); ctx.closePath();
        ctx.fillStyle = g; ctx.fill();
      }
      const last = pts.at(-1)!;
      ctx.beginPath(); ctx.arc(X(last.t), Y(last.v), 3.5, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    };
    const tag = (v: number, col: string, text: string) => {
      const y = Y(v);
      ctx.fillStyle = col; ctx.fillRect(padL + plotW + 2, y - 8, padR - 4, 16);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 10px JetBrains Mono, monospace'; ctx.fillText(text, padL + plotW + 5, y + 4);
      ctx.font = '10.5px JetBrains Mono, monospace';
    };

    if (series.kind === 'compare') {
      const pa = vis(series.ca), pb = vis(series.cb);
      const maxV = Math.max(1e-9, ...pa.map((p) => p.vol), ...pb.map((p) => p.vol));
      const bw = Math.max(1, (plotW / Math.max(pa.length, 1)) * 0.38);
      for (const [pts, col, off] of [[pa, colA, -bw / 2], [pb, colB, bw / 2]] as const) {
        ctx.fillStyle = alpha(col, 0.35);
        for (const p of pts) { const h = (p.vol / maxV) * (volH - 6); ctx.fillRect(X(p.t) + off - bw / 2, volBase - h, bw, h); }
      }
      ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(15,23,42,0.187)';
      ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(padL + plotW, Y(0)); ctx.stroke(); ctx.setLineDash([]);
      line(pa, colA, false);
      line(pb, colB, false);
      if (pa.length) tag(pa.at(-1)!.v, colA, pct(pa.at(-1)!.v));
      if (pb.length) tag(pb.at(-1)!.v, colB, pct(pb.at(-1)!.v));
    } else {
      const col = view === 'a' ? colA : colB;
      const cs = vis(series.c);
      const maxV = Math.max(1e-9, ...cs.map((c) => c.v));
      const cw = Math.max(2, (plotW / ((t1 - t0) / interval.ms)) * 0.7);
      for (const c of cs) {
        ctx.fillStyle = c.c >= c.o ? 'rgba(46,230,160,0.28)' : 'rgba(255,79,109,0.28)';
        const h = (c.v / maxV) * (volH - 6);
        ctx.fillRect(X(c.t + interval.ms / 2) - cw / 2, volBase - h, cw, h);
      }
      if (series.kind === 'line') line(cs.map((c) => ({ t: c.t, v: c.c })), col, true);
      else for (const c of cs) {
        const up = c.c >= c.o;
        const x = X(c.t + interval.ms / 2);
        ctx.strokeStyle = ctx.fillStyle = up ? '#059669' : '#ff4f6d';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, Y(c.h)); ctx.lineTo(Math.round(x) + 0.5, Y(c.l)); ctx.stroke();
        const y1 = Y(Math.max(c.o, c.c)), y2 = Y(Math.min(c.o, c.c));
        ctx.fillRect(x - cw / 2, y1, cw, Math.max(1, y2 - y1));
      }
      if (cs.length) tag(cs.at(-1)!.c, col, fmtPrice(cs.at(-1)!.c));
    }
    if (hover !== null && hover >= padL && hover <= padL + plotW) {
      ctx.strokeStyle = 'rgba(15,23,42,0.212)';
      ctx.beginPath(); ctx.moveTo(hover + 0.5, padT); ctx.lineTo(hover + 0.5, padT + plotH + volH); ctx.stroke();
    }
    (cv as unknown as { _map: unknown })._map = { t0, t1, padL, plotW };
  }, [series, w, height, hover, view, battle, ta, tb, started, interval.ms]);

  let tip: React.ReactNode = null;
  const map = (canvas.current as unknown as { _map?: { t0: number; t1: number; padL: number; plotW: number } })?._map;
  if (hover !== null && map) {
    const t = map.t0 + ((hover - map.padL) / map.plotW) * (map.t1 - map.t0);
    const near = <T extends { t: number }>(arr: T[]) => arr.reduce<T | undefined>((b, p) => (!b || Math.abs(p.t - t) < Math.abs(b.t - t) ? p : b), undefined);
    const when = (tt: number) => new Date(tt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    if (series.kind === 'compare') {
      const pa = near(series.ca), pb = near(series.cb);
      if (pa && pb && ta && tb) tip = (<><div className="dim mono">{when(pa.t)}</div><div className="mono" style={{ color: sideColor(ta.hue, 70) }}>{ta.ticker} {pct(pa.v)}</div><div className="mono" style={{ color: sideColor(tb.hue, 70) }}>{tb.ticker} {pct(pb.v)}</div></>);
    } else {
      const c = near(series.c);
      if (c) tip = (<><div className="dim mono">{when(c.t)}</div><div className="mono">O {fmtPrice(c.o)} H {fmtPrice(c.h)}</div><div className="mono">L {fmtPrice(c.l)} C {fmtPrice(c.c)}</div><div className="mono muted">Vol {usd(c.v)}</div></>);
    }
  }

  const err = A.error || B.error;
  const empty = !A.loading && !B.loading && !A.candles.length && !B.candles.length;
  return (
    <div className="panel chart-panel">
      <div className="panel-head chart-head">
        <div className="seg">
          <button className={view === 'a' ? 'active' : ''} onClick={() => setView('a')}><span style={{ color: sideColor(ta?.hue ?? 0) }}>●</span> {ta?.ticker}</button>
          <button className={view === 'b' ? 'active' : ''} onClick={() => setView('b')}><span style={{ color: sideColor(tb?.hue ?? 0) }}>●</span> {tb?.ticker}</button>
          <button className={view === 'compare' ? 'active' : ''} onClick={() => setView('compare')}>Compare</button>
        </div>
        <div className="seg">
          {INTERVALS.map((x) => <button key={x.k} className={iv === x.k ? 'active' : ''} onClick={() => setIv(x.k)}>{x.k}</button>)}
        </div>
      </div>
      <div ref={wrap} className="chart-wrap" style={{ height }}
        onMouseMove={(ev) => setHover(ev.clientX - ev.currentTarget.getBoundingClientRect().left)}
        onMouseLeave={() => setHover(null)}>
        <canvas ref={canvas} style={{ width: w, height, display: 'block' }} />
        {(A.loading || B.loading) && !A.candles.length && <div className="chart-msg">Loading live candles…</div>}
        {err && !A.candles.length && <div className="chart-msg">Chart data unavailable ({err}). Retrying every minute.</div>}
        {empty && !err && <div className="chart-msg">No candles yet for this timeframe.</div>}
        {tip && <div className="chart-tip" style={{ left: Math.min(hover! + 14, w - 170) }}>{tip}</div>}
        <div className="chart-legend">
          {view === 'compare' ? <span>% change {started ? 'since battle start' : 'over the window'} · {iv === 'ALL' ? 'full battle' : `${iv} candles`}</span> : <span>{(view === 'a' ? ta : tb)?.ticker}/USD · {iv === 'ALL' ? 'full battle' : `${iv} candles`}</span>}
          <span> · GeckoTerminal</span>
        </div>
      </div>
    </div>
  );
}
