import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import type { Battle } from '../data/types';
import { useData } from '../data/DataContext';
import { duration, pct, quoteToUsd, usd } from '../lib/format';
import { SimPill, TokenLogo, sideColor, sideStyle } from './ui';
import { TREASURY_COLORS } from './Treasury';
import { ShareCard } from './ShareCard';

/** Full-screen staged winner reveal. */
export function ResultReveal({ battle, onClose }: { battle: Battle; onClose: () => void }) {
  const e = useData();
  const f = battle.final!;
  const w = e.tokens[battle.winner!];
  const winnerIsA = battle.winner === battle.a.tokenId;
  const l = e.tokens[winnerIsA ? battle.b.tokenId : battle.a.tokenId];
  const ws = winnerIsA ? f.scoreA.total : f.scoreB.total;
  const ls = winnerIsA ? f.scoreB.total : f.scoreA.total;
  const [stage, setStage] = useState(0);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const ts = [setTimeout(() => setStage(1), 1300), setTimeout(() => setStage(2), 2300), setTimeout(() => setStage(3), 3200)];
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    return () => { ts.forEach(clearTimeout); window.removeEventListener('keydown', onKey); };
  }, []);
  return createPortal(
    <div className="reveal" style={sideStyle(w.hue)} onClick={() => stage >= 3 && onClose()}>
      <div className="reveal-scan" />
      <div className={`reveal-stage s0 ${stage >= 1 ? 'up' : ''}`}>
        <div className="reveal-swords">⚔️</div>
        <div className="reveal-over">BATTLE OVER</div>
        <div className="reveal-sub mono">{duration(f.durationMs, true)} · {f.hitCap ? 'safety cap reached' : `random end check #${f.endCheck?.index}`}</div>
      </div>
      {stage >= 1 && (
        <div className="reveal-winner">
          <div className="reveal-burst" />
          <TokenLogo token={w} size={150} className="reveal-logo" />
          {stage >= 2 && <div className="reveal-name"><span style={{ color: sideColor(w.hue, 68) }}>{w.ticker}</span> WINS <span className="reveal-trophy">🏆</span></div>}
          {stage >= 3 && (
            <div className="reveal-scores">
              <div><TokenLogo token={w} size={26} /><span className="mono gold">{ws.toFixed(1)}</span></div>
              <span className="dim">vs</span>
              <div><TokenLogo token={l} size={26} /><span className="mono muted">{ls.toFixed(1)}</span></div>
            </div>
          )}
          {stage >= 3 && (
            <div className="reveal-actions">
              <button className="btn btn-lg btn-primary" onClick={onClose}>View final results</button>
              <div className="dim" style={{ fontSize: 12, marginTop: 10 }}>${l.ticker} keeps trading normally. Winning doesn't guarantee future price appreciation.</div>
            </div>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}

export function ResultPanel({ battle }: { battle: Battle }) {
  const e = useData();
  const f = battle.final!;
  const ta = e.tokens[battle.a.tokenId];
  const tb = e.tokens[battle.b.tokenId];
  const w = e.tokens[battle.winner!];
  const rows: { k: string; a: string; b: string; better?: 'a' | 'b' }[] = [
    { k: 'Final Battle Score', a: f.scoreA.total.toFixed(1), b: f.scoreB.total.toFixed(1), better: f.scoreA.total >= f.scoreB.total ? 'a' : 'b' },
    { k: 'Final market cap', a: usd(quoteToUsd(f.marketCapA)), b: usd(quoteToUsd(f.marketCapB)), better: f.marketCapA >= f.marketCapB ? 'a' : 'b' },
    { k: 'Price performance', a: pct(f.returnA), b: pct(f.returnB), better: f.returnA >= f.returnB ? 'a' : 'b' },
    { k: 'Time-weighted perf.', a: pct(Math.exp(f.scoreA.inputs.twReturn) - 1), b: pct(Math.exp(f.scoreB.inputs.twReturn) - 1), better: f.scoreA.inputs.twReturn >= f.scoreB.inputs.twReturn ? 'a' : 'b' },
    { k: 'Holder growth', a: pct(f.holderGrowthA), b: pct(f.holderGrowthB), better: f.holderGrowthA >= f.holderGrowthB ? 'a' : 'b' },
    { k: 'Integrity (organic vol.)', a: `${f.integrityA}%`, b: `${f.integrityB}%`, better: f.integrityA >= f.integrityB ? 'a' : 'b' },
  ];
  const t = e.tournamentOf(battle);
  const bal = e.treasuryBalance(battle);
  const sp = battle.rules.rewardSplit;
  const payouts: [string, number, string][] = [
    [`Winner liquidity support → $${w.ticker}`, sp.winnerLiquidity, TREASURY_COLORS.winner],
    [`Holder rewards → $${w.ticker} holders`, sp.holderRewards, TREASURY_COLORS.holders],
    ['Platform / ecosystem', sp.platform, TREASURY_COLORS.platform],
  ];
  const nextOpp = Object.values(e.tokens).find((t) => t.id !== ta.id && t.id !== tb.id && !e.battles.some((b) => (b.status === 'live' || b.status === 'scheduled') && (b.a.tokenId === t.id || b.b.tokenId === t.id)));
  return (
    <section className="result panel" style={{ '--h': w.hue } as React.CSSProperties}>
      <div className="result-glow" />
      <div className="result-head">
        <div className="label" style={{ color: 'var(--gold)' }}>⚔️ Battle over · <SimPill /></div>
        <h2 className="result-title"><TokenLogo token={w} size={44} /> <span style={{ color: sideColor(w.hue, 68) }}>{w.ticker}</span> HAS WON 🏆</h2>
        <div className="muted">
          Lasted <b className="mono">{duration(f.durationMs)}</b> · {f.hitCap ? 'reached the published safety cap' : <>ended by random check #{f.endCheck?.index} (<span className="mono">{f.endCheck?.value.toFixed(5)} &lt; {f.endCheck?.threshold.toFixed(5)}</span>)</>}
        </div>
      </div>
      <div className="result-grid">
        <div className="result-table">
          <div className="result-row head">
            <span />
            <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}><TokenLogo token={ta} size={20} />{ta.ticker}{battle.winner === ta.id && ' 🏆'}</span>
            <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}><TokenLogo token={tb} size={20} />{tb.ticker}{battle.winner === tb.id && ' 🏆'}</span>
          </div>
          {rows.map((r) => (
            <div key={r.k} className="result-row">
              <span className="muted">{r.k}</span>
              <span className="mono" style={{ color: r.better === 'a' ? sideColor(ta.hue, 70) : undefined, fontWeight: r.better === 'a' ? 700 : 400 }}>{r.a}</span>
              <span className="mono" style={{ color: r.better === 'b' ? sideColor(tb.hue, 70) : undefined, fontWeight: r.better === 'b' ? 700 : 400 }}>{r.b}</span>
            </div>
          ))}
          <div className="result-row"><span className="muted">Battle duration</span><span className="mono" style={{ gridColumn: 'span 2', textAlign: 'right' }}>{duration(f.durationMs, true)}</span></div>
        </div>
        <div className="col" style={{ gap: 14 }}>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>Rewards · treasury of {usd(quoteToUsd(bal), { compact: false, decimals: 0 })} paid out</div>
            <div className="tre-split">
              {payouts.map(([k, v, c]) => (
                <div key={k} className="tre-split-row"><span className="split-dot" style={{ background: c }} /><span className="grow">{k}</span><span className="mono" style={{ fontWeight: 700 }}>{usd(quoteToUsd(bal * v), { compact: false, decimals: 0 })}</span></div>
              ))}
            </div>
          </div>
          <div className="callout callout-info" style={{ fontSize: 12.5 }}>
            <span>ℹ️</span>
            <span>Both tokens keep trading normally. ${(battle.winner === ta.id ? tb : ta).ticker} is not destroyed. Winning does not guarantee future price appreciation.</span>
          </div>
        </div>
      </div>
      <div className="result-share">
        <div className="label" style={{ marginBottom: 10 }}>📸 Battle Result Card · share it</div>
        <ShareCard battle={battle} />
      </div>
      <div className="result-next">
        <span className="label">What's next</span>
        <div className="row wrap" style={{ gap: 8 }}>
          {t && <Link to={`/tournament/${t.id}`} className="btn btn-tourney">🏆 {t.status === 'completed' ? `${t.name} results` : `Continue ${t.name}`}</Link>}
          {nextOpp && <Link to={`/create-battle?token=${w.id}&opponent=${nextOpp.id}`} className="btn btn-battle">⚔️ Next challenge</Link>}
          <Link to="/tournaments" className="btn">Tournaments</Link>
          <Link to={`/token/${w.id}`} className="btn">{w.logo} {w.ticker} battle record</Link>
        </div>
      </div>
    </section>
  );
}
