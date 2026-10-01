import { useEffect, useMemo, useRef, useState } from 'react';
import type { Battle, PricePoint } from '../data/types';
import { useData } from '../data/DataContext';
import { clock, pct, price as fmtPrice, usd, quoteToUsd } from '../lib/format';
import { sideColor } from './ui';

type View = 'a' | 'b' | 'compare';
const alpha = (hsl: string, a: number) => hsl.replace(')', ` / ${a})`);
const INTERVALS = [
  { k: '1m', ms: 60_000 },
  { k: '5m', ms: 300_000 },
  { k: '15m', ms: 900_000 },
  { k: '1h', ms: 3_600_000 },
  { k: 'ALL', ms: 0 },
] as const;
type IntervalKey = (typeof INTERVALS)[number]['k'];

interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

function candles(hist: PricePoint[], ms: number, start: number): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | undefined;
  for (const p of hist) {
    const bucket = start + Math.floor((p.t - start) / ms) * ms;
    if (!cur || cur.t !== bucket) {
      const o = cur ? cur.c : p.price;
      cur = { t: bucket, o, h: Math.max(o, p.price), l: Math.min(o, p.price), c: p.price, v: p.volume };
      out.push(cur);
    } else {
      cur.h = Math.max(cur.h, p.price);
      cur.l = Math.min(cur.l, p.price);
      cur.c = p.price;
      cur.v += p.volume;
    }
  }
  return out;
}

/**
 * Canvas chart: candles for a single token, normalised % lines for compare.
 * "1m / 5m / 15m / 1h" are candle intervals; "ALL" draws the full battle as a line.
 */
export function PriceChart({ battle, height = 360 }: { battle: Battle; height?: number }) {
  const e = useData();
  const [view, setView] = useState<View>('compare');
  const [iv, setIv] = useState<IntervalKey>('1m');
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const ta = e.tokens[battle.a.tokenId];
  const tb = e.tokens[battle.b.tokenId];

  useEffect(() => {
    const ro = new ResizeObserver(([en]) => setW(Math.floor(en.contentRect.width)));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const start = battle.startedAt ?? e.now;
  const ivMs = INTERVALS.find((x) => x.k === iv)!.ms;
  const lineMode = view === 'compare' || iv === 'ALL';

  // Compute series (cheap enough to redo per version tick).
  const series = useMemo(() => {
    const live = (h: PricePoint[], p: number) => (h.length ? [...h, { t: e.now, price: p, volume: 0 }] : h);
    const ha = live(battle.a.history, e.markets[ta.id].price);
    const hb = live(battle.b.history, e.markets[tb.id].price);
    if (view === 'compare') {
      const bucket = iv === 'ALL' ? Math.max(5000, Math.ceil((e.now - start) / 300 / 5000) * 5000) : Math.max(5000, ivMs / 6);
      const ca = candles(ha, bucket, start).map((c) => ({ t: c.t, v: c.c / battle.a.startPrice - 1, vol: c.v }));
      const cb = candles(hb, bucket, start).map((c) => ({ t: c.t, v: c.c / battle.b.startPrice - 1, vol: c.v }));
      return { kind: 'compare' as const, ca, cb };
    }
    const h = view === 'a' ? ha : hb;
    if (iv === 'ALL') {
      const bucket = Math.max(5000, Math.ceil((e.now - start) / 300 / 5000) * 5000);
      return { kind: 'line' as const, c: candles(h, bucket, start) };
    }
    return { kind: 'candle' as const, c: candles(h, ivMs, start) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.version, view, iv, battle.id]);

  // Draw
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr;
    cv.height = height * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, height);
    const padR = 64, padL = 8, padT = 14, volH = 46, padB = 22;
    const plotH = height - padT - padB - volH;
    const plotW = w - padL - padR;
    const colA = sideColor(ta.hue);
    const colB = sideColor(tb.hue);
    ctx.font = '10.5px JetBrains Mono, monospace';

    const minMark = start + battle.rules.randomEnd.minDurationMs;
    const endT = battle.endedAt;

    // Time domain
    let t0: number, t1: number;
    let maxCandles = 0;
    if (series.kind === 'candle') {
      maxCandles = Math.max(12, Math.floor(plotW / 7));
      const cs = series.c.slice(-maxCandles);
      t0 = cs.length ? cs[0].t : start;
      t1 = t0 + ivMs * Math.max(cs.length + 2, Math.min(maxCandles, 30));
    } else {
      t0 = start;
      t1 = Math.max(e.now, start + 60_000) + (e.now - start) * 0.03;
    }
    const X = (t: number) => padL + ((t - t0) / (t1 - t0)) * plotW;

    // Value domain
    let vals: number[] = [];
    if (series.kind === 'compare') vals = [...series.ca.map((p) => p.v), ...series.cb.map((p) => p.v), 0];
    else if (series.kind === 'line') vals = series.c.map((c) => c.c);
    else vals = series.c.slice(-maxCandles).flatMap((c) => [c.h, c.l]);
    if (!vals.length) vals = [0, 1];
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi - lo < (series.kind === 'compare' ? 0.02 : hi * 0.01)) { const m = (hi + lo) / 2; const d = series.kind === 'compare' ? 0.01 : Math.abs(m) * 0.005 + 1e-12; lo = m - d; hi = m + d; }
    const pad = (hi - lo) * 0.08;
    lo -= pad; hi += pad;
    const Y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * plotH;

    // Grid + y labels
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(180,188,203,0.6)';
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) * i) / 4;
      const y = Math.round(Y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
      const label = series.kind === 'compare' ? pct(v, 1) : fmtPrice(v);
      ctx.fillText(label, padL + plotW + 6, y + 3);
    }
    // time labels
    for (let i = 0; i <= 4; i++) {
      const t = t0 + ((t1 - t0) * i) / 4;
      ctx.fillText(clock(t - start).replace(/^0:/, ''), padL + (plotW * i) / 4 - (i === 4 ? 40 : 0), height - 6);
    }

    // zero line for compare
    if (series.kind === 'compare') {
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(padL + plotW, Y(0)); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Min-time marker & end marker
    const marker = (t: number, label: string, color: string) => {
      if (t < t0 || t > t1) return;
      const x = Math.round(X(t)) + 0.5;
      ctx.strokeStyle = color; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH + volH); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = color; ctx.font = 'bold 9.5px Inter, sans-serif';
      ctx.fillText(label, x + 5, padT + 10);
      ctx.font = '10.5px JetBrains Mono, monospace';
    };
    marker(minMark, 'RANDOM END ZONE →', 'rgba(255,181,71,0.75)');
    if (endT) marker(endT, '🏁 BATTLE ENDED', 'rgba(255,207,90,0.95)');
    if (endT) {
      ctx.fillStyle = 'rgba(255,255,255,0.025)';
      ctx.fillRect(X(endT), padT, padL + plotW - X(endT), plotH + volH);
    } else if (e.now > minMark) {
      ctx.fillStyle = 'rgba(255,181,71,0.035)';
      ctx.fillRect(Math.max(padL, X(minMark)), padT, padL + plotW - Math.max(padL, X(minMark)), plotH + volH);
    }

    const volBase = padT + plotH + volH;
    const drawLine = (pts: { t: number; v: number; vol: number }[], col: string, fill: boolean) => {
      if (pts.length < 1) return;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p.v)) : ctx.moveTo(X(p.t), Y(p.v))));
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0;
      if (fill) {
        const g = ctx.createLinearGradient(0, padT, 0, padT + plotH);
        g.addColorStop(0, alpha(col, 0.22));
        g.addColorStop(1, alpha(col, 0));
        ctx.lineTo(X(pts.at(-1)!.t), padT + plotH); ctx.lineTo(X(pts[0].t), padT + plotH); ctx.closePath();
        ctx.fillStyle = g; ctx.fill();
      }
      const last = pts.at(-1)!;
      ctx.beginPath(); ctx.arc(X(last.t), Y(last.v), 3.5, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
      ctx.beginPath(); ctx.arc(X(last.t), Y(last.v), 8, 0, Math.PI * 2); ctx.fillStyle = alpha(col, 0.2); ctx.fill();
    };

    if (series.kind === 'compare') {
      const maxV = Math.max(1e-9, ...series.ca.map((p) => p.vol), ...series.cb.map((p) => p.vol));
      const bw = Math.max(1, (plotW / Math.max(series.ca.length, 1)) * 0.38);
      for (const [pts, col, off] of [[series.ca, colA, -bw / 2], [series.cb, colB, bw / 2]] as const) {
        ctx.fillStyle = alpha(col, 0.35);
        for (const p of pts) { const h = (p.vol / maxV) * (volH - 6); ctx.fillRect(X(p.t) + off - bw / 2, volBase - h, bw, h); }
      }
      drawLine(series.ca, colA, false);
      drawLine(series.cb, colB, false);
      // last value tags
      const tag = (v: number, col: string) => {
        const y = Y(v);
        ctx.fillStyle = col; ctx.fillRect(padL + plotW + 2, y - 8, padR - 4, 16);
        ctx.fillStyle = '#05060a'; ctx.font = 'bold 10.5px JetBrains Mono, monospace'; ctx.fillText(pct(v), padL + plotW + 6, y + 4);
        ctx.font = '10.5px JetBrains Mono, monospace';
      };
      if (series.ca.length) tag(series.ca.at(-1)!.v, colA);
      if (series.cb.length) tag(series.cb.at(-1)!.v, colB);
    } else {
      const col = view === 'a' ? colA : colB;
      const cs = series.kind === 'candle' ? series.c.slice(-maxCandles) : series.c;
      const maxV = Math.max(1e-9, ...cs.map((c) => c.v));
      const cw = series.kind === 'candle' ? Math.max(2, (plotW / ((t1 - t0) / ivMs)) * 0.7) : Math.max(1, plotW / Math.max(cs.length, 1) * 0.6);
      for (const c of cs) {
        const up = c.c >= c.o;
        ctx.fillStyle = up ? 'rgba(46,230,160,0.28)' : 'rgba(255,79,109,0.28)';
        const h = (c.v / maxV) * (volH - 6);
        const x = series.kind === 'candle' ? X(c.t + ivMs / 2) : X(c.t);
        ctx.fillRect(x - cw / 2, volBase - h, cw, h);
      }
      if (series.kind === 'line') {
        drawLine(cs.map((c) => ({ t: c.t, v: c.c, vol: c.v })), col, true);
      } else {
        for (const c of cs) {
          const up = c.c >= c.o;
          const x = X(c.t + ivMs / 2);
          ctx.strokeStyle = ctx.fillStyle = up ? '#2ee6a0' : '#ff4f6d';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, Y(c.h)); ctx.lineTo(Math.round(x) + 0.5, Y(c.l)); ctx.stroke();
          const y1 = Y(Math.max(c.o, c.c));
          const y2 = Y(Math.min(c.o, c.c));
          ctx.fillRect(x - cw / 2, y1, cw, Math.max(1, y2 - y1));
        }
      }
      const lastP = e.markets[view === 'a' ? ta.id : tb.id].price;
      const y = Y(lastP);
      ctx.setLineDash([2, 3]); ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.fillRect(padL + plotW + 2, y - 8, padR - 4, 16);
      ctx.fillStyle = '#05060a'; ctx.font = 'bold 9.5px JetBrains Mono, monospace'; ctx.fillText(fmtPrice(lastP), padL + plotW + 5, y + 3.5);
    }

    // Crosshair
    if (hover !== null && hover >= padL && hover <= padL + plotW) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.moveTo(hover + 0.5, padT); ctx.lineTo(hover + 0.5, padT + plotH + volH); ctx.stroke();
    }
    // stash mapping for tooltip
    (cv as unknown as { _map: { t0: number; t1: number; padL: number; plotW: number } })._map = { t0, t1, padL, plotW };
  }, [series, w, height, hover, view, iv, battle, e, ta, tb, start, ivMs]);

  // Tooltip content
  let tip: React.ReactNode = null;
  if (hover !== null && canvas.current) {
    const map = (canvas.current as unknown as { _map?: { t0: number; t1: number; padL: number; plotW: number } })._map;
    if (map) {
      const t = map.t0 + ((hover - map.padL) / map.plotW) * (map.t1 - map.t0);
      const nearest = <T extends { t: number }>(arr: T[]) => arr.reduce<T | undefined>((best, p) => (!best || Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best), undefined);
      if (series.kind === 'compare') {
        const pa = nearest(series.ca);
        const pb = nearest(series.cb);
        if (pa && pb) tip = (
          <>
            <div className="dim mono">T+{clock(pa.t - start)}</div>
            <div className="mono" style={{ color: sideColor(ta.hue, 70) }}>{ta.ticker} {pct(pa.v)}</div>
            <div className="mono" style={{ color: sideColor(tb.hue, 70) }}>{tb.ticker} {pct(pb.v)}</div>
          </>
        );
      } else {
        const c = nearest(series.c);
        if (c) tip = (
          <>
            <div className="dim mono">T+{clock(c.t - start)}</div>
            <div className="mono">O {fmtPrice(c.o)} H {fmtPrice(c.h)}</div>
            <div className="mono">L {fmtPrice(c.l)} C {fmtPrice(c.c)}</div>
            <div className="mono muted">Vol {usd(quoteToUsd(c.v))}</div>
          </>
        );
      }
    }
  }

  return (
    <div className="panel chart-panel">
      <div className="panel-head chart-head">
        <div className="seg">
          <button className={view === 'a' ? 'active' : ''} onClick={() => setView('a')}><span style={{ color: sideColor(ta.hue) }}>●</span> {ta.ticker}</button>
          <button className={view === 'b' ? 'active' : ''} onClick={() => setView('b')}><span style={{ color: sideColor(tb.hue) }}>●</span> {tb.ticker}</button>
          <button className={view === 'compare' ? 'active' : ''} onClick={() => setView('compare')}>Compare</button>
        </div>
        <div className="seg">
          {INTERVALS.map((x) => (
            <button key={x.k} className={iv === x.k ? 'active' : ''} onClick={() => setIv(x.k)}>{x.k}</button>
          ))}
        </div>
      </div>
      <div ref={wrap} className="chart-wrap" style={{ height }}
        onMouseMove={(ev) => setHover(ev.clientX - (ev.currentTarget.getBoundingClientRect().left))}
        onMouseLeave={() => setHover(null)}>
        <canvas ref={canvas} style={{ width: w, height, display: 'block' }} />
        {tip && <div className="chart-tip" style={{ left: Math.min(hover! + 14, w - 170) }}>{tip}</div>}
        <div className="chart-legend">
          {lineMode && view === 'compare' ? <span>% change since battle start · {iv === 'ALL' ? 'full battle' : `${iv} resolution`}</span> : <span>{(view === 'a' ? ta : tb).ticker}/SOL · {iv === 'ALL' ? 'full battle' : `${iv} candles`}</span>}
        </div>
      </div>
    </div>
  );
}
