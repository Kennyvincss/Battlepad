import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { BattleDetail, FeedItem } from '../data/types';
import { useBattleDetail, useData, useEngineEvent } from '../data/DataContext';
import { roundName, type LiveStore } from '../live/store';
import { ago, num, pct, usd } from '../lib/format';
import { battleIntegrity, recentAlert, sideView, type SideView } from '../lib/view';
import { PriceChart } from '../components/PriceChart';
import { ScoreTug } from '../components/BattleCard';
import { BattleChat } from '../components/Chat';
import { IntegrityAlertBanner } from '../components/BattleInfo';
import { ResultReveal } from '../components/Result';
import { ShareCard } from '../components/ShareCard';
import { Flash, SourceTag, TokenLogo, sideColor, sideStyle, useMediaQuery } from '../components/ui';
import { DurationBlock, LeaderBlock, ScoreTimeline } from './BattlePage';

const FEED_ICON: Record<FeedItem['kind'], string> = {
  join: '🪖', whale: '🐋', lead: '⚡', alert: '⚠️', surge: '📣', you: '🫵', trade: '💱', holders: '🎉', score: '📊',
};

/** Buy vs sell flow over the last 5 minutes of trades. */
function pressure(e: LiveStore, d: BattleDetail | undefined, tokenId: string) {
  const since = e.now - 5 * 60_000;
  let buy = 0, sell = 0;
  for (const t of d?.trades ?? []) {
    if (t.t < since || t.tokenId !== tokenId || t.flagged) continue;
    if (t.side === 'buy') buy += t.usd; else sell += t.usd;
  }
  return { buy, sell };
}

function Board({ v, align }: { v: SideView; align: 'left' | 'right' }) {
  return (
    <div className={`sb-side ${align}`} style={sideStyle(v.token.hue)}>
      <TokenLogo token={v.token} size={84} className="sb-logo" />
      <div className="sb-id">
        <div className="sb-ticker">${v.token.ticker}</div>
        <div className="sb-mc mono">{v.mcapUsd !== null ? <Flash value={v.mcapUsd}>{usd(v.mcapUsd)}</Flash> : '—'} <span className="dim">MC</span></div>
        {v.change !== null && <div className={`mono ${v.change >= 0 ? 'up' : 'down'}`} style={{ fontWeight: 700 }}>{pct(v.change)} <span className="dim" style={{ fontWeight: 400, fontSize: 11 }}>since start</span></div>}
        <div className="mono muted" style={{ fontSize: 12.5 }}>👥 {num(v.holders, false)} holders {v.holdersDelta !== null && <span className={v.holdersDelta >= 0 ? 'up' : 'down'}>{v.holdersDelta >= 0 ? '+' : ''}{num(v.holdersDelta)}</span>}</div>
      </div>
    </div>
  );
}

export function SpectatorPage() {
  const { id } = useParams();
  const e = useData();
  const battle = id ? e.getBattle(id) : undefined;
  const [reveal, setReveal] = useState(false);
  const isMobile = useMediaQuery('(max-width: 900px)');

  const detail = useBattleDetail(battle ? id : undefined);
  useEngineEvent((ev) => { if (ev.type === 'battle-end' && ev.battleId === id) setReveal(true); }, [id]);

  if (!battle) return <div className="page"><div className="panel empty">Battle not found. <Link className="link" to="/">Back to battles</Link></div></div>;
  const A = sideView(e, battle, 'a');
  const B = sideView(e, battle, 'b');
  const elapsed = e.elapsed(battle);
  const live = battle.status === 'live';
  const ended = battle.status === 'ended';
  const t = e.tournamentOf(battle);
  const match = e.matchOf(battle);
  const alert = live ? recentAlert(e, detail) : undefined;
  const stream = [...(detail?.feed ?? [])].reverse().slice(0, 60);
  const notable = (detail?.trades ?? []).filter((x) => x.usd >= 250 && !x.flagged).slice(0, 6);
  const pA = pressure(e, detail, A.token.id);
  const pB = pressure(e, detail, B.token.id);

  return (
    <div className="page spectator" style={{ '--ha': A.token.hue, '--hb': B.token.hue } as React.CSSProperties}>
      <div className="spec-bar">
        <div className="row wrap" style={{ gap: 8 }}>
          <Link to={`/battle/${battle.id}`} className="btn btn-ghost btn-sm">← Battle</Link>
          <span className="spec-title">👁 SPECTATOR MODE</span>
          {live && <span className="pill pill-live">Live</span>}
          {ended && <span className="pill pill-ended">Ended</span>}
          <span className="spec-watch"><span className="online-dot" /><b className="mono">{num(detail?.watchers ?? 0, false)}</b> WATCHING</span>
          <SourceTag text="Live · Solana" />
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {t && <Link to={`/tournament/${t.id}`} className="btn btn-sm">🏆 {t.name}{match ? ` · ${roundName(t, match.round)}` : ''}</Link>}
          <Link to={`/battle/${battle.id}`} className="btn btn-primary btn-sm">Trade this battle</Link>
        </div>
      </div>
      <div className="spec-note">You're watching only — no trades are placed from this view. <span className="dim">Battle #{battle.number}</span></div>

      {alert && <IntegrityAlertBanner ev={alert} onDetails={() => {}} />}

      <section className="scoreboard">
        <div className="scoreboard-bg" />
        <Board v={A} align="left" />
        <div className="sb-center">
          <div className="sb-score">
            <span style={{ color: sideColor(A.token.hue, 70) }}>{A.score !== null ? <Flash value={A.score}>{A.score.toFixed(1)}</Flash> : '—'}</span>
            <span className="sb-sep">:</span>
            <span style={{ color: sideColor(B.token.hue, 70) }}>{B.score !== null ? <Flash value={B.score}>{B.score.toFixed(1)}</Flash> : '—'}</span>
          </div>
          <div className="label" style={{ textAlign: 'center' }}>Battle Score</div>
          <ScoreTug a={A.score ?? 50} b={B.score ?? 50} hueA={A.token.hue} hueB={B.token.hue} height={10} showLabels={false} />
          <DurationBlock battle={battle} elapsed={elapsed} detail={detail} />
        </div>
        <Board v={B} align="right" />
      </section>

      {ended && battle.final && (
        <div className="spec-ended panel panel-pad">
          <div className="label gold">Final result</div>
          <ShareCard battle={battle} />
        </div>
      )}

      <div className="spec-grid">
        <div className="col" style={{ gap: 14, minWidth: 0 }}>
          <PriceChart battle={battle} height={isMobile ? 260 : 360} />
          <div className="spec-stats">
            <div className="panel panel-pad">
              <div className="label" style={{ marginBottom: 10 }}>Buy / sell pressure · last 5 min</div>
              {[[A, pA], [B, pB]].map(([v, p]) => {
                const sv = v as SideView;
                const pp = p as { buy: number; sell: number };
                const tot = pp.buy + pp.sell || 1;
                return (
                  <div key={sv.token.id} className="press">
                    <div className="spread" style={{ fontSize: 12 }}><span className="row" style={{ gap: 6 }}><TokenLogo token={sv.token} size={16} /><b>{sv.token.ticker}</b></span><span className="mono"><span className="up">{usd(pp.buy)}</span> / <span className="down">{usd(pp.sell)}</span></span></div>
                    <div className="press-bar"><div className="press-buy" style={{ width: `${(pp.buy / tot) * 100}%` }} /><div className="press-sell" /></div>
                    <div className="dim mono" style={{ fontSize: 11 }}>{num(sv.buyers, false)} buyers · {num(sv.sellers, false)} sellers this battle</div>
                  </div>
                );
              })}
            </div>
            <div className="panel panel-pad">
              <div className="spread"><span className="label">Score timeline</span><span className="dim mono" style={{ fontSize: 11 }}>{battle.leadChanges} lead changes</span></div>
              <ScoreTimeline battle={battle} detail={detail} />
            </div>
            <div className="panel panel-pad col" style={{ gap: 8 }}>
              <LeaderBlock battle={battle} A={A} B={B} />
              <div className="spread" style={{ fontSize: 12.5 }}><span className="muted">🛡 Integrity</span><b className="mono">{battleIntegrity(battle)}%</b></div>
              <div className="spread" style={{ fontSize: 12.5 }}><span className="muted">Traders</span><b className="mono">{num(battle.traders, false)}</b></div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head"><span className="panel-title">🐋 Recent notable trades</span><span className="dim" style={{ fontSize: 11.5 }}>≥ $250</span></div>
            <div className="notable">
              {notable.length === 0 && <div className="empty" style={{ padding: 16 }}>No large trades in the last few minutes.</div>}
              {notable.map((x) => {
                const tk = e.token(x.tokenId);
                return (
                  <div key={x.tx + x.tokenId} className="notable-row" style={sideStyle(tk.hue)}>
                    <TokenLogo token={tk} size={22} />
                    <span className="grow">Wallet <span className="mono">{x.wallet.slice(0, 4)}…</span> {x.side === 'buy' ? <b className="up">bought</b> : <b className="down">sold</b>} <b className="mono">{usd(x.usd, { compact: false, decimals: 0 })}</b> {tk.ticker}</span>
                    <span className="dim mono" style={{ fontSize: 11 }}>{ago(e.now - x.t)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="col" style={{ gap: 14, minWidth: 0 }}>
          <div className="panel">
            <div className="panel-head"><span className="panel-title">📡 Live play-by-play</span><span className="dim" style={{ fontSize: 11.5 }}>Community activity</span></div>
            <div className="pbp">
              {stream.map((f) => {
                const tk = f.tokenId ? e.tokens[f.tokenId] : undefined;
                return (
                  <div key={f.id} className={`pbp-item feed-item k-${f.kind}`} style={tk ? sideStyle(tk.hue) : undefined}>
                    <span className="pbp-ico">{FEED_ICON[f.kind as FeedItem['kind']] ?? '•'}</span>
                    <span className="grow">{f.text}</span>
                    <span className="dim mono" style={{ fontSize: 10.5 }}>{ago(e.now - f.t)}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <BattleChat battle={battle} detail={detail} height={isMobile ? 320 : 380} compact />
        </div>
      </div>
      {reveal && battle.final && <ResultReveal battle={battle} onClose={() => setReveal(false)} />}
    </div>
  );
}
