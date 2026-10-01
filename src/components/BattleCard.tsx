import { Link } from 'react-router-dom';
import type { Battle } from '../data/types';
import { useData } from '../data/DataContext';
import { duration, num, pct, quoteToUsd, usd } from '../lib/format';
import { BATTLE_TYPES } from '../lib/rules';
import { sideView, battleIntegrity, combinedVolumeUsd } from '../lib/view';
import { Flash, SimPill, Sparkline, StatusPill, StreakBadge, TokenLogo, sideColor } from './ui';

export function ScoreTug({ a, b, hueA, hueB, height = 8, showLabels = true }: { a: number; b: number; hueA: number; hueB: number; height?: number; showLabels?: boolean }) {
  const total = a + b || 1;
  const pa = (a / total) * 100;
  return (
    <div className="tug">
      {showLabels && (
        <div className="spread" style={{ marginBottom: 6 }}>
          <span className="mono tug-v" style={{ color: sideColor(hueA, 68) }}><Flash value={a}>{a.toFixed(1)}</Flash></span>
          <span className="label" style={{ fontSize: 9.5 }}>Battle Score</span>
          <span className="mono tug-v" style={{ color: sideColor(hueB, 68) }}><Flash value={b}>{b.toFixed(1)}</Flash></span>
        </div>
      )}
      <div className="tug-bar" style={{ height }}>
        <div className="tug-a" style={{ width: `${pa}%`, background: `linear-gradient(90deg, ${sideColor(hueA, 35)}, ${sideColor(hueA, 58)})`, boxShadow: `0 0 18px ${sideColor(hueA, 50)}` }} />
        <div className="tug-b" style={{ width: `${100 - pa}%`, background: `linear-gradient(270deg, ${sideColor(hueB, 35)}, ${sideColor(hueB, 58)})`, boxShadow: `0 0 18px ${sideColor(hueB, 50)}` }} />
        <div className="tug-mid" style={{ left: `${pa}%` }} />
      </div>
    </div>
  );
}

export function BattleCard({ battle }: { battle: Battle }) {
  const e = useData();
  const A = sideView(e, battle, 'a');
  const B = sideView(e, battle, 'b');
  const elapsed = e.elapsed(battle);
  const isLive = battle.status === 'live';
  const isEnded = battle.status === 'ended';
  const upcoming = !isLive && !isEnded;
  const leader = isEnded ? e.tokens[battle.winner!] : A.position === 1 ? A.token : B.token;
  const recA = e.recordFor(A.token.id);
  const recB = e.recordFor(B.token.id);

  return (
    <Link to={`/battle/${battle.id}`} className={`panel bcard ${isLive ? 'bcard-live' : ''}`}>
      <div className="spread" style={{ marginBottom: 14 }}>
        <StatusPill battle={battle} elapsed={elapsed} />
        <span className="mono muted" style={{ fontSize: 12 }}>
          {isLive && <>⏱ {duration(elapsed)}</>}
          {isEnded && <>Lasted {duration(battle.final!.durationMs)}</>}
          {upcoming && <>Starts in {duration(Math.max(0, battle.scheduledStart - e.now))}</>}
        </span>
      </div>

      <div className="bcard-vs">
        {[A, B].map((S, i) => (
          <div key={S.token.id} className={`bcard-side ${i === 1 ? 'right' : ''}`}>
            <div className="row" style={{ gap: 10, flexDirection: i === 1 ? 'row-reverse' : 'row' }}>
              <TokenLogo token={S.token} size={44} />
              <div style={{ textAlign: i === 1 ? 'right' : 'left', minWidth: 0 }}>
                <div className="bcard-ticker">{S.token.ticker}</div>
                <div className="row" style={{ gap: 6, justifyContent: i === 1 ? 'flex-end' : 'flex-start' }}>
                  <span className="mono muted nowrap" style={{ fontSize: 11 }}>{(i === 0 ? recA : recB).wins}W-{(i === 0 ? recA : recB).losses}L</span>
                  <StreakBadge streak={(i === 0 ? recA : recB).streak} compact />
                </div>
              </div>
            </div>
            <div className="bcard-mc mono">{usd(S.mcapUsd)} <span className="muted" style={{ fontSize: 11 }}>MC</span></div>
            {!upcoming && <div className={`mono ${S.change >= 0 ? 'up' : 'down'}`} style={{ fontSize: 13, fontWeight: 700 }}>{pct(S.change)}</div>}
            {upcoming && <div className="mono muted" style={{ fontSize: 12 }}>{num(S.holders)} holders</div>}
          </div>
        ))}
        <div className="bcard-vs-mid">VS</div>
      </div>

      {!upcoming ? (
        <>
          <ScoreTug a={A.score} b={B.score} hueA={A.token.hue} hueB={B.token.hue} />
          <div className="spread" style={{ marginTop: 12, fontSize: 12 }}>
            <span className="row" style={{ gap: 6 }}>
              <span className="muted">{isEnded ? 'Winner' : 'Leading'}</span>
              <TokenLogo token={leader} size={18} />
              <b>{leader.ticker}</b>
              {isEnded && <span>🏆</span>}
            </span>
            <span className="muted mono">{num(battle.traders.size)} traders · {usd(combinedVolumeUsd(battle))} vol</span>
          </div>
          <div className="spread" style={{ marginTop: 6, fontSize: 12 }}>
            <span className="muted mono">👥 {num(A.holders)} · {num(B.holders)}</span>
            <span className="muted">🛡 {battleIntegrity(battle)}% integrity</span>
          </div>
        </>
      ) : (
        <div className="bcard-upcoming">
          <span className="pill">{BATTLE_TYPES[battle.rules.type].label}</span>
          <span className="pill">Min {Math.round(battle.rules.randomEnd.minDurationMs / 3_600_000)}h · random end</span>
          <span className="pill pill-gold">Pool {usd(quoteToUsd(battle.rules.rewardPoolQuote))}</span>
        </div>
      )}
    </Link>
  );
}

export function FeaturedBattle({ battle }: { battle: Battle }) {
  const e = useData();
  const A = sideView(e, battle, 'a');
  const B = sideView(e, battle, 'b');
  const elapsed = e.elapsed(battle);
  const isEnded = battle.status === 'ended';
  const leader = isEnded ? e.tokens[battle.winner!] : A.position === 1 ? A.token : B.token;
  const sd = elapsed >= battle.rules.randomEnd.minDurationMs;
  return (
    <div className="featured panel" style={{ '--ha': A.token.hue, '--hb': B.token.hue } as React.CSSProperties}>
      <div className="featured-glow" />
      <div className="featured-top">
        <span className="row" style={{ gap: 8 }}>
          <span className="pill pill-gold">🔥 Trending</span>
          <StatusPill battle={battle} elapsed={elapsed} />
          <SimPill />
        </span>
        <span className="mono muted">{isEnded ? `Lasted ${duration(battle.final!.durationMs)}` : `CURRENT DURATION ${duration(elapsed)}`}</span>
      </div>
      <div className="featured-vs">
        {[A, B].map((S, i) => (
          <div key={S.token.id} className={`featured-side ${i ? 'right' : ''}`}>
            <TokenLogo token={S.token} size={92} className="featured-logo" />
            <div className="featured-ticker" style={{ color: sideColor(S.token.hue, 70) }}>{S.token.ticker}</div>
            <div className="featured-mc mono">{usd(S.mcapUsd)} <span className="muted">MC</span></div>
            <div className={`mono ${S.change >= 0 ? 'up' : 'down'}`} style={{ fontSize: 18, fontWeight: 700 }}>{pct(S.change)}</div>
            <div style={{ width: '100%', maxWidth: 220, marginTop: 8, opacity: 0.9 }}>
              <Sparkline points={S.spark} color={sideColor(S.token.hue)} width={220} height={40} />
            </div>
          </div>
        ))}
        <div className="featured-mid">
          <div className="vs-badge">VS</div>
        </div>
      </div>
      <div className="featured-bottom">
        <div style={{ maxWidth: 560, margin: '0 auto', width: '100%' }}>
          <ScoreTug a={A.score} b={B.score} hueA={A.token.hue} hueB={B.token.hue} height={10} />
        </div>
        <div className="featured-stats">
          <div><span className="mono">{num(battle.traders.size, false)}</span><span className="muted">traders</span></div>
          <div><span className="mono">{usd(combinedVolumeUsd(battle))}</span><span className="muted">combined volume</span></div>
          <div><span className="row" style={{ gap: 6 }}><TokenLogo token={leader} size={20} /><b>{leader.ticker}</b></span><span className="muted">{isEnded ? 'won the battle' : 'currently leads'}</span></div>
        </div>
        <div className={`featured-warning ${sd ? 'sd' : ''}`}>
          {isEnded ? '🏁 Battle over — both tokens keep trading.' : sd ? '⚠️ BATTLE CAN END AT ANY TIME' : `🛡 MINIMUM BATTLE TIME: 1 HOUR · random end after that`}
        </div>
        <Link to={`/battle/${battle.id}`} className="btn btn-battle btn-lg" style={{ minWidth: 240 }}>⚔️ Enter Battle</Link>
      </div>
    </div>
  );
}
