import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Battle } from '../data/types';
import { useData } from '../data/DataContext';
import { roundName } from '../live/store';
import { useUi } from './AppState';
import { duration, num, pct } from '../lib/format';
import { battleIntegrity, cardVariants, headToHead, type CardVariant } from '../lib/view';
import { TokenLogo, posterColor } from './ui';

const LABEL: Record<CardVariant, string> = {
  tournament: 'Tournament', streak: 'Streak', close: 'Photo finish', dominant: 'Domination', rematch: 'Rematch', standard: 'Classic',
};

export function battleLink(b: Battle) {
  return `${location.origin}${location.pathname}#/battle/${b.id}`;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** Auto-generated, post-ready Battle Result Card with variant treatments. */
export function ShareCard({ battle, showView = false }: { battle: Battle; showView?: boolean }) {
  const e = useData();
  const ui = useUi();
  const variants = cardVariants(e, battle);
  const [variant, setVariant] = useState<CardVariant>(variants[0]);
  const f = battle.final!;
  const aWon = battle.winner === battle.a.tokenId;
  const W = e.tokens[battle.winner!];
  const L = e.tokens[aWon ? battle.b.tokenId : battle.a.tokenId];
  const ws = aWon ? f.scoreA : f.scoreB;
  const ls = aWon ? f.scoreB : f.scoreA;
  const stat = (won: boolean) => ({
    perf: won === aWon ? f.returnA : f.returnB,
    growth: won === aWon ? f.holderGrowthA : f.holderGrowthB,
    holders: won === aWon ? f.holdersA : f.holdersB,
  });
  const sw = stat(true);
  const sl = stat(false);
  const streak = e.recordFor(W.id).streak;
  const margin = ws.total - ls.total;
  const t = e.tournamentOf(battle);
  const match = e.matchOf(battle);
  const isFinal = t && match && match.round === t.rounds.length - 1;
  const h2h = headToHead(e, W.id, L.id);
  const integrity = Math.round((f.integrityA + f.integrityB) / 2);
  const date = new Date(battle.endedAt!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const headline: Record<CardVariant, string> = {
    tournament: isFinal ? `${t!.name} CHAMPION` : `${t?.name ?? ''} · ${match ? roundName(t!, match.round) : ''}`.toUpperCase(),
    streak: `STREAK EXTENDED · ${streak} IN A ROW`,
    close: `PHOTO FINISH · WON BY ${margin.toFixed(1)}`,
    dominant: `DOMINATION · +${margin.toFixed(1)} PTS`,
    rematch: `REMATCH SETTLED · SERIES ${h2h.a}–${h2h.b}`,
    standard: 'VICTORY',
  };
  const tweet = [
    `⚔️ BATTLE #${battle.number}: $${W.ticker} vs $${L.ticker}`,
    `🏆 $${W.ticker} WON ${ws.total.toFixed(0)}–${ls.total.toFixed(0)} after ${duration(f.durationMs)}`,
    streak >= 2 ? `🔥 ${streak} battle win streak` : '',
    t ? `🏆 ${t.name}` : '',
  ].filter(Boolean).join('\n');
  const url = battleLink(battle);
  const xHref = `https://x.com/intent/post?text=${encodeURIComponent(tweet)}&url=${encodeURIComponent(url)}`;

  const onCopy = async () => ui.toast({ title: (await copy(url)) ? 'Link copied' : 'Copy failed — select the link manually', body: url, tone: 'good' });
  const onShare = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: `BATTLE #${battle.number}`, text: tweet, url }); return; } catch { /* cancelled or unavailable */ }
    }
    await onCopy();
  };

  return (
    <div className="share">
      <div className={`scard v-${variant}`} style={{ '--hw': W.hue, '--hl': L.hue } as React.CSSProperties}>
        <div className="scard-bg" />
        <div className="scard-top">
          <span className="scard-brand">⚔️ BATTLE <b>#{battle.number}</b></span>
          <span className="scard-tag">{headline[variant]}</span>
          <span className="scard-date">{date}</span>
        </div>
        <div className="scard-main">
          <div className="scard-side win">
            <TokenLogo token={W} size={100} className="scard-logo" />
            <div className="scard-ticker" style={{ color: posterColor(W.hue, 70) }}>{W.ticker}</div>
            <div className="scard-won">🏆 {variant === 'tournament' && isFinal ? 'CHAMPION' : 'WON'}</div>
          </div>
          <div className="scard-score">
            <div className="scard-score-l">Final score</div>
            <div className="scard-score-v"><span style={{ color: posterColor(W.hue, 70) }}>{ws.total.toFixed(0)}</span><span className="scard-dash">—</span><span className="scard-lose">{ls.total.toFixed(0)}</span></div>
            <div className="scard-dur">⏱ {duration(f.durationMs)}</div>
          </div>
          <div className="scard-side lose">
            <TokenLogo token={L} size={100} className="scard-logo" />
            <div className="scard-ticker scard-lose">{L.ticker}</div>
            <div className="scard-lost">Keeps trading</div>
          </div>
        </div>
        <div className="scard-stats">
          {[[W, sw, true], [L, sl, false]].map(([tk, st, won]) => {
            const token = tk as typeof W;
            const s = st as typeof sw;
            return (
              <div key={token.id} className={`scard-stat ${won ? 'win' : ''}`}>
                <b style={{ color: won ? posterColor(token.hue, 70) : undefined }}>{token.ticker}</b>
                <span><i className={s.perf >= 0 ? 'up' : 'down'}>{pct(s.perf, 0)}</i> price</span>
                {s.growth !== null && <span><i className={s.growth >= 0 ? 'up' : 'down'}>{pct(s.growth, 0)}</i> holder growth</span>}
                {s.holders !== null && <span><i>{num(s.holders, false)}</i> holders</span>}
              </div>
            );
          })}
        </div>
        <div className="scard-foot">
          {streak >= 2 ? <span className="scard-streak">🔥 {W.ticker} WIN STREAK <b>{streak}</b></span> : <span className="scard-streak dim">First win of a new streak</span>}
          <span>🛡 Integrity {integrity}%</span>
          <span className="scard-sim">battle.fun · Solana</span>
        </div>
      </div>
      {variants.length > 1 && (
        <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
          <span className="label">Card style</span>
          {variants.map((v) => <button key={v} className={`chip ${v === variant ? 'active' : ''}`} onClick={() => setVariant(v)}>{LABEL[v]}</button>)}
        </div>
      )}
      <div className="share-actions">
        <a className="btn btn-x" href={xHref} target="_blank" rel="noopener noreferrer">𝕏 Share on X</a>
        <button className="btn" onClick={onCopy}>🔗 Copy Link</button>
        <button className="btn" onClick={onShare}>↗ Share</button>
        {showView && <Link className="btn" to={`/battle/${battle.id}`}>⚔️ View Battle</Link>}
      </div>
      <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>Battle integrity {battleIntegrity(battle)}% · final values recorded by the battle keeper.</div>
    </div>
  );
}
