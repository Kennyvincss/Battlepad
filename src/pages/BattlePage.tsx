import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Battle, BattleDetail, TokenId, TradeSide } from '../data/types';
import { useBattleDetail, useData, useEngineEvent } from '../data/DataContext';
import { ago, duration, num, pct, price as fmtPrice, short, solscanTx, usd } from '../lib/format';
import { BATTLE_TYPES } from '../lib/shared';
import { recentAlert, sideView, type SideView } from '../lib/view';
import { PriceChart } from '../components/PriceChart';
import { TradePanel } from '../components/TradePanel';
import { ScoreTug } from '../components/BattleCard';
import { EndProof, IntegrityAlertBanner, IntegrityPanel, LoyaltyCard, RewardSplitBar, RulesModal } from '../components/BattleInfo';
import { Flash, InfoButton, Modal, SourceTag, StreakBadge, TokenLogo, sideColor, sideStyle, useMediaQuery } from '../components/ui';
import { ResultPanel, ResultReveal } from '../components/Result';
import { BattleChat } from '../components/Chat';
import { BattleTreasuryCard } from '../components/Treasury';
import { roundName } from '../live/store';

export function BattlePage() {
  const { id } = useParams();
  const e = useData();
  const battle = id ? e.getBattle(id) : undefined;
  const detail = useBattleDetail(battle ? id : undefined);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [integOpen, setIntegOpen] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [leadFlash, setLeadFlash] = useState<{ k: number; leader: TokenId } | null>(null);
  const [sheet, setSheet] = useState<{ token: TokenId; side: TradeSide } | null>(null);
  const [tab, setTab] = useState<Section>('trade');
  const nav = useNavigate();
  const isMobile = useMediaQuery('(max-width: 900px)');

  useEngineEvent((ev) => {
    if (!battle) return;
    if (ev.type === 'battle-end' && ev.battleId === battle.id) setReveal(true);
    if (ev.type === 'lead-change' && ev.battleId === battle.id) setLeadFlash({ k: Date.now(), leader: ev.leader });
  }, [battle?.id]);

  useEffect(() => {
    if (!leadFlash) return;
    const t = setTimeout(() => setLeadFlash(null), 2600);
    return () => clearTimeout(t);
  }, [leadFlash]);

  if (!battle) return <div className="page"><div className="panel empty">Battle not found. <Link className="link" to="/">Back to battles</Link></div></div>;

  const A = sideView(e, battle, 'a');
  const B = sideView(e, battle, 'b');
  const elapsed = e.elapsed(battle);
  const live = battle.status === 'live';
  const ended = battle.status === 'ended';
  const upcoming = !live && !ended;
  const alert = live ? recentAlert(e, detail) : undefined;
  const tokens = [A.token, B.token];

  const t = e.tournamentOf(battle);
  const match = e.matchOf(battle);
  const go = (sec: Section) => {
    if (sec === 'spectate' && !isMobile) { nav(`/battle/${battle.id}/watch`); return; }
    setTab(sec);
    if (!isMobile) document.getElementById(`sec-${sec}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const show = (sec: Section) => !isMobile || tab === sec;

  const infoPanels = (
    <>
      <LoyaltyCard battle={battle} />
      <BattleTreasuryCard battle={battle} detail={detail} />
      <IntegrityPanel battle={battle} detail={detail} />
      <RecordsPanel battle={battle} />
    </>
  );

  return (
    <div className="page battle-page" style={{ '--ha': A.token.hue, '--hb': B.token.hue } as CSSProperties}>
      {/* --------------------------------------------------- header strip */}
      <div className="battle-strip">
        <div className="row wrap" style={{ gap: 10 }}>
          <Link to="/" className="btn btn-ghost btn-sm">← Battles</Link>
          <span className="battle-strip-title">
            {live && <><span className="live-dot" />⚔️ LIVE BATTLE</>}
            {ended && <>🏁 BATTLE OVER</>}
            {upcoming && <>🗓 UPCOMING BATTLE</>}
          </span>
          <span className="pill mono">#{battle.number}</span>
          <span className="pill hide-mobile">{BATTLE_TYPES[battle.rules.type].label}</span>
          <span className="pill pill-up hide-mobile" title="Rules are locked and hashed into the public commitment">🔒 Rules locked</span>
          <SourceTag text="Live · Solana" />
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {t && <Link to={`/tournament/${t.id}`} className="btn btn-sm btn-tourney">🏆 View Tournament{match ? ` · ${roundName(t, match.round)}` : ''}</Link>}
          {ended && <button className="btn btn-sm" onClick={() => setReveal(true)}>▶ Replay reveal</button>}
          <button className="btn btn-sm" onClick={() => setRulesOpen(true)}>📜 Battle Rules</button>
          {!upcoming && <Link to={`/battle/${battle.id}/watch`} className="btn btn-sm btn-watch">👁 WATCH BATTLE <span className="mono">{num(detail?.watchers ?? 0, false)}</span></Link>}
        </div>
      </div>

      {!ended && (
        <div className="battle-guide">
          <span className="battle-guide-i">👉</span>
          <span className="grow">
            {upcoming
              ? <>This battle hasn't started yet. Once it does, buying <b>${A.token.ticker}</b> or <b>${B.token.ticker}</b> helps that side's score. It runs at least {duration(battle.rules.randomEnd.minDurationMs)}, then ends by surprise.</>
              : <>Buy <b>${A.token.ticker}</b> or <b>${B.token.ticker}</b> to push that side's Battle Score up. Whoever is ahead when the battle ends wins. {elapsed >= battle.rules.randomEnd.minDurationMs ? <b>It can end any minute now.</b> : <>It can't end for another <b>{duration(battle.rules.randomEnd.minDurationMs - elapsed)}</b>.</>}</>}
          </span>
          {!upcoming && <button className="btn btn-primary btn-sm" onClick={() => go('trade')}>Trade now ↓</button>}
        </div>
      )}

      {alert && <IntegrityAlertBanner ev={alert} onDetails={() => setIntegOpen(true)} />}

      {ended && battle.final && <ResultPanel battle={battle} detail={detail} />}

      {/* --------------------------------------------------- VS hero */}
      <section className={`hero ${ended ? 'hero-ended' : ''}`}>
        <div className="hero-bg" />
        <SideCard v={A} battle={battle} align="left" />
        <div className="hero-center">
          <div className="hero-vs">VS</div>
          <DurationBlock battle={battle} elapsed={elapsed} detail={detail} />
          {!upcoming && <LeaderBlock battle={battle} A={A} B={B} />}
          {leadFlash && (
            <div key={leadFlash.k} className="lead-flash" style={sideStyle(e.tokens[leadFlash.leader].hue)}>
              ⚡ LEAD CHANGE · {e.tokens[leadFlash.leader].ticker}
            </div>
          )}
        </div>
        <SideCard v={B} battle={battle} align="right" />
      </section>

      {/* --------------------------------------------------- score */}
      {!upcoming && <ScoreSection battle={battle} detail={detail} A={A} B={B} onRules={() => setRulesOpen(true)} />}
      {upcoming && <UpcomingInfo battle={battle} onRules={() => setRulesOpen(true)} />}

      {/* --------------------------------------------------- section nav: TRADE | SPECTATE | CHAT | BATTLE INFO */}
      <nav className="sec-nav" aria-label="Battle sections">
        {([['trade', '💱 Trade'], ['spectate', '👁 Spectate'], ['chat', '💬 Chat'], ['info', 'ℹ️ Battle info']] as [Section, string][]).map(([k, l]) => (
          <button key={k} className={`sec-tab ${isMobile && tab === k ? 'active' : ''}`} onClick={() => go(k)}>
            {l}
            {k === 'chat' && <span className="mono dim"> {num(detail?.watchers ?? 0, false)}</span>}
          </button>
        ))}
      </nav>

      {/* --------------------------------------------------- main grid */}
      {!isMobile ? (
        <div className="battle-grid">
          <div className="battle-main">
            <div id="sec-trade" className="anchor" />
            <PriceChart battle={battle} height={380} />
            <div id="sec-chat" className="anchor" />
            <div className="duo">
              <ActivityTabs battle={battle} detail={detail} />
              <BattleChat battle={battle} detail={detail} height={372} />
            </div>
            <EndProof battle={battle} detail={detail} />
          </div>
          <aside className="battle-side">
            <TradePanel battle={battle} tokens={tokens} />
            <div id="sec-info" className="anchor" />
            {infoPanels}
          </aside>
        </div>
      ) : (
        <div className="battle-mobile">
          {show('trade') && (
            <>
              <PriceChart battle={battle} height={280} />
              <div id="trade"><TradePanel battle={battle} tokens={tokens} /></div>
              <ActivityTabs battle={battle} detail={detail} />
            </>
          )}
          {show('spectate') && <SpectatePreview battle={battle} detail={detail} />}
          {show('chat') && <BattleChat battle={battle} detail={detail} height="58vh" />}
          {show('info') && (
            <>
              {infoPanels}
              <EndProof battle={battle} detail={detail} />
              <button className="btn btn-block" onClick={() => setRulesOpen(true)}>📜 Full battle rules</button>
            </>
          )}
        </div>
      )}

      {/* --------------------------------------------------- mobile sticky trade bar */}
      {isMobile && tab === 'trade' && (
        <div className="sticky-trade">
          {tokens.map((tk) => (
            <button key={tk.id} className="btn btn-side-solid btn-lg grow" style={sideStyle(tk.hue)} onClick={() => setSheet({ token: tk.id, side: 'buy' })}>
              Buy {tk.ticker}
            </button>
          ))}
          <button className="btn btn-sell btn-lg" onClick={() => setSheet({ token: (e.wallet.tokens[A.token.id]?.amount ?? 0) > 0 ? A.token.id : B.token.id, side: 'sell' })}>Sell</button>
        </div>
      )}
      {sheet && (
        <div className="sheet-backdrop" onClick={(ev) => ev.target === ev.currentTarget && setSheet(null)}>
          <div className="sheet">
            <div className="sheet-handle" />
            <div className="spread" style={{ padding: '4px 16px 0' }}>
              <span className="panel-title">Trade</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setSheet(null)}>✕</button>
            </div>
            <TradePanel battle={battle} tokens={tokens} initialToken={sheet.token} initialSide={sheet.side} compact onDone={() => setSheet(null)} />
          </div>
        </div>
      )}

      {rulesOpen && <RulesModal battle={battle} onClose={() => setRulesOpen(false)} />}
      {integOpen && (
        <Modal title="⚠️ Integrity Alert" onClose={() => setIntegOpen(false)}>
          {alert && <div className="callout callout-alert" style={{ marginBottom: 14 }}><span>⚠️</span><span><b>{alert.title}</b><br />{alert.detail}</span></div>}
          <IntegrityPanel battle={battle} detail={detail} />
        </Modal>
      )}
      {reveal && battle.final && <ResultReveal battle={battle} onClose={() => setReveal(false)} />}
    </div>
  );
}

type Section = 'trade' | 'spectate' | 'chat' | 'info';

/** Mobile "Spectate" tab: a compact live event view with a link to full spectator mode. */
function SpectatePreview({ battle, detail }: { battle: Battle; detail?: BattleDetail }) {
  const e = useData();
  const stream = [...(detail?.feed ?? [])].reverse().slice(0, 20);
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">👁 Spectate</span>
        <span className="spec-watch"><span className="online-dot" /><b className="mono">{num(detail?.watchers ?? 0, false)}</b> WATCHING</span>
      </div>
      <div className="panel-pad col" style={{ gap: 10 }}>
        <Link to={`/battle/${battle.id}/watch`} className="btn btn-watch btn-lg btn-block">👁 WATCH BATTLE — full spectator mode</Link>
        <div className="pbp" style={{ maxHeight: 'none' }}>
          {stream.length === 0 && <div className="empty">Live moments appear here as the battle unfolds.</div>}
          {stream.map((f) => {
            const tk = f.tokenId ? e.tokens[f.tokenId] : undefined;
            return (
              <div key={f.id} className={`pbp-item k-${f.kind}`} style={tk ? sideStyle(tk.hue) : undefined}>
                <span className="grow">{f.text}</span>
                <span className="dim mono" style={{ fontSize: 10.5 }}>{ago(e.now - f.t)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ======================================================================= */

function SideCard({ v, battle, align }: { v: SideView; battle: Battle; align: 'left' | 'right' }) {
  const e = useData();
  const rec = e.recordFor(v.token.id);
  const upcoming = battle.status === 'scheduled' || battle.status === 'pending';
  const ended = battle.status === 'ended';
  const isWinner = ended && battle.winner === v.token.id;
  const myArmy = e.wallet.connected && e.armies[battle.id] === v.token.id;
  const pos = v.position;
  return (
    <div className={`side-card ${align} ${pos === 1 && !upcoming && v.score !== null ? 'leading' : ''} ${isWinner ? 'winner' : ''}`} style={sideStyle(v.token.hue)}>
      <div className="side-top">
        <TokenLogo token={v.token} size={74} className="side-logo" />
        <div className="side-id">
          <Link to={`/token/${v.token.id}`} className="side-ticker">${v.token.ticker}</Link>
          <div className="side-name">{v.token.name}</div>
          <div className="row" style={{ gap: 6, marginTop: 4, justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
            <span className="mono muted" style={{ fontSize: 11.5 }}>{rec.wins}W · {rec.losses}L</span>
            <StreakBadge streak={rec.streak} />
          </div>
        </div>
      </div>

      <div className="side-mc">
        <div className="label">Market cap</div>
        <div className="side-mc-v mono">{v.mcapUsd !== null ? <Flash value={v.mcapUsd}>{usd(v.mcapUsd)}</Flash> : '—'}</div>
        {v.change !== null && <div className={`side-chg mono ${v.change >= 0 ? 'up' : 'down'}`}>{v.change >= 0 ? '▲' : '▼'} {pct(v.change)} <span className="dim" style={{ fontSize: 11 }}>{upcoming ? '24h' : 'since start'}</span></div>}
      </div>

      {!upcoming && (
        <div className="side-pos">
          <span className={`pos-badge ${pos === 1 ? 'p1' : 'p2'}`}>{ended ? (isWinner ? '🏆 WINNER' : 'DEFEATED') : v.score === null ? 'SCORING…' : pos === 1 ? '#1 LEADING' : '#2 CHASING'}</span>
          <span className="side-score mono">{v.score !== null ? <Flash value={v.score}>{v.score.toFixed(1)}</Flash> : '—'}<span className="dim" style={{ fontSize: 11 }}> pts</span></span>
        </div>
      )}

      <div className="side-stats">
        <Stat l="Price" v={fmtPrice(v.price)} />
        <Stat l="Holders" v={num(v.holders, false)} sub={v.holdersDelta !== null ? `${v.holdersDelta >= 0 ? '+' : ''}${num(v.holdersDelta)}` : undefined} subCls={(v.holdersDelta ?? 0) >= 0 ? 'up' : 'down'} />
        <Stat l="Battle vol." v={upcoming ? '—' : usd(v.volumeUsd)} />
        <Stat l="Liquidity" v={usd(v.liquidityUsd)} />
        <Stat l="Buyers" v={upcoming ? '—' : num(v.buyers, false)} cls="up" />
        <Stat l="Sellers" v={upcoming ? '—' : num(v.sellers, false)} cls="down" />
      </div>
      {myArmy && <div className="army-tag">YOU'RE IN THE {v.token.ticker} ARMY</div>}
    </div>
  );
}

function Stat({ l, v, sub, cls = '', subCls = '' }: { l: string; v: string; sub?: string; cls?: string; subCls?: string }) {
  return (
    <div className="side-stat">
      <span className="label" style={{ fontSize: 9.5 }}>{l}</span>
      <span className={`mono ${cls}`}>{v}{sub && <span className={subCls} style={{ fontSize: 10.5, marginLeft: 4 }}>{sub}</span>}</span>
    </div>
  );
}

export function DurationBlock({ battle, elapsed, detail }: { battle: Battle; elapsed: number; detail?: BattleDetail }) {
  const e = useData();
  const min = battle.rules.randomEnd.minDurationMs;
  const live = battle.status === 'live';
  const ended = battle.status === 'ended';
  if (!live && !ended) {
    return (
      <div className="dur">
        <div className="label">{battle.status === 'pending' ? 'Proposed start in' : 'Starts in'}</div>
        <div className="dur-v mono">{duration(Math.max(0, battle.scheduledStart - e.now), true)}</div>
        <div className="dur-min">Runs at least {duration(min)}</div>
        <div className="dim" style={{ fontSize: 11.5, marginTop: 6 }}>Then it can end at any minute (a fair, public random draw).</div>
      </div>
    );
  }
  const sd = elapsed >= min;
  const checks = detail?.endChecks ?? [];
  const lastCheck = checks.at(-1);
  return (
    <div className={`dur ${sd && live ? 'dur-sd' : ''}`}>
      <div className="label">{ended ? 'Battle lasted' : 'Running for'}</div>
      <div className="dur-v mono">{ended ? duration(battle.final?.durationMs ?? elapsed, true) : duration(elapsed, true)}</div>
      <div className="dur-min">Minimum {duration(min)} {sd && '✓ passed'}</div>
      {live && !sd && (
        <>
          <div className="progress" style={{ marginTop: 8 }}><div style={{ width: `${(elapsed / min) * 100}%`, background: 'var(--info)' }} /></div>
          <div className="dim" style={{ fontSize: 11.5, marginTop: 6 }}>🛡 Safe period: the battle can't end yet.</div>
        </>
      )}
      {live && sd && (
        <>
          <div className="sd-warn">🎲 Can end any minute now</div>
          <div className="dim" style={{ fontSize: 11.5, marginTop: 6 }} title={lastCheck ? `Last draw ${lastCheck.value.toFixed(3)} → continue` : undefined}>
            Ending checked {checks.length} {checks.length === 1 ? 'time' : 'times'}: still going
          </div>
        </>
      )}
      {ended && battle.final?.endCheck && (
        <div className="dim mono" style={{ fontSize: 11, marginTop: 8 }}>Ended by check #{battle.final.endCheck.index}: {battle.final.endCheck.value.toFixed(5)} &lt; {battle.final.endCheck.threshold.toFixed(5)}</div>
      )}
    </div>
  );
}

export function LeaderBlock({ battle, A, B }: { battle: Battle; A: SideView; B: SideView }) {
  const ended = battle.status === 'ended';
  if (A.score === null || B.score === null) {
    return (
      <div className="leader">
        <div className="label">Current battle leader</div>
        <div className="muted" style={{ fontSize: 13 }}>The first score sample arrives within a minute of the start.</div>
      </div>
    );
  }
  const L = A.position === 1 ? A : B;
  return (
    <div className="leader" style={sideStyle(L.token.hue)}>
      <div className="label">{ended ? 'Winner' : 'Winning right now'}</div>
      <div className="leader-v">
        <TokenLogo token={L.token} size={30} />
        <span style={{ color: sideColor(L.token.hue, 70) }}>{L.token.ticker}</span>
        {ended && '🏆'}
      </div>
      <div className="mono dim" style={{ fontSize: 11.5 }}>by {Math.abs(A.score - B.score).toFixed(1)} pts</div>
      {!ended && <div className="leader-note">The lead can still change. The score at the moment the battle ends decides.</div>}
    </div>
  );
}

function ScoreSection({ battle, detail, A, B, onRules }: { battle: Battle; detail?: BattleDetail; A: SideView; B: SideView; onRules: () => void }) {
  const sa = battle.final?.scoreA ?? battle.a.score;
  const sb = battle.final?.scoreB ?? battle.b.score;
  const w = battle.rules.weights;
  if (!sa || !sb || A.score === null || B.score === null) {
    return (
      <section className="panel score-panel panel-pad">
        <span className="panel-title">⚖️ Battle Score <InfoButton onClick={onRules} label="Score formula" /></span>
        <p className="muted" style={{ margin: '8px 0 0' }}>The battle keeper samples both markets every minute. The first Battle Score appears within a minute of the start.</p>
      </section>
    );
  }
  const q = (s: typeof sa) => `${Math.round(s.inputs.distribution * 100)}·${Math.round(s.inputs.organicFlow * 100)}·${Math.round(s.inputs.liquidityRetention * 100)}`;
  const rows = [
    { k: 'Performance', w: w.performance, a: sa.performance, b: sb.performance, ia: pct(Math.exp(sa.inputs.twReturn) - 1), ib: pct(Math.exp(sb.inputs.twReturn) - 1), hint: 'how much the price rose, averaged over the battle' },
    { k: 'Holder growth', w: w.holderGrowth, a: sa.holderGrowth, b: sb.holderGrowth, ia: pct(sa.holderGrowthPct), ib: pct(sb.holderGrowthPct), hint: sa.holderGrowthPct === null ? 'holder data unavailable · neutral' : 'new holders since the start' },
    { k: 'Market quality', w: w.marketQuality, a: sa.marketQuality, b: sb.marketQuality, ia: q(sa), ib: q(sb), hint: 'spread-out holders, genuine trades, steady liquidity' },
  ];
  return (
    <section className="panel score-panel">
      <div className="panel-head">
        <span className="panel-title">⚖️ Battle Score <InfoButton onClick={onRules} label="Score formula" /></span>
        <span className="dim" style={{ fontSize: 11.5 }}>Score = 60% price performance + 20% new holders + 20% healthy trading</span>
      </div>
      <div className="score-grid">
        <div className="score-main">
          <div className="score-big">
            <span className="mono" style={{ color: sideColor(A.token.hue, 68) }}><Flash value={A.score}>{A.score.toFixed(1)}</Flash></span>
            <span className="score-big-vs">SCORE</span>
            <span className="mono" style={{ color: sideColor(B.token.hue, 68) }}><Flash value={B.score}>{B.score.toFixed(1)}</Flash></span>
          </div>
          <ScoreTug a={A.score} b={B.score} hueA={A.token.hue} hueB={B.token.hue} height={14} showLabels={false} />
          <div className="score-rows">
            {rows.map((r) => (
              <div key={r.k} className="score-row">
                <span className="mono score-in" style={{ color: sideColor(A.token.hue, 70) }}>{r.a.toFixed(0)} <span className="dim">({r.ia})</span></span>
                <div className="score-row-mid">
                  <div className="score-row-label">{r.k} <span className="dim">· {Math.round(r.w * 100)}%</span></div>
                  <div className="mini-tug">
                    <div style={{ width: `${(r.a / (r.a + r.b || 1)) * 100}%`, background: sideColor(A.token.hue, 55) }} />
                    <div style={{ flex: 1, background: sideColor(B.token.hue, 55) }} />
                  </div>
                  <div className="dim" style={{ fontSize: 10.5, textAlign: 'center' }}>{r.hint}</div>
                </div>
                <span className="mono score-in right" style={{ color: sideColor(B.token.hue, 70) }}><span className="dim">({r.ib})</span> {r.b.toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="score-timeline">
          <div className="spread"><span className="label">Score timeline</span><span className="dim mono" style={{ fontSize: 11 }}>{battle.leadChanges} lead changes</span></div>
          <ScoreTimeline battle={battle} detail={detail} />
          <div className="dim" style={{ fontSize: 11.5 }}>Sampled every minute by the battle keeper. Raw volume is not scored; flagged activity is excluded per rules.</div>
        </div>
      </div>
    </section>
  );
}

export function ScoreTimeline({ battle, detail }: { battle: Battle; detail?: BattleDetail }) {
  const e = useData();
  const pts = (detail?.snapshots ?? []).map((s) => ({ t: s.t - (battle.startedAt ?? s.t), a: s.scoreA, b: s.scoreB })).filter((p) => p.a !== null && p.b !== null);
  const W = 400, H = 120;
  if (pts.length < 2) return <div className="dim" style={{ height: H, display: 'grid', placeItems: 'center' }}>Collecting samples…</div>;
  const tMax = Math.max(pts.at(-1)!.t, battle.rules.randomEnd.minDurationMs * 0.5);
  const vals = pts.flatMap((p) => [p.a, p.b]);
  const lo = Math.min(...vals) - 2, hi = Math.max(...vals) + 2;
  const X = (t: number) => (t / tMax) * W;
  const Y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const path = (k: 'a' | 'b') => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p[k]).toFixed(1)}`).join('');
  const ca = sideColor(e.tokens[battle.a.tokenId]?.hue ?? 0);
  const cb = sideColor(e.tokens[battle.b.tokenId]?.hue ?? 0);
  const minX = X(battle.rules.randomEnd.minDurationMs);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: H, display: 'block', margin: '8px 0' }}>
      {minX < W && <rect x={minX} y={0} width={W - minX} height={H} fill="rgba(255,181,71,0.06)" />}
      {minX < W && <line x1={minX} x2={minX} y1={0} y2={H} stroke="rgba(255,181,71,0.5)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
      <path d={path('a')} fill="none" stroke={ca} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      <path d={path('b')} fill="none" stroke={cb} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function UpcomingInfo({ battle, onRules }: { battle: Battle; onRules: () => void }) {
  const e = useData();
  const challenger = e.tokens[battle.a.tokenId];
  return (
    <section className="panel panel-pad" style={{ marginTop: 16 }}>
      <div className="grid grid-3" style={{ gap: 16 }}>
        <div className="stat"><span className="stat-l">Battle type</span><span className="stat-v" style={{ fontSize: 18 }}>{BATTLE_TYPES[battle.rules.type].label}</span><span className="dim" style={{ fontSize: 12 }}>{BATTLE_TYPES[battle.rules.type].blurb}</span></div>
        <div className="stat"><span className="stat-l">Treasury split</span><span className="stat-v" style={{ fontSize: 18 }}>{Math.round(battle.rules.rewardSplit.winnerLiquidity * 100)} / {Math.round(battle.rules.rewardSplit.holderRewards * 100)} / {Math.round(battle.rules.rewardSplit.platform * 100)}</span><span className="dim" style={{ fontSize: 12 }}>Winner / holders / platform</span></div>
        <div className="stat"><span className="stat-l">Challenger</span><span className="stat-v" style={{ fontSize: 18 }}>${challenger?.ticker}</span><span className="dim" style={{ fontSize: 12 }}>{battle.status === 'pending' ? 'Waiting for the opponent to accept' : 'Accepted · rules locked at start'}</span></div>
      </div>
      {battle.challengeMessage && <p className="muted" style={{ fontStyle: 'italic', margin: '12px 0 0' }}>“{battle.challengeMessage}”</p>}
      <hr className="divider" />
      <RewardSplitBar rules={battle.rules} />
      <div className="row" style={{ marginTop: 14 }}><button className="btn" onClick={onRules}>📜 Read the full battle rules before trading</button></div>
    </section>
  );
}

function ActivityTabs({ battle, detail }: { battle: Battle; detail?: BattleDetail }) {
  const e = useData();
  const [tab, setTab] = useState<'trades' | 'feed' | 'mine'>('trades');
  const trades = (detail?.trades ?? []).slice(0, 80);
  const me = e.wallet.address;
  const mine = me ? (detail?.trades ?? []).filter((t) => t.wallet === me) : [];
  const feed = [...(detail?.feed ?? [])].reverse().slice(0, 60);
  const row = (t: (typeof trades)[number], showWallet: boolean) => {
    const tk = e.tokens[t.tokenId];
    return (
      <tr key={t.tx + t.tokenId} className={`${t.flagged ? 'flagged' : ''} ${t.wallet === me ? 'mine' : ''}`}>
        <td className="mono dim"><a href={solscanTx(t.tx)} target="_blank" rel="noopener noreferrer">{ago(e.now - t.t)}</a></td>
        <td><span className="row" style={{ gap: 6 }}>{tk && <TokenLogo token={tk} size={16} />}{tk?.ticker}</span></td>
        <td className={t.side === 'buy' ? 'up' : 'down'} style={{ fontWeight: 700 }}>{t.side.toUpperCase()}</td>
        <td className="num">{usd(t.usd, { compact: false })}</td>
        {showWallet && <td className="num dim">{t.wallet === me ? <b className="gold">YOU</b> : short(t.wallet)}{t.flagged && <span className="pill pill-down" style={{ marginLeft: 6, height: 17, fontSize: 9 }}>excluded</span>}</td>}
      </tr>
    );
  };
  return (
    <div className="panel">
      <div className="panel-head" style={{ paddingTop: 0, paddingBottom: 0 }}>
        <div className="tabs" style={{ margin: 0, border: 0 }}>
          <button className={`tab ${tab === 'trades' ? 'active' : ''}`} onClick={() => setTab('trades')}>Live trades</button>
          <button className={`tab ${tab === 'feed' ? 'active' : ''}`} onClick={() => setTab('feed')}>Army feed</button>
          <button className={`tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>My trades {mine.length > 0 && `(${mine.length})`}</button>
        </div>
        <SourceTag text="GeckoTerminal" />
      </div>
      <div className="activity">
        {tab === 'trades' && (trades.length === 0
          ? <div className="empty">{battle.status === 'live' ? 'Battle trades are indexed every minute.' : 'No battle trades indexed.'}</div>
          : <table className="table trades-table"><thead><tr><th>Time</th><th>Token</th><th>Side</th><th className="num">USD</th><th className="num">Wallet</th></tr></thead><tbody>{trades.map((t) => row(t, true))}</tbody></table>)}
        {tab === 'feed' && (
          <div className="feed">
            {feed.length === 0 && <div className="empty">Moments appear here as the battle unfolds.</div>}
            {feed.map((f) => {
              const tk = f.tokenId ? e.tokens[f.tokenId] : undefined;
              return (
                <div key={f.id} className={`feed-item feed-${f.kind}`} style={tk ? sideStyle(tk.hue) : undefined}>
                  <span className="feed-bar" />
                  <span className="grow">{f.text}</span>
                  <span className="dim mono" style={{ fontSize: 11 }}>{ago(e.now - f.t)}</span>
                </div>
              );
            })}
          </div>
        )}
        {tab === 'mine' && (!me ? <div className="empty">Connect a wallet to see your battle trades.</div>
          : mine.length === 0 ? <div className="empty">No trades from your wallet in this battle yet.</div>
          : <table className="table"><thead><tr><th>Time</th><th>Token</th><th>Side</th><th className="num">USD</th></tr></thead><tbody>{mine.map((t) => row(t, false))}</tbody></table>)}
      </div>
    </div>
  );
}

function RecordsPanel({ battle }: { battle: Battle }) {
  const e = useData();
  return (
    <div className="panel">
      <div className="panel-head"><span className="panel-title">📊 Battle Records</span></div>
      <div className="panel-pad col" style={{ gap: 14 }}>
        {[battle.a.tokenId, battle.b.tokenId].map((tid) => {
          const t = e.tokens[tid];
          const r = e.recordFor(tid);
          if (!t) return null;
          return (
            <Link key={tid} to={`/token/${tid}`} className="rec-mini" style={sideStyle(t.hue)}>
              <div className="spread">
                <span className="row" style={{ gap: 8 }}><TokenLogo token={t} size={24} /><b>${t.ticker}</b></span>
                <span className="mono"><span className="up">{r.wins}W</span> · <span className="down">{r.losses}L</span></span>
              </div>
              <div className="row" style={{ gap: 4, marginTop: 8 }}>
                {r.entries.length === 0 && <span className="dim" style={{ fontSize: 12 }}>First battle</span>}
                {r.entries.slice(0, 10).map((x) => <span key={x.battleId} className={`form-dot ${x.won ? 'w' : 'l'}`} title={`${x.won ? 'Won' : 'Lost'} vs ${e.tokens[x.opponentId]?.ticker}`}>{x.won ? 'W' : 'L'}</span>)}
                <span className="grow" />
                <StreakBadge streak={r.streak} />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
