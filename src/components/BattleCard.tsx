import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Battle, Token } from '../data/types';
import { useData } from '../data/DataContext';
import { duration, num, pct, usd } from '../lib/format';
import { BATTLE_TYPES } from '../lib/shared';
import { roundName } from '../live/store';
import { sideView, battleIntegrity, combinedVolumeUsd } from '../lib/view';
import { Flash, StatusPill, StreakBadge, TokenLogo, sideColor } from './ui';

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

/**
 * All battle cards share one fixed skeleton (status · VS · market caps · score
 * strip · two footer lines) so live, upcoming and finished battles line up in
 * the same grid at the same size.
 */
interface SideCell { token: Token; mcap: string; sub: ReactNode }

function CardShell({ to, live, status, time, a, b, mid, foot1, foot2 }: {
  to: string; live?: boolean; status: ReactNode; time: ReactNode;
  a: SideCell; b: SideCell; mid: ReactNode; foot1: [ReactNode, ReactNode]; foot2: [ReactNode, ReactNode];
}) {
  const e = useData();
  return (
    <Link to={to} className={`panel bcard ${live ? 'bcard-live' : ''}`}>
      <div className="bcard-row bcard-top">{status}<span className="mono muted bcard-time">{time}</span></div>
      <div className="bcard-vs">
        {[a, b].map((S, i) => {
          const rec = e.recordFor(S.token.id);
          return (
            <div key={S.token.id} className={`bcard-side ${i ? 'right' : ''}`}>
              <div className="bcard-id">
                <TokenLogo token={S.token} size={38} />
                <div className="bcard-name">
                  <div className="bcard-ticker" style={{ color: sideColor(S.token.hue, 72) }}>{S.token.ticker}</div>
                  <div className="bcard-rec"><span className="mono muted">{rec.wins}W-{rec.losses}L</span><StreakBadge streak={rec.streak} compact /></div>
                </div>
              </div>
              <div className="bcard-mc mono">{S.mcap}<span className="muted"> mkt cap</span></div>
              <div className="bcard-sub mono">{S.sub}</div>
            </div>
          );
        })}
        <div className="bcard-vs-mid">VS</div>
      </div>
      <div className="bcard-mid">{mid}</div>
      <div className="bcard-foot">
        <div className="bcard-row">{foot1[0]}{foot1[1]}</div>
        <div className="bcard-row dim">{foot2[0]}{foot2[1]}</div>
      </div>
    </Link>
  );
}

const Who = ({ label, token, trophy }: { label: string; token: Token; trophy?: boolean }) => (
  <span className="row" style={{ gap: 6, minWidth: 0 }}>
    <span className="muted">{label}</span><TokenLogo token={token} size={16} /><b className="truncate">{token.ticker}</b>{trophy && '🏆'}
  </span>
);

export function BattleCard({ battle }: { battle: Battle }) {
  const e = useData();
  const A = sideView(e, battle, 'a');
  const B = sideView(e, battle, 'b');
  const elapsed = e.elapsed(battle);
  const isLive = battle.status === 'live';
  const isEnded = battle.status === 'ended';
  const upcoming = !isLive && !isEnded;
  const leader = isEnded ? e.tokens[battle.winner!] : A.score !== null ? (A.position === 1 ? A.token : B.token) : undefined;
  const chg = (c: number | null) => (c === null ? <span className="muted">—</span> : <span className={c >= 0 ? 'up' : 'down'}>{pct(c)}</span>);
  const rules = battle.rules;
  const t = e.tournamentOf(battle);
  const m = e.matchOf(battle);
  const tour = t ? <span className="pill pill-gold" title={t.name}>🏆 {m ? roundName(t, m.round) : t.name}</span> : null;
  const sp = rules.rewardSplit;

  if (upcoming) {
    return (
      <CardShell
        to={`/battle/${battle.id}`}
        status={<span className="row" style={{ gap: 6, minWidth: 0 }}><StatusPill battle={battle} elapsed={0} />{tour}</span>}
        time={battle.status === 'scheduled' && battle.scheduledStart <= e.now ? <>Starting…</> : <>Starts in {duration(Math.max(0, battle.scheduledStart - e.now))}</>}
        a={{ token: A.token, mcap: usd(A.mcapUsd), sub: chg(A.change) }}
        b={{ token: B.token, mcap: usd(B.mcapUsd), sub: chg(B.change) }}
        mid={<div className="bcard-pills"><span className="pill">{BATTLE_TYPES[rules.type].label}</span><span className="pill">Runs {Math.round(rules.randomEnd.minDurationMs / 3_600_000)}h+, surprise ending</span></div>}
        foot1={[<span className="muted">Price change (24h)</span>, <span className="muted">Starts automatically</span>]}
        foot2={[<span>Winner's share of fees</span>, <span className="mono">{Math.round(sp.winnerLiquidity * 100)}%</span>]}
      />
    );
  }
  const hasScore = A.score !== null && B.score !== null;
  return (
    <CardShell
      to={`/battle/${battle.id}`}
      live={isLive}
      status={<span className="row" style={{ gap: 6, minWidth: 0 }}><StatusPill battle={battle} elapsed={elapsed} compact />{tour}</span>}
      time={isLive ? <>⏱ {duration(elapsed)}</> : <>Lasted {duration(battle.final?.durationMs ?? 0)}</>}
      a={{ token: A.token, mcap: usd(A.mcapUsd), sub: chg(A.change) }}
      b={{ token: B.token, mcap: usd(B.mcapUsd), sub: chg(B.change) }}
      mid={hasScore ? <ScoreTug a={A.score!} b={B.score!} hueA={A.token.hue} hueB={B.token.hue} /> : <div className="dim center" style={{ fontSize: 12 }}>First score sample within a minute of start</div>}
      foot1={[leader ? <Who label={isEnded ? 'Winner' : 'Leading'} token={leader} trophy={isEnded} /> : <span className="muted">No leader yet</span>, <span className="mono muted">{num(battle.traders)} traders · {usd(combinedVolumeUsd(battle))}</span>]}
      foot2={[<span title="Holders of each token">👥 Holders {num(A.holders)} vs {num(B.holders)}</span>, <span title="Share of trading volume that looks genuine (not wash trading)">🛡 {battleIntegrity(battle)}% clean</span>]}
    />
  );
}
