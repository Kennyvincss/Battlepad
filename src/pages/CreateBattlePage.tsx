import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { BattleType, RewardSplit } from '../lib/shared';
import { BATTLE_TYPES, DEFAULT_SPLIT, HOUR, MINUTE, makeRules, medianEnd, rulesHash } from '../lib/shared';
import { useData } from '../data/DataContext';
import { useUi } from '../components/AppState';
import { duration, num, usd } from '../lib/format';
import { RewardSplitBar, RulesContent } from '../components/BattleInfo';
import { StreakBadge, TokenLogo, sideColor, sideStyle } from '../components/ui';

const STEPS = ['Your token', 'Opponent', 'Battle rules', 'Treasury split', 'Review rules', 'Send challenge'];
const START_OPTIONS = [{ k: '15 minutes', ms: 15 * MINUTE }, { k: '1 hour', ms: HOUR }, { k: '3 hours', ms: 3 * HOUR }, { k: '24 hours', ms: 24 * HOUR }];

export function CreateBattlePage() {
  const e = useData();
  const ui = useUi();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const mine = e.myTokens();
  const busy = (id: string) => e.battles.some((b) => (b.status === 'live' || b.status === 'scheduled') && (b.a.tokenId === id || b.b.tokenId === id));

  const [step, setStep] = useState(0);
  const [tokenId, setTokenId] = useState<string | undefined>(params.get('token') ?? undefined);
  const [oppId, setOppId] = useState<string | undefined>(params.get('opponent') ?? undefined);
  const [type, setType] = useState<BattleType>('classic');
  const [minH, setMinH] = useState(1);
  const [startIn, setStartIn] = useState(START_OPTIONS[1].ms);
  const [message, setMessage] = useState('');
  const [split, setSplit] = useState<RewardSplit>(DEFAULT_SPLIT);
  const [confirms, setConfirms] = useState<boolean[]>([false, false, false, false, false]);
  const [q, setQ] = useState('');
  const [sending, setSending] = useState(false);
  const [sentId, setSentId] = useState<string | null>(null);

  const rules = useMemo(() => makeRules({ type, minDurationMs: minH * HOUR, split }), [type, minH, split]);
  const myToken = tokenId && e.tokens[tokenId]?.listedBy === e.wallet.address ? e.tokens[tokenId] : mine[0];
  const opp = oppId ? e.tokens[oppId] : undefined;
  const sent = sentId ? e.getBattle(sentId) : undefined;

  if (!e.configured) return <div className="page page-narrow"><div className="panel empty">Battles need the live backend. See the banner above.</div></div>;
  if (!e.wallet.connected) {
    return (
      <div className="page page-narrow">
        <div className="panel empty" style={{ padding: 50 }}>
          <div style={{ fontSize: 40 }}>⚔️</div>
          <h2 className="display" style={{ fontSize: 26 }}>Challenge a token</h2>
          <p className="muted">Connect the wallet that listed your token to send a challenge.</p>
          <button className="btn btn-primary btn-lg" onClick={ui.openWallet}>Connect Wallet</button>
        </div>
      </div>
    );
  }
  if (mine.length === 0 && !sent) {
    return (
      <div className="page page-narrow">
        <div className="panel empty" style={{ padding: 50 }}>
          <div style={{ fontSize: 40 }}>🚀</div>
          <h2 className="display" style={{ fontSize: 26 }}>List a token first</h2>
          <p className="muted">Only listed tokens can battle, and only their lister can send a challenge.</p>
          <Link to="/launch" className="btn btn-battle btn-lg">List your token</Link>
        </div>
      </div>
    );
  }

  const splitOk = Math.abs(split.winnerLiquidity + split.holderRewards + split.platform - 1) < 1e-6;
  const canNext = [!!myToken, !!opp && opp.id !== myToken?.id, true, splitOk, confirms.every(Boolean), true][step];

  const send = async () => {
    if (!myToken || !opp) return;
    if (!(await ui.requireSignIn())) return;
    setSending(true);
    try {
      const id = await e.createChallenge(myToken.id, opp.id, rules, message, Date.now() + startIn);
      setSentId(id);
      setStep(5);
    } catch (err) {
      ui.toast({ title: 'Challenge not sent', body: (err as Error).message, tone: 'bad' });
    } finally {
      setSending(false);
    }
  };

  const setSplitPart = (k: keyof RewardSplit, v: number) => {
    const others = (['winnerLiquidity', 'holderRewards', 'platform'] as const).filter((x) => x !== k);
    const sumOthers = split[others[0]] + split[others[1]] || 1;
    const next = { ...split, [k]: v } as RewardSplit;
    next[others[0]] = Math.round(((1 - v) * split[others[0]]) / sumOthers * 100) / 100;
    next[others[1]] = Math.round((1 - v - next[others[0]]) * 100) / 100;
    setSplit(next);
  };

  const oppList = Object.values(e.tokens).filter((t) => t.id !== myToken?.id && (q === '' || t.ticker.toLowerCase().includes(q.toLowerCase()) || t.name.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title">⚔️ Create a battle</h1>
          <div className="page-sub">Challenge another listed token to a 1v1. Every rule is shown — and locked — before the battle starts.</div>
        </div>
      </div>

      <div className="stepper">
        {STEPS.map((s, i) => (
          <button key={s} className={`step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`} disabled={i > step || !!sentId} onClick={() => setStep(i)}>
            <span className="step-n">{i < step ? '✓' : i + 1}</span><span className="step-l">{s}</span>
          </button>
        ))}
      </div>

      {(myToken || opp) && (
        <div className="matchup panel">
          <div className="matchup-side" style={sideStyle(myToken?.hue ?? 220)}>{myToken ? <><TokenLogo token={myToken} size={46} /><b>${myToken.ticker}</b></> : <span className="dim">Your token</span>}</div>
          <div className="matchup-vs">VS</div>
          <div className="matchup-side right" style={sideStyle(opp?.hue ?? 220)}>{opp ? <><b>${opp.ticker}</b><TokenLogo token={opp} size={46} /></> : <span className="dim">Opponent</span>}</div>
        </div>
      )}

      <div className="panel panel-pad wizard">
        {step === 0 && (
          <>
            <h3 className="wiz-title">Step 1 · Select your token</h3>
            <p className="muted">Only tokens your connected wallet listed can issue challenges.</p>
            <div className="pick-grid">
              {mine.map((t) => (
                <button key={t.id} className={`pick ${myToken?.id === t.id ? 'active' : ''}`} style={sideStyle(t.hue)} onClick={() => setTokenId(t.id)} disabled={busy(t.id)}>
                  <TokenLogo token={t} size={40} />
                  <div style={{ textAlign: 'left' }}>
                    <b>${t.ticker}</b>
                    <div className="muted" style={{ fontSize: 12 }}>{t.name} · {usd(e.markets[t.id]?.mcapUsd)} MC</div>
                    {busy(t.id) && <div className="warn" style={{ fontSize: 11 }}>Already in a battle</div>}
                  </div>
                </button>
              ))}
            </div>
            <Link to="/launch" className="link" style={{ display: 'inline-block', marginTop: 12 }}>+ List another token</Link>
          </>
        )}

        {step === 1 && (
          <>
            <h3 className="wiz-title">Step 2 · Choose opponent</h3>
            <input className="input" id="opp-search" placeholder="Search listed tokens…" value={q} onChange={(ev) => setQ(ev.target.value)} style={{ marginBottom: 12 }} />
            {oppList.length === 0 && <div className="empty">No other tokens are listed yet.</div>}
            <div className="pick-grid">
              {oppList.map((t) => {
                const r = e.recordFor(t.id);
                const b = busy(t.id);
                return (
                  <button key={t.id} className={`pick ${oppId === t.id ? 'active' : ''}`} style={sideStyle(t.hue)} onClick={() => setOppId(t.id)} disabled={b}>
                    <TokenLogo token={t} size={40} />
                    <div style={{ textAlign: 'left', minWidth: 0 }} className="grow">
                      <div className="row" style={{ gap: 6 }}><b>${t.ticker}</b><StreakBadge streak={r.streak} /></div>
                      <div className="muted mono" style={{ fontSize: 11.5 }}>{r.wins}W-{r.losses}L · {usd(e.markets[t.id]?.mcapUsd)} · {usd(e.markets[t.id]?.liquidityUsd)} liq.</div>
                      {b && <div className="warn" style={{ fontSize: 11 }}>In a battle — challenge later</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h3 className="wiz-title">Step 3 · Choose battle rules</h3>
            <div className="field"><label>Battle type</label>
              <div className="grid grid-3">
                {(Object.keys(BATTLE_TYPES) as BattleType[]).map((k) => (
                  <button key={k} className={`pick col ${type === k ? 'active' : ''}`} style={{ alignItems: 'flex-start' }} onClick={() => setType(k)}>
                    <b>{BATTLE_TYPES[k].label}</b>
                    <span className="muted" style={{ fontSize: 12, textAlign: 'left' }}>{BATTLE_TYPES[k].blurb}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="field" style={{ marginTop: 16 }}><label>Minimum duration</label>
              <div className="seg" style={{ alignSelf: 'flex-start' }}>
                {[1, 2, 3].map((h) => <button key={h} className={minH === h ? 'active' : ''} onClick={() => setMinH(h)}>{h} hour{h > 1 ? 's' : ''}</button>)}
              </div>
              <span className="dim" style={{ fontSize: 12 }}>Every battle lasts at least 1 hour. After the minimum it ends at a random, verifiable moment — median ≈ {duration(medianEnd(rules))}, safety cap {duration(rules.randomEnd.maxDurationMs)}.</span>
            </div>
            <div className="field" style={{ marginTop: 16 }}><label>Proposed start</label>
              <div className="seg" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
                {START_OPTIONS.map((o) => <button key={o.k} className={startIn === o.ms ? 'active' : ''} onClick={() => setStartIn(o.ms)}>In {o.k}</button>)}
              </div>
              <span className="dim" style={{ fontSize: 12 }}>If the opponent accepts late, the start moves to at least 5 minutes after acceptance.</span>
            </div>
            <div className="field" style={{ marginTop: 16 }}><label>Battle Score formula</label>
              <div className="callout"><span>🔒</span><span>Standard formula: <b>60% time-weighted relative price performance · 20% unique holder growth · 20% market quality</b>. Raw volume is not scored. The same for every battle.</span></div>
            </div>
            <div className="field" style={{ marginTop: 16 }}><label htmlFor="ch-msg">Message to opponent (optional)</label>
              <input className="input" id="ch-msg" maxLength={140} value={message} onChange={(ev) => setMessage(ev.target.value)} placeholder={`$${myToken?.ticker} is coming for you.`} />
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h3 className="wiz-title">Step 4 · Treasury split</h3>
            <p className="muted">The battle treasury is funded by BATTLE's swap fee on trades made through the app during the battle. Choose how it's split when the battle ends.</p>
            <div className="field" style={{ marginTop: 10 }}><label>Distribution (launchpad default 50 / 25 / 25)</label>
              {([['winnerLiquidity', 'Winner liquidity support', "Added to the winning token's pool liquidity."], ['holderRewards', 'Eligible holder rewards', 'Battle Loyalty payouts to winning-token holders.'], ['platform', 'Platform / ecosystem', 'Platform operations and ecosystem programs.']] as const).map(([k, l, d]) => (
                <div key={k} className="split-edit">
                  <div className="grow"><b>{l}</b><div className="dim" style={{ fontSize: 12 }}>{d}</div></div>
                  <input type="range" min={0} max={100} step={5} value={Math.round(split[k] * 100)} onChange={(ev) => setSplitPart(k, +ev.target.value / 100)} aria-label={l} />
                  <span className="mono" style={{ width: 48, textAlign: 'right' }}>{Math.round(split[k] * 100)}%</span>
                </div>
              ))}
              <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setSplit(DEFAULT_SPLIT)}>Reset to default</button>
            </div>
            <div style={{ marginTop: 16 }}><RewardSplitBar rules={rules} /></div>
            <div className="callout callout-warn" style={{ marginTop: 14 }}><span>⚠️</span><span>Rewards don't guarantee price appreciation for the winner. Traders see this split before they participate.</span></div>
          </>
        )}

        {step === 4 && myToken && opp && (
          <>
            <h3 className="wiz-title">Step 5 · Review battle rules</h3>
            <div className="kv"><span>Commitment hash</span><span className="hash">{rulesHash(rules, myToken.id, opp.id).slice(0, 32)}…</span></div>
            <hr className="divider" />
            <RulesContent rules={rules} a={myToken} b={opp} />
            <hr className="divider" />
            <h4 className="label" style={{ marginBottom: 6 }}>Confirm to continue</h4>
            {[
              `Duration: minimum ${duration(rules.randomEnd.minDurationMs)}, then a random end with ${(rules.randomEnd.hazardPerEpoch * 100).toFixed(2)}% per ${Math.round(rules.randomEnd.epochMs / 1000)}s check. No countdown.`,
              'The end is decided only by the public drand beacon and the committed hash — I cannot choose or influence when it ends.',
              'Battle Score: 60% time-weighted performance, 20% holder growth, 20% market quality, from the published data sources.',
              `Treasury split ${Math.round(split.winnerLiquidity * 100)}/${Math.round(split.holderRewards * 100)}/${Math.round(split.platform * 100)}. Anti-manipulation exclusions apply as published.`,
              'Once the battle begins, these rules cannot be changed by anyone.',
            ].map((c, i) => (
              <label key={i} className="check">
                <input type="checkbox" checked={confirms[i]} onChange={(ev) => setConfirms(confirms.map((x, j) => (j === i ? ev.target.checked : x)))} />
                <span>{c}</span>
              </label>
            ))}
          </>
        )}

        {step === 5 && myToken && opp && (
          <div className="center launch-done">
            <div className="launch-vs">
              <TokenLogo token={myToken} size={72} /><span className="hero-vs" style={{ fontSize: 34 }}>VS</span><TokenLogo token={opp} size={72} />
            </div>
            <h2 className="display" style={{ fontSize: 30, margin: '14px 0 6px', letterSpacing: '0.06em' }}>
              <span style={{ color: sideColor(myToken.hue, 68) }}>${myToken.ticker}</span> challenges <span style={{ color: sideColor(opp.hue, 68) }}>${opp.ticker}</span>
            </h2>
            {sent?.status === 'scheduled' ? (
              <>
                <p className="up" style={{ fontWeight: 700 }}>✓ ${opp.ticker} accepted. The battle is scheduled and its rules lock at start.</p>
                <button className="btn btn-battle btn-lg" onClick={() => nav(`/battle/${sent.id}`)}>⚔️ Go to battle</button>
              </>
            ) : sent?.status === 'declined' ? (
              <p className="down">${opp.ticker} declined the challenge.</p>
            ) : (
              <>
                <p className="muted">Challenge sent. ${opp.ticker}'s lister sees it in their notifications. This page updates live when they respond.</p>
                {sentId && <Link className="btn" to={`/challenge/${sentId}`}>Share challenge link</Link>}
              </>
            )}
          </div>
        )}

        {step < 5 && (
          <div className="spread wizard-nav">
            <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>← Back</button>
            {step < 4 && <button className="btn btn-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Continue →</button>}
            {step === 4 && <button className="btn btn-battle btn-lg" disabled={!canNext || sending} onClick={send}>{sending ? 'Sending…' : '⚔️ Send battle challenge'}</button>}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChallengePage() {
  const { id } = useParams();
  const e = useData();
  const ui = useUi();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const b = id ? e.getBattle(id) : undefined;
  if (!b) return <div className="page"><div className="panel empty">{e.ready ? 'Challenge not found.' : 'Loading…'}</div></div>;
  const from = e.tokens[b.a.tokenId];
  const to = e.tokens[b.b.tokenId];
  if (!from || !to) return <div className="page"><div className="panel empty">Loading…</div></div>;
  const rf = e.recordFor(from.id);
  const rt = e.recordFor(to.id);
  const canRespond = b.status === 'pending' && to.listedBy === e.wallet.address;
  const respond = async (accept: boolean) => {
    if (!(await ui.requireSignIn())) return;
    setBusy(true);
    try {
      await e.respondChallenge(b.id, accept);
      ui.toast({ title: accept ? '⚔️ Battle accepted' : 'Challenge declined', body: accept ? 'Rules lock when it starts.' : undefined, tone: accept ? 'good' : 'info' });
      if (accept) nav(`/battle/${b.id}`);
    } catch (err) {
      ui.toast({ title: 'Could not respond', body: (err as Error).message, tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page page-narrow">
      <div className="challenge panel">
        <div className="challenge-glow" style={{ '--ha': from.hue, '--hb': to.hue } as React.CSSProperties} />
        <div className="label center" style={{ color: 'var(--warn)' }}>{b.status === 'pending' ? 'Open challenge' : `Challenge ${b.status}`}</div>
        <h1 className="page-title center" style={{ fontSize: 46, marginTop: 6 }}>⚔️ Battle challenge</h1>
        <div className="launch-vs" style={{ margin: '26px 0 12px' }}>
          <div className="center"><TokenLogo token={from} size={96} /><div className="display" style={{ fontSize: 24, fontWeight: 700, marginTop: 8 }}>${from.ticker}</div><div className="mono muted" style={{ fontSize: 12 }}>{rf.wins}W-{rf.losses}L · {usd(e.markets[from.id]?.mcapUsd)}</div><StreakBadge streak={rf.streak} /></div>
          <span className="hero-vs">VS</span>
          <div className="center"><TokenLogo token={to} size={96} /><div className="display" style={{ fontSize: 24, fontWeight: 700, marginTop: 8 }}>${to.ticker}</div><div className="mono muted" style={{ fontSize: 12 }}>{rt.wins}W-{rt.losses}L · {usd(e.markets[to.id]?.mcapUsd)}</div><StreakBadge streak={rt.streak} /></div>
        </div>
        <p className="center" style={{ fontSize: 18 }}><b>${from.ticker}</b> has challenged <b>${to.ticker}</b>.</p>
        {b.challengeMessage && <p className="center muted" style={{ fontStyle: 'italic' }}>“{b.challengeMessage}”</p>}
        <div className="grid grid-3" style={{ margin: '20px 0', gap: 10 }}>
          <div className="panel panel-pad stat"><span className="stat-l">Type</span><span className="stat-v" style={{ fontSize: 16 }}>{BATTLE_TYPES[b.rules.type].label}</span></div>
          <div className="panel panel-pad stat"><span className="stat-l">Minimum</span><span className="stat-v" style={{ fontSize: 16 }}>{duration(b.rules.randomEnd.minDurationMs)} · random end</span></div>
          <div className="panel panel-pad stat"><span className="stat-l">Proposed start</span><span className="stat-v" style={{ fontSize: 16 }}>{new Date(b.scheduledStart).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
        </div>
        <details className="rules-details">
          <summary>📜 Read the full battle rules</summary>
          <div style={{ marginTop: 14 }}><RulesContent rules={b.rules} a={from} b={to} /></div>
        </details>
        {canRespond ? (
          <div className="row" style={{ justifyContent: 'center', gap: 12, marginTop: 22 }}>
            <button className="btn btn-battle btn-lg" disabled={busy} onClick={() => respond(true)}>⚔️ Accept battle</button>
            <button className="btn btn-lg" disabled={busy} onClick={() => respond(false)}>Decline</button>
          </div>
        ) : b.status === 'pending' ? (
          <p className="center muted" style={{ marginTop: 20 }}>Waiting for ${to.ticker}'s lister ({to.listedBy.slice(0, 4)}…{to.listedBy.slice(-4)}) to respond.{!e.wallet.connected && ' If that is you, connect that wallet.'}</p>
        ) : (
          <div className="center" style={{ marginTop: 20 }}><Link className="btn btn-primary" to={`/battle/${b.id}`}>Open battle</Link></div>
        )}
        <p className="center dim" style={{ fontSize: 12, marginTop: 12 }}>{num(rf.entries.length + rt.entries.length)} previous battles between them and others.</p>
      </div>
    </div>
  );
}
