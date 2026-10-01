import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { BattleType, Challenge, RewardSplit } from '../data/types';
import { useData, useEngineEvent } from '../data/DataContext';
import { useUi } from '../components/AppState';
import { duration, num, quoteToUsd, sol, usd } from '../lib/format';
import { BATTLE_TYPES, DEFAULT_SPLIT, HOUR, makeRules, medianEnd, rulesHash } from '../lib/rules';
import { RewardSplitBar, RulesContent } from '../components/BattleInfo';
import { SimPill, StreakBadge, TokenLogo, sideColor, sideStyle } from '../components/ui';
import { USER_CREATOR_ID } from '../data/seed';

const STEPS = ['Your token', 'Opponent', 'Battle rules', 'Reward pool', 'Review rules', 'Launch'];

export function CreateBattlePage() {
  const e = useData();
  const ui = useUi();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const mine = Object.values(e.tokens).filter((t) => t.creatorId === USER_CREATOR_ID);
  const busy = (id: string) => e.battles.some((b) => (b.status === 'live' || b.status === 'scheduled' || b.status === 'pending') && (b.a.tokenId === id || b.b.tokenId === id));

  const [step, setStep] = useState(0);
  const [tokenId, setTokenId] = useState(params.get('token') && e.tokens[params.get('token')!]?.creatorId === USER_CREATOR_ID ? params.get('token')! : mine[0]?.id);
  const [oppId, setOppId] = useState<string | undefined>(params.get('opponent') ?? undefined);
  const [type, setType] = useState<BattleType>('classic');
  const [minH, setMinH] = useState(1);
  const [message, setMessage] = useState('');
  const [pool, setPool] = useState(150);
  const [split, setSplit] = useState<RewardSplit>(DEFAULT_SPLIT);
  const [confirms, setConfirms] = useState<boolean[]>([false, false, false, false, false]);
  const [q, setQ] = useState('');
  const [sent, setSent] = useState<Challenge | null>(null);
  const [acceptedBattle, setAcceptedBattle] = useState<string | null>(null);

  const rules = useMemo(() => makeRules({ type, minDurationMs: minH * HOUR, rewardPoolQuote: pool, split }), [type, minH, pool, split]);
  const token = tokenId ? e.tokens[tokenId] : undefined;
  const opp = oppId ? e.tokens[oppId] : undefined;

  useEngineEvent((ev) => {
    if (ev.type === 'challenge-accepted' && sent && ev.challengeId === sent.id) setAcceptedBattle(ev.battleId);
  }, [sent?.id]);

  const splitOk = Math.abs(split.winnerLiquidity + split.holderRewards + split.platform - 1) < 1e-6;
  const canNext = [
    !!token,
    !!opp && opp.id !== tokenId,
    true,
    pool > 0 && splitOk,
    confirms.every(Boolean),
    true,
  ][step];

  const launch = () => {
    if (!ui.requireWallet() || !token || !opp) return;
    const ch = e.createChallenge({ fromTokenId: token.id, toTokenId: opp.id, rules, message });
    setSent(ch);
    setStep(5);
  };

  const setSplitPart = (k: keyof RewardSplit, v: number) => {
    const others = (['winnerLiquidity', 'holderRewards', 'platform'] as const).filter((x) => x !== k);
    const rest = 1 - v;
    const sumOthers = split[others[0]] + split[others[1]] || 1;
    const next = { ...split, [k]: v } as RewardSplit;
    next[others[0]] = Math.round((rest * split[others[0]]) / sumOthers * 100) / 100;
    next[others[1]] = Math.round((1 - v - next[others[0]]) * 100) / 100;
    setSplit(next);
  };

  const oppList = Object.values(e.tokens)
    .filter((t) => t.id !== tokenId && (q === '' || t.ticker.toLowerCase().includes(q.toLowerCase()) || t.name.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title">⚔️ Create a battle</h1>
          <div className="page-sub">Challenge another token to a 1v1. Every rule is shown — and locked — before the battle starts.</div>
        </div>
        <SimPill />
      </div>

      <div className="stepper">
        {STEPS.map((s, i) => (
          <button key={s} className={`step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`} disabled={i > step || !!sent} onClick={() => setStep(i)}>
            <span className="step-n">{i < step ? '✓' : i + 1}</span><span className="step-l">{s}</span>
          </button>
        ))}
      </div>

      {(token || opp) && (
        <div className="matchup panel">
          <div className="matchup-side" style={sideStyle(token?.hue ?? 220)}>{token ? <><TokenLogo token={token} size={46} /><b>${token.ticker}</b></> : <span className="dim">Your token</span>}</div>
          <div className="matchup-vs">VS</div>
          <div className="matchup-side right" style={sideStyle(opp?.hue ?? 220)}>{opp ? <><b>${opp.ticker}</b><TokenLogo token={opp} size={46} /></> : <span className="dim">Opponent</span>}</div>
        </div>
      )}

      <div className="panel panel-pad wizard">
        {step === 0 && (
          <>
            <h3 className="wiz-title">Step 1 · Select your token</h3>
            <p className="muted">Only tokens you created can issue challenges.</p>
            <div className="pick-grid">
              {mine.map((t) => (
                <button key={t.id} className={`pick ${tokenId === t.id ? 'active' : ''}`} style={sideStyle(t.hue)} onClick={() => setTokenId(t.id)} disabled={busy(t.id)}>
                  <TokenLogo token={t} size={40} />
                  <div style={{ textAlign: 'left' }}>
                    <b>${t.ticker}</b>
                    <div className="muted" style={{ fontSize: 12 }}>{t.name} · {usd(quoteToUsd(e.markets[t.id].price * t.totalSupply))} MC</div>
                    {busy(t.id) && <div className="warn" style={{ fontSize: 11 }}>Already in a battle</div>}
                  </div>
                </button>
              ))}
            </div>
            <Link to="/launch" className="link" style={{ display: 'inline-block', marginTop: 12 }}>+ Launch a new token</Link>
          </>
        )}

        {step === 1 && (
          <>
            <h3 className="wiz-title">Step 2 · Choose opponent</h3>
            <input className="input" placeholder="Search tokens…" value={q} onChange={(ev) => setQ(ev.target.value)} style={{ marginBottom: 12 }} />
            <div className="pick-grid">
              {oppList.map((t) => {
                const r = e.recordFor(t.id);
                const b = busy(t.id);
                return (
                  <button key={t.id} className={`pick ${oppId === t.id ? 'active' : ''}`} style={sideStyle(t.hue)} onClick={() => setOppId(t.id)} disabled={b}>
                    <TokenLogo token={t} size={40} />
                    <div style={{ textAlign: 'left', minWidth: 0 }} className="grow">
                      <div className="row" style={{ gap: 6 }}><b>${t.ticker}</b><StreakBadge streak={r.streak} /></div>
                      <div className="muted mono" style={{ fontSize: 11.5 }}>{r.wins}W-{r.losses}L · {usd(quoteToUsd(e.markets[t.id].price * t.totalSupply))} · {num(e.markets[t.id].holders)} holders</div>
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
            <div className="field" style={{ marginTop: 16 }}><label>Battle Score formula</label>
              <div className="callout"><span>🔒</span><span>Standard formula v1: <b>60% time-weighted relative price performance · 20% unique holder growth · 20% market quality</b>. Raw volume is not scored. Fixed for every battle so communities compete on equal terms.</span></div>
            </div>
            <div className="field" style={{ marginTop: 16 }}><label>Message to opponent (optional)</label>
              <input className="input" maxLength={120} value={message} onChange={(ev) => setMessage(ev.target.value)} placeholder={`$${token?.ticker} is coming for you.`} />
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h3 className="wiz-title">Step 4 · Set reward pool</h3>
            <div className="field"><label>Pool size (SOL) — funded & locked before start</label>
              <div className="row wrap" style={{ gap: 8 }}>
                {[50, 100, 150, 250, 500].map((p) => <button key={p} className={`chip ${pool === p ? 'active' : ''}`} onClick={() => setPool(p)}>{p} SOL</button>)}
                <input className="input mono" style={{ width: 120 }} type="number" min={1} value={pool} onChange={(ev) => setPool(Math.max(0, +ev.target.value))} />
                <span className="muted">≈ {usd(quoteToUsd(pool))}</span>
              </div>
            </div>
            <div className="field" style={{ marginTop: 18 }}><label>Distribution (launchpad default 50 / 25 / 25)</label>
              {([['winnerLiquidity', 'Winner liquidity support', 'Added to the winning token\'s pool liquidity.'], ['holderRewards', 'Eligible holder rewards', 'Battle Loyalty payouts to winning-token holders.'], ['platform', 'Platform / ecosystem', 'Platform operations and ecosystem programs.']] as const).map(([k, l, d]) => (
                <div key={k} className="split-edit">
                  <div className="grow"><b>{l}</b><div className="dim" style={{ fontSize: 12 }}>{d}</div></div>
                  <input type="range" min={0} max={100} step={5} value={Math.round(split[k] * 100)} onChange={(ev) => setSplitPart(k, +ev.target.value / 100)} />
                  <span className="mono" style={{ width: 48, textAlign: 'right' }}>{Math.round(split[k] * 100)}%</span>
                </div>
              ))}
              <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setSplit(DEFAULT_SPLIT)}>Reset to default</button>
            </div>
            <div style={{ marginTop: 16 }}><RewardSplitBar rules={rules} /></div>
            <div className="callout callout-warn" style={{ marginTop: 14 }}><span>⚠️</span><span>Rewards don't guarantee price appreciation for the winner. Traders see this split before they participate.</span></div>
          </>
        )}

        {step === 4 && token && opp && (
          <>
            <h3 className="wiz-title">Step 5 · Review battle rules</h3>
            <div className="kv"><span>Commitment hash (preview)</span><span className="hash">{rulesHash(rules, token.id, opp.id).slice(0, 32)}…</span></div>
            <hr className="divider" />
            <RulesContent rules={rules} a={token} b={opp} />
            <hr className="divider" />
            <h4 className="label" style={{ marginBottom: 6 }}>Confirm to continue</h4>
            {[
              `Duration: minimum ${duration(rules.randomEnd.minDurationMs)}, then a random end with ${(rules.randomEnd.hazardPerEpoch * 100).toFixed(2)}% per ${Math.round(rules.randomEnd.epochMs / 1000)}s check. No countdown.`,
              'Random ending is decided only by the public beacon and the committed hash — I cannot choose or influence when it ends.',
              'Battle Score: 60% time-weighted performance, 20% holder growth, 20% market quality.',
              `Rewards: ${sol(pool, 0)} pool split ${Math.round(split.winnerLiquidity * 100)}/${Math.round(split.holderRewards * 100)}/${Math.round(split.platform * 100)}. Anti-manipulation exclusions apply as published.`,
              'Once the battle begins, these rules cannot be changed by anyone.',
            ].map((c, i) => (
              <label key={i} className="check">
                <input type="checkbox" checked={confirms[i]} onChange={(ev) => setConfirms(confirms.map((x, j) => (j === i ? ev.target.checked : x)))} />
                <span>{c}</span>
              </label>
            ))}
          </>
        )}

        {step === 5 && token && opp && (
          <div className="center launch-done">
            <div className="launch-vs">
              <TokenLogo token={token} size={72} /><span className="hero-vs" style={{ fontSize: 34 }}>VS</span><TokenLogo token={opp} size={72} />
            </div>
            <h2 className="display" style={{ fontSize: 30, margin: '14px 0 6px', letterSpacing: '0.06em' }}>
              <span style={{ color: sideColor(token.hue, 68) }}>${token.ticker}</span> challenges <span style={{ color: sideColor(opp.hue, 68) }}>${opp.ticker}</span>
            </h2>
            {!acceptedBattle ? (
              <>
                <p className="muted">Challenge sent. Waiting for ${opp.ticker}'s creator to accept… <span className="spinner" /></p>
                <p className="dim" style={{ fontSize: 12 }}>(Simulated opponent responds in a few seconds.)</p>
              </>
            ) : (
              <>
                <p className="up" style={{ fontWeight: 700 }}>✓ ${opp.ticker} accepted. The battle is scheduled and its rules are locked at start.</p>
                <button className="btn btn-battle btn-lg" onClick={() => nav(`/battle/${acceptedBattle}`)}>⚔️ Go to battle</button>
              </>
            )}
          </div>
        )}

        {step < 5 && (
          <div className="spread wizard-nav">
            <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>← Back</button>
            {step < 4 && <button className="btn btn-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Continue →</button>}
            {step === 4 && <button className="btn btn-battle btn-lg" disabled={!canNext} onClick={launch}>⚔️ Launch battle challenge</button>}
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
  const ch = e.challenges.find((c) => c.id === id);
  if (!ch) return <div className="page"><div className="panel empty">Challenge not found.</div></div>;
  const from = e.tokens[ch.fromTokenId];
  const to = e.tokens[ch.toTokenId];
  const rf = e.recordFor(from.id);
  const rt = e.recordFor(to.id);
  const accept = () => {
    if (!ui.requireWallet()) return;
    e.respondChallenge(ch.id, true);
    const b = [...e.battles].reverse().find((x) => x.a.tokenId === from.id && x.b.tokenId === to.id);
    if (b) nav(`/battle/${b.id}`);
  };
  return (
    <div className="page page-narrow">
      <div className="challenge panel">
        <div className="challenge-glow" style={{ '--ha': from.hue, '--hb': to.hue } as React.CSSProperties} />
        <div className="label center" style={{ color: 'var(--warn)' }}>Incoming</div>
        <h1 className="page-title center" style={{ fontSize: 46, marginTop: 6 }}>⚔️ Battle challenge</h1>
        <div className="launch-vs" style={{ margin: '26px 0 12px' }}>
          <div className="center"><TokenLogo token={from} size={96} /><div className="display" style={{ fontSize: 24, fontWeight: 700, marginTop: 8 }}>${from.ticker}</div><div className="mono muted" style={{ fontSize: 12 }}>{rf.wins}W-{rf.losses}L</div><StreakBadge streak={rf.streak} /></div>
          <span className="hero-vs">VS</span>
          <div className="center"><TokenLogo token={to} size={96} /><div className="display" style={{ fontSize: 24, fontWeight: 700, marginTop: 8 }}>${to.ticker}</div><div className="mono muted" style={{ fontSize: 12 }}>{rt.wins}W-{rt.losses}L</div><StreakBadge streak={rt.streak} /></div>
        </div>
        <p className="center" style={{ fontSize: 18 }}><b>${from.ticker}</b> has challenged <b>${to.ticker}</b>.</p>
        {ch.message && <p className="center muted" style={{ fontStyle: 'italic' }}>“{ch.message}”</p>}
        <div className="grid grid-3" style={{ margin: '20px 0', gap: 10 }}>
          <div className="panel panel-pad stat"><span className="stat-l">Type</span><span className="stat-v" style={{ fontSize: 16 }}>{BATTLE_TYPES[ch.rules.type].label}</span></div>
          <div className="panel panel-pad stat"><span className="stat-l">Minimum</span><span className="stat-v" style={{ fontSize: 16 }}>{duration(ch.rules.randomEnd.minDurationMs)} · random end</span></div>
          <div className="panel panel-pad stat"><span className="stat-l">Reward pool</span><span className="stat-v" style={{ fontSize: 16 }}>{sol(ch.rules.rewardPoolQuote, 0)}</span></div>
        </div>
        <details className="rules-details">
          <summary>📜 Read the full battle rules</summary>
          <div style={{ marginTop: 14 }}><RulesContent rules={ch.rules} a={from} b={to} /></div>
        </details>
        {ch.status === 'pending' ? (
          <div className="row" style={{ justifyContent: 'center', gap: 12, marginTop: 22 }}>
            <button className="btn btn-battle btn-lg" onClick={accept}>⚔️ Accept battle</button>
            <button className="btn btn-lg" onClick={() => { e.respondChallenge(ch.id, false); ui.toast({ title: 'Challenge declined', tone: 'info' }); }}>Decline</button>
          </div>
        ) : (
          <p className="center label" style={{ marginTop: 20 }}>Challenge {ch.status}</p>
        )}
      </div>
    </div>
  );
}
