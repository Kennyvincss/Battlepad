import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Battle, TokenId, TradeSide } from '../data/types';
import { useData, useEngineEvent } from '../data/DataContext';
import { ago, duration, num, pct, price as fmtPrice, quoteToUsd, short, sol, usd } from '../lib/format';
import { BATTLE_TYPES } from '../lib/rules';
import { recentAlert, sideView, type SideView } from '../lib/view';
import { PriceChart } from '../components/PriceChart';
import { TradePanel } from '../components/TradePanel';
import { ScoreTug } from '../components/BattleCard';
import { EndProof, IntegrityAlertBanner, IntegrityPanel, LoyaltyCard, RewardSplitBar, RulesModal } from '../components/BattleInfo';
import { Flash, InfoButton, Modal, SimPill, StreakBadge, TokenLogo, sideColor, sideStyle, useMediaQuery } from '../components/ui';
import { ResultPanel, ResultReveal } from '../components/Result';

export function BattlePage() {
  const { id } = useParams();
  const e = useData();
  const battle = id ? e.getBattle(id) : undefined;
  const [rulesOpen, setRulesOpen] = useState(false);
  const [integOpen, setIntegOpen] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [leadFlash, setLeadFlash] = useState<{ k: number; leader: TokenId } | null>(null);
  const [sheet, setSheet] = useState<{ token: TokenId; side: TradeSide } | null>(null);
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
  const alert = live ? recentAlert(e, battle) : undefined;
  const tokens = [A.token, B.token];

  return (
    <div className="page battle-page" style={{ '--ha': A.token.hue, '--hb': B.token.hue } as CSSProperties}>
      {/* --------------------------------------------------- header strip */}
      <div className="battle-strip">
        <div className="row" style={{ gap: 10 }}>
          <Link to="/" className="btn btn-ghost btn-sm">← Battles</Link>
          <span className="battle-strip-title">
            {live && <><span className="live-dot" />⚔️ LIVE BATTLE</>}
            {ended && <>🏁 BATTLE OVER</>}
            {upcoming && <>🗓 UPCOMING BATTLE</>}
          </span>
          <span className="pill hide-mobile">{BATTLE_TYPES[battle.rules.type].label}</span>
          <span className="pill pill-up hide-mobile" title="Rules are locked and hashed into the public commitment">🔒 Rules locked</span>
          <SimPill />
        </div>
        <div className="row" style={{ gap: 8 }}>
          {ended && <button className="btn btn-sm" onClick={() => setReveal(true)}>▶ Replay reveal</button>}
          <button className="btn btn-sm" onClick={() => setRulesOpen(true)}>📜 Battle Rules</button>
        </div>
      </div>

      {alert && <IntegrityAlertBanner ev={alert} onDetails={() => setIntegOpen(true)} />}

      {ended && battle.final && <ResultPanel battle={battle} />}

      {/* --------------------------------------------------- VS hero */}
      <section className={`hero ${ended ? 'hero-ended' : ''}`}>
        <div className="hero-bg" />
        <SideCard v={A} battle={battle} align="left" />
        <div className="hero-center">
          <div className="hero-vs">VS</div>
          <DurationBlock battle={battle} elapsed={elapsed} />
          {!upcoming && <LeaderBlock battle={battle} A={A} B={B} />}
          {leadFlash && (
            <div key={leadFlash.k} className="lead-flash" style={sideStyle(e.tokens[leadFlash.leader].hue)}>
              ⚡ LEAD CHANGE · {e.tokens[leadFlash.leader].logo} {e.tokens[leadFlash.leader].ticker}
            </div>
          )}
        </div>
        <SideCard v={B} battle={battle} align="right" />
      </section>

      {/* --------------------------------------------------- score */}
      {!upcoming && <ScoreSection battle={battle} A={A} B={B} onRules={() => setRulesOpen(true)} />}
      {upcoming && <UpcomingInfo battle={battle} onRules={() => setRulesOpen(true)} />}

      {/* --------------------------------------------------- main grid */}
      <div className="battle-grid">
        <div className="battle-main">
          <PriceChart battle={battle} height={isMobile ? 280 : 380} />
          {isMobile && (
            <div id="trade">
              <TradePanel battle={battle} tokens={tokens} />
            </div>
          )}
          <ActivityTabs battle={battle} />
          <EndProof battle={battle} />
        </div>
        <aside className="battle-side">
          {!isMobile && <TradePanel battle={battle} tokens={tokens} />}
          <LoyaltyCard battle={battle} />
          <IntegrityPanel battle={battle} />
          <div className="panel">
            <div className="panel-head"><span className="panel-title">🏆 Battle Reward Pool</span><span className="mono">{sol(battle.rules.rewardPoolQuote, 0)}</span></div>
            <div className="panel-pad">
              <RewardSplitBar rules={battle.rules} compact />
              <p className="dim" style={{ fontSize: 11.5, margin: '10px 0 0' }}>Fixed before start. Winning does not guarantee price appreciation. <button className="btn-text link" onClick={() => setRulesOpen(true)}>Full rules →</button></p>
            </div>
          </div>
          <RecordsPanel battle={battle} />
        </aside>
      </div>

      {/* --------------------------------------------------- mobile sticky trade bar */}
      {isMobile && (
        <div className="sticky-trade">
          {tokens.map((t) => (
            <button key={t.id} className="btn btn-side-solid btn-lg grow" style={sideStyle(t.hue)} onClick={() => setSheet({ token: t.id, side: 'buy' })}>
              {t.logo} Buy {t.ticker}
            </button>
          ))}
          <button className="btn btn-sell btn-lg" onClick={() => setSheet({ token: e.wallet.positions[A.token.id]?.amount ? A.token.id : B.token.id, side: 'sell' })}>Sell</button>
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
          <IntegrityPanel battle={battle} />
        </Modal>
      )}
      {reveal && battle.final && <ResultReveal battle={battle} onClose={() => setReveal(false)} />}
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
  const myArmy = e.wallet.connected && e.wallet.armies[battle.id] === v.token.id;
  const pos = v.position;
  return (
    <div className={`side-card ${align} ${pos === 1 && !upcoming ? 'leading' : ''} ${isWinner ? 'winner' : ''}`} style={sideStyle(v.token.hue)}>
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
        <div className="side-mc-v mono"><Flash value={v.mcapUsd}>{usd(v.mcapUsd)}</Flash></div>
        {!upcoming && <div className={`side-chg mono ${v.change >= 0 ? 'up' : 'down'}`}>{v.change >= 0 ? '▲' : '▼'} {pct(v.change)} <span className="dim" style={{ fontSize: 11 }}>since start</span></div>}
      </div>

      {!upcoming && (
        <div className="side-pos">
          <span className={`pos-badge ${pos === 1 ? 'p1' : 'p2'}`}>{ended ? (isWinner ? '🏆 WINNER' : 'DEFEATED') : pos === 1 ? '#1 LEADING' : '#2 CHASING'}</span>
          <span className="side-score mono"><Flash value={v.score}>{v.score.toFixed(1)}</Flash><span className="dim" style={{ fontSize: 11 }}> pts</span></span>
        </div>
      )}

      <div className="side-stats">
        <Stat l="Price" v={fmtPrice(v.price)} />
        <Stat l="Holders" v={num(v.holders, false)} sub={!upcoming ? `${v.holdersDelta >= 0 ? '+' : ''}${num(v.holdersDelta)}` : undefined} subCls={v.holdersDelta >= 0 ? 'up' : 'down'} />
        <Stat l="Battle vol." v={usd(v.volumeUsd)} />
        <Stat l="Liquidity" v={usd(v.liquidityUsd)} />
        <Stat l="Buyers" v={num(v.buyers, false)} cls="up" />
        <Stat l="Sellers" v={num(v.sellers, false)} cls="down" />
      </div>
      {myArmy && <div className="army-tag">{v.token.logo} YOU'RE IN THE {v.token.ticker} ARMY</div>}
    </div>
  );
}

function Stat({ l, v, sub, cls = '', subCls = '' }: { l: string; v: string; sub?: string; cls?: string; subCls?: string }) {
  return (
    <div className="side-stat">
      <span className="label" style={{ fontSize: 9.5 }}>{l}</span>
      <span className={`mono ${cls}`}>{v}{sub && <span className={`${subCls}`} style={{ fontSize: 10.5, marginLeft: 4 }}>{sub}</span>}</span>
    </div>
  );
}

function DurationBlock({ battle, elapsed }: { battle: Battle; elapsed: number }) {
  const e = useData();
  const min = battle.rules.randomEnd.minDurationMs;
  const live = battle.status === 'live';
  const ended = battle.status === 'ended';
  if (!live && !ended) {
    return (
      <div className="dur">
        <div className="label">Starts in</div>
        <div className="dur-v mono">{duration(Math.max(0, battle.scheduledStart - e.now), true)}</div>
        <div className="dur-min">MINIMUM BATTLE TIME: {duration(min).toUpperCase()}</div>
        <div className="dim" style={{ fontSize: 11.5, marginTop: 6 }}>Ends at a random, verifiable moment after that.</div>
      </div>
    );
  }
  const sd = elapsed >= min;
  const lastCheck = battle.endChecks.at(-1);
  return (
    <div className={`dur ${sd && live ? 'dur-sd' : ''}`}>
      <div className="label">{ended ? 'Final duration' : 'Current duration'}</div>
      <div className="dur-v mono">{ended ? duration(battle.final!.durationMs, true) : duration(elapsed, true)}</div>
      <div className="dur-min">MINIMUM BATTLE TIME: {duration(min).toUpperCase()} {sd && '✓'}</div>
      {live && !sd && (
        <>
          <div className="progress" style={{ marginTop: 8 }}><div style={{ width: `${(elapsed / min) * 100}%`, background: 'var(--info)' }} /></div>
          <div className="dim" style={{ fontSize: 11.5, marginTop: 6 }}>🛡 Protected phase — the battle cannot end yet.</div>
        </>
      )}
      {live && sd && (
        <>
          <div className="sd-warn">⚠️ BATTLE CAN END AT ANY TIME</div>
          <div className="dim mono" style={{ fontSize: 11, marginTop: 6 }}>
            {battle.endChecks.length} end checks run{lastCheck && <> · last {lastCheck.value.toFixed(3)} → continue</>}
          </div>
        </>
      )}
      {ended && battle.final?.endCheck && (
        <div className="dim mono" style={{ fontSize: 11, marginTop: 8 }}>Ended by check #{battle.final.endCheck.index}: {battle.final.endCheck.value.toFixed(5)} &lt; {battle.final.endCheck.threshold.toFixed(5)}</div>
      )}
    </div>
  );
}

function LeaderBlock({ battle, A, B }: { battle: Battle; A: SideView; B: SideView }) {
  const ended = battle.status === 'ended';
  const L = A.position === 1 ? A : B;
  const margin = Math.abs(A.score - B.score);
  return (
    <div className="leader" style={sideStyle(L.token.hue)}>
      <div className="label">{ended ? 'Winner' : 'Current battle leader'}</div>
      <div className="leader-v">
        <TokenLogo token={L.token} size={30} />
        <span style={{ color: sideColor(L.token.hue, 70) }}>{L.token.ticker}</span>
        {ended && '🏆'}
      </div>
      <div className="mono dim" style={{ fontSize: 11.5 }}>by {margin.toFixed(1)} pts</div>
      {!ended && <div className="leader-note">Not guaranteed to win — the battle can end at a random moment and the score at that moment decides.</div>}
    </div>
  );
}

function ScoreSection({ battle, A, B, onRules }: { battle: Battle; A: SideView; B: SideView; onRules: () => void }) {
  const e = useData();
  const sa = battle.final?.scoreA ?? battle.a.score;
  const sb = battle.final?.scoreB ?? battle.b.score;
  const w = battle.rules.weights;
  const rows = [
    { k: 'Performance', w: w.performance, a: sa.performance, b: sb.performance, ia: pct(Math.exp(sa.inputs.twReturn) - 1), ib: pct(Math.exp(sb.inputs.twReturn) - 1), hint: 'time-weighted return' },
    { k: 'Holder growth', w: w.holderGrowth, a: sa.holderGrowth, b: sb.holderGrowth, ia: pct(sa.inputs.holderGrowthPct), ib: pct(sb.inputs.holderGrowthPct), hint: 'eligible holders' },
    { k: 'Market quality', w: w.marketQuality, a: sa.marketQuality, b: sb.marketQuality, ia: `${Math.round(sa.inputs.distribution * 100)}·${Math.round(sa.inputs.organicFlow * 100)}·${Math.round(sa.inputs.liquidityRetention * 100)}`, ib: `${Math.round(sb.inputs.distribution * 100)}·${Math.round(sb.inputs.organicFlow * 100)}·${Math.round(sb.inputs.liquidityRetention * 100)}`, hint: 'distrib · organic · liquidity' },
  ];
  return (
    <section className="panel score-panel">
      <div className="panel-head">
        <span className="panel-title">⚖️ Battle Score <InfoButton onClick={onRules} label="Score formula" /></span>
        <span className="dim" style={{ fontSize: 11.5 }}>60% performance · 20% holder growth · 20% market quality · formula locked at start</span>
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
          <div className="spread"><span className="label">Score timeline</span><span className="dim mono" style={{ fontSize: 11 }}>{Math.max(0, battle.leadChanges.length - 1)} lead changes</span></div>
          <ScoreTimeline battle={battle} />
          <div className="dim" style={{ fontSize: 11.5 }}>Raw volume is not scored. Flagged activity is excluded per rules. {e.source === 'simulated' && 'Values simulated.'}</div>
        </div>
      </div>
    </section>
  );
}

function ScoreTimeline({ battle }: { battle: Battle }) {
  const e = useData();
  const pts = battle.scoreHistory;
  const W = 400, H = 120;
  if (pts.length < 2) return <div className="dim" style={{ height: H, display: 'grid', placeItems: 'center' }}>Collecting…</div>;
  const tMax = Math.max(pts.at(-1)!.t, battle.rules.randomEnd.minDurationMs * 0.5);
  const vals = pts.flatMap((p) => [p.a, p.b]);
  const lo = Math.min(...vals) - 2, hi = Math.max(...vals) + 2;
  const X = (t: number) => (t / tMax) * W;
  const Y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const path = (k: 'a' | 'b') => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p[k]).toFixed(1)}`).join('');
  const ca = sideColor(e.tokens[battle.a.tokenId].hue);
  const cb = sideColor(e.tokens[battle.b.tokenId].hue);
  const minX = X(battle.rules.randomEnd.minDurationMs);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: H, display: 'block', margin: '8px 0' }}>
      {minX < W && <rect x={minX} y={0} width={W - minX} height={H} fill="rgba(255,181,71,0.06)" />}
      {minX < W && <line x1={minX} x2={minX} y1={0} y2={H} stroke="rgba(255,181,71,0.5)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
      {battle.leadChanges.slice(1).map((l) => <line key={l.t} x1={X(l.t)} x2={X(l.t)} y1={0} y2={H} stroke="rgba(255,255,255,0.08)" vectorEffect="non-scaling-stroke" />)}
      <path d={path('a')} fill="none" stroke={ca} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      <path d={path('b')} fill="none" stroke={cb} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function UpcomingInfo({ battle, onRules }: { battle: Battle; onRules: () => void }) {
  const e = useData();
  return (
    <section className="panel panel-pad" style={{ marginTop: 16 }}>
      <div className="grid grid-3" style={{ gap: 16 }}>
        <div className="stat"><span className="stat-l">Battle type</span><span className="stat-v" style={{ fontSize: 18 }}>{BATTLE_TYPES[battle.rules.type].label}</span><span className="dim" style={{ fontSize: 12 }}>{BATTLE_TYPES[battle.rules.type].blurb}</span></div>
        <div className="stat"><span className="stat-l">Reward pool</span><span className="stat-v" style={{ fontSize: 18 }}>{sol(battle.rules.rewardPoolQuote, 0)}</span><span className="dim" style={{ fontSize: 12 }}>≈ {usd(quoteToUsd(battle.rules.rewardPoolQuote))} · split shown below</span></div>
        <div className="stat"><span className="stat-l">Challenger</span><span className="stat-v" style={{ fontSize: 18 }}>{e.tokens[battle.challengerId].logo} ${e.tokens[battle.challengerId].ticker}</span><span className="dim" style={{ fontSize: 12 }}>{battle.status === 'pending' ? 'Waiting for the opponent to accept' : 'Accepted · rules locked at start'}</span></div>
      </div>
      <hr className="divider" />
      <RewardSplitBar rules={battle.rules} />
      <div className="row" style={{ marginTop: 14 }}><button className="btn" onClick={onRules}>📜 Read the full battle rules before trading</button></div>
    </section>
  );
}

function ActivityTabs({ battle }: { battle: Battle }) {
  const e = useData();
  const [tab, setTab] = useState<'trades' | 'feed' | 'mine'>('trades');
  const trades = [...battle.trades].reverse().slice(0, 60);
  const mine = !e.wallet.connected ? [] : e.wallet.trades.filter((t) => t.tokenId === battle.a.tokenId || t.tokenId === battle.b.tokenId);
  const feed = [...battle.feed].reverse().slice(0, 40);
  return (
    <div className="panel">
      <div className="panel-head" style={{ paddingTop: 0, paddingBottom: 0 }}>
        <div className="tabs" style={{ margin: 0, border: 0 }}>
          <button className={`tab ${tab === 'trades' ? 'active' : ''}`} onClick={() => setTab('trades')}>Live trades</button>
          <button className={`tab ${tab === 'feed' ? 'active' : ''}`} onClick={() => setTab('feed')}>Army feed</button>
          <button className={`tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>My trades {mine.length > 0 && `(${mine.length})`}</button>
        </div>
        <SimPill />
      </div>
      <div className="activity">
        {tab === 'trades' && (
          <table className="table trades-table">
            <thead><tr><th>Time</th><th>Token</th><th>Side</th><th className="num">SOL</th><th className="num hide-mobile">Tokens</th><th className="num">Wallet</th></tr></thead>
            <tbody>
              {trades.map((t) => {
                const tk = e.tokens[t.tokenId];
                return (
                  <tr key={t.id} className={`${t.flagged ? 'flagged' : ''} ${t.isUser ? 'mine' : ''}`}>
                    <td className="mono dim">{ago(e.now - t.t)}</td>
                    <td><span className="row" style={{ gap: 6 }}><TokenLogo token={tk} size={16} />{tk.ticker}</span></td>
                    <td className={t.side === 'buy' ? 'up' : 'down'} style={{ fontWeight: 700 }}>{t.side.toUpperCase()}</td>
                    <td className="num">{t.quoteAmount.toFixed(3)}</td>
                    <td className="num hide-mobile">{num(t.tokenAmount)}</td>
                    <td className="num dim">{t.isUser ? <b className="gold">YOU</b> : short(t.wallet)}{t.flagged && <span className="pill pill-down" style={{ marginLeft: 6, height: 17, fontSize: 9 }}>excluded</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {tab === 'feed' && (
          <div className="feed">
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
        {tab === 'mine' && (
          mine.length === 0 ? <div className="empty">No trades in this battle yet.</div> : (
            <table className="table">
              <thead><tr><th>Time</th><th>Token</th><th>Side</th><th className="num">SOL</th><th className="num">Tokens</th></tr></thead>
              <tbody>
                {mine.map((t) => (
                  <tr key={t.id}>
                    <td className="mono dim">{ago(e.now - t.t)}</td>
                    <td>{e.tokens[t.tokenId].logo} {e.tokens[t.tokenId].ticker}</td>
                    <td className={t.side === 'buy' ? 'up' : 'down'} style={{ fontWeight: 700 }}>{t.side.toUpperCase()}</td>
                    <td className="num">{t.quoteAmount.toFixed(3)}</td>
                    <td className="num">{num(t.tokenAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
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
          return (
            <Link key={tid} to={`/token/${tid}`} className="rec-mini" style={sideStyle(t.hue)}>
              <div className="spread">
                <span className="row" style={{ gap: 8 }}><TokenLogo token={t} size={24} /><b>${t.ticker}</b></span>
                <span className="mono"><span className="up">{r.wins}W</span> · <span className="down">{r.losses}L</span></span>
              </div>
              <div className="row" style={{ gap: 4, marginTop: 8 }}>
                {r.entries.slice(0, 10).map((x) => <span key={x.battleId} className={`form-dot ${x.won ? 'w' : 'l'}`} title={`${x.won ? 'Won' : 'Lost'} vs ${e.tokens[x.opponentId].ticker}`}>{x.won ? 'W' : 'L'}</span>)}
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
