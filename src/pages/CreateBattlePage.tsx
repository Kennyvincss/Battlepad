import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { BattleType, RewardSplit } from '../lib/shared';
import { BATTLE_TYPES, DEFAULT_SPLIT, DURATIONS, HOUR, MINUTE, makeRules, medianEnd } from '../lib/shared';
import { useData } from '../data/DataContext';
import { useUi } from '../components/AppState';
import { duration, pct, usd } from '../lib/format';
import { isAutoListed } from '../lib/view';
import { RewardSplitBar, RulesContent } from '../components/BattleInfo';
import { TokenLogo, sideStyle } from '../components/ui';

const STEPS = ['Pick two coins', 'Length & prizes', 'Review & start'];
const START_OPTIONS = [{ k: 'Right away', ms: 0 }, { k: 'In 15 min', ms: 15 * MINUTE }, { k: 'In 1 hour', ms: HOUR }, { k: 'In 24 hours', ms: 24 * HOUR }];
const PARTS = [
  ['winnerLiquidity', 'Winner liquidity support', "Added to the winning coin's pool liquidity."],
  ['holderRewards', 'Holder rewards', 'Paid to holders of the winning coin.'],
  ['platform', 'Platform', 'Platform operations and future programs.'],
] as const;

export function CreateBattlePage() {
  const e = useData();
  const ui = useUi();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const busy = (id: string) => e.battles.some((b) => (b.status === 'live' || b.status === 'scheduled' || b.status === 'pending') && (b.a.tokenId === id || b.b.tokenId === id));

  const [step, setStep] = useState(0);
  const [aId, setAId] = useState<string | undefined>(params.get('token') ?? undefined);
  const [bId, setBId] = useState<string | undefined>(params.get('opponent') ?? undefined);
  const [type, setType] = useState<BattleType>('classic');
  const [minMs, setMinMs] = useState(HOUR);
  const [startIn, setStartIn] = useState(0);
  const [pcts, setPcts] = useState({ winnerLiquidity: 50, holderRewards: 25, platform: 25 });
  const [agree, setAgree] = useState(false);
  const [q, setQ] = useState('');
  const [sending, setSending] = useState(false);

  const split: RewardSplit = { winnerLiquidity: pcts.winnerLiquidity / 100, holderRewards: pcts.holderRewards / 100, platform: pcts.platform / 100 };
  const total = pcts.winnerLiquidity + pcts.holderRewards + pcts.platform;
  const splitOk = total === 100 && Object.values(pcts).every((v) => Number.isInteger(v) && v >= 0 && v <= 100);
  const rules = useMemo(() => makeRules({ type, minDurationMs: minMs, split: splitOk ? split : DEFAULT_SPLIT }), [type, minMs, splitOk, pcts]); // eslint-disable-line react-hooks/exhaustive-deps
  const A = aId ? e.tokens[aId] : undefined;
  const B = bId ? e.tokens[bId] : undefined;

  if (!e.configured) return <div className="page page-narrow"><div className="panel empty">Battles need the live backend. See the banner above.</div></div>;

  const coins = Object.values(e.tokens)
    .filter((t) => q === '' || t.ticker.toLowerCase().includes(q.toLowerCase()) || t.name.toLowerCase().includes(q.toLowerCase()) || t.mint === q.trim())
    .sort((x, y) => Number(busy(x.id)) - Number(busy(y.id)) || (e.markets[y.id]?.liquidityUsd ?? 0) - (e.markets[x.id]?.liquidityUsd ?? 0));

  const pick = (id: string) => {
    if (id === aId) return setAId(undefined);
    if (id === bId) return setBId(undefined);
    if (!aId) setAId(id); else if (!bId) setBId(id); else setBId(id);
  };

  const setPart = (k: keyof typeof pcts, raw: string) => {
    const v = Math.max(0, Math.min(100, Math.round(Number(raw.replace(/[^0-9.]/g, '')) || 0)));
    setPcts({ ...pcts, [k]: v });
  };
  const fixTotal = () => setPcts({ ...pcts, platform: Math.max(0, 100 - pcts.winnerLiquidity - pcts.holderRewards) });

  const canNext = [!!A && !!B && A.id !== B.id, splitOk, agree][step];

  const start = async () => {
    if (!A || !B) return;
    if (!(await ui.requireSignIn())) return;
    setSending(true);
    try {
      const id = await e.createBattle(A.id, B.id, rules, Date.now() + startIn);
      ui.toast({ title: `⚔️ $${A.ticker} vs $${B.ticker} created`, body: startIn ? 'It starts at the chosen time.' : 'It goes live within a minute. Anyone can join by buying a side.', tone: 'good' });
      nav(`/battle/${id}`);
    } catch (err) {
      ui.toast({ title: 'Battle not created', body: (err as Error).message, tone: 'bad' });
    } finally {
      setSending(false);
    }
  };

  const Slot = ({ t, label }: { t?: typeof A; label: string }) => (
    <div className="matchup-side" style={sideStyle(t?.hue ?? 220)}>
      {t ? <><TokenLogo token={t} size={46} /><div><b>${t.ticker}</b><div className="dim" style={{ fontSize: 12 }}>{usd(e.markets[t.id]?.mcapUsd)} mkt cap</div></div></> : <span className="dim">{label}</span>}
    </div>
  );

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title">⚔️ Start a battle</h1>
          <div className="page-sub">Pick any two coins. The battle goes live right away (no one has to accept) and anyone can join by buying the side they back.</div>
        </div>
      </div>

      <div className="stepper">
        {STEPS.map((s, i) => (
          <button key={s} className={`step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`} disabled={i > step} onClick={() => setStep(i)}>
            <span className="step-n">{i < step ? '✓' : i + 1}</span><span className="step-l">{s}</span>
          </button>
        ))}
      </div>

      <div className="matchup panel">
        <Slot t={A} label="Coin 1" />
        <div className="matchup-vs">VS</div>
        <Slot t={B} label="Coin 2" />
      </div>

      <div className="panel panel-pad wizard">
        {step === 0 && (
          <>
            <h3 className="wiz-title">Step 1 · Pick two coins</h3>
            <p className="muted" style={{ marginTop: 0 }}>Tap two coins. Coins already in a battle can't be picked until it ends.</p>
            <input className="input" placeholder="Search by name, ticker or mint address…" value={q} onChange={(ev) => setQ(ev.target.value)} style={{ marginBottom: 12 }} />
            {coins.length === 0 && <div className="empty">No coins match.</div>}
            <div className="pick-grid">
              {coins.slice(0, 60).map((t) => {
                const m = e.markets[t.id];
                const b = busy(t.id);
                const sel = t.id === aId ? 1 : t.id === bId ? 2 : 0;
                return (
                  <button key={t.id} className={`pick ${sel ? 'active' : ''}`} style={sideStyle(t.hue)} onClick={() => pick(t.id)} disabled={b && !sel}>
                    <TokenLogo token={t} size={40} />
                    <div style={{ textAlign: 'left', minWidth: 0 }} className="grow">
                      <div className="row" style={{ gap: 6 }}><b>${t.ticker}</b>{isAutoListed(t) && <span className="pill" style={{ height: 18, fontSize: 9 }}>pump.fun</span>}{sel > 0 && <span className="pill pill-up" style={{ height: 18, fontSize: 9 }}>Coin {sel}</span>}</div>
                      <div className="muted mono" style={{ fontSize: 11.5 }}>{usd(m?.mcapUsd)} mcap · {usd(m?.liquidityUsd)} liq.{m?.change24 != null && <> · <span className={m.change24 >= 0 ? 'up' : 'down'}>{pct(m.change24)}</span></>}</div>
                      {b && <div className="warn" style={{ fontSize: 11 }}>In a battle now</div>}
                    </div>
                  </button>
                );
              })}
            </div>
            {coins.length > 60 && <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>Showing 60 of {coins.length}. Search to find others.</div>}
          </>
        )}

        {step === 1 && (
          <>
            <h3 className="wiz-title">Step 2 · How long, and who gets the prize pot</h3>
            <div className="field"><label>Battle length (minimum)</label>
              <div className="dur-grid">
                {DURATIONS.map((d) => <button key={d.ms} className={`chip ${minMs === d.ms ? 'active' : ''}`} onClick={() => setMinMs(d.ms)}>{d.label}</button>)}
              </div>
              <span className="dim" style={{ fontSize: 12.5 }}>
                The battle runs at least <b>{duration(rules.randomEnd.minDurationMs)}</b>. After that it can end at any moment (a fair public random draw), usually around <b>{duration(medianEnd(rules))}</b> in total and never later than {duration(rules.randomEnd.maxDurationMs)}.
              </span>
            </div>
            <div className="field" style={{ marginTop: 16 }}><label>Ending style</label>
              <div className="grid grid-3">
                {(Object.keys(BATTLE_TYPES) as BattleType[]).map((k) => (
                  <button key={k} className={`pick col ${type === k ? 'active' : ''}`} style={{ alignItems: 'flex-start' }} onClick={() => setType(k)}>
                    <b>{BATTLE_TYPES[k].label}</b>
                    <span className="muted" style={{ fontSize: 12, textAlign: 'left' }}>{BATTLE_TYPES[k].blurb}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="field" style={{ marginTop: 16 }}><label>Start</label>
              <div className="seg" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
                {START_OPTIONS.map((o) => <button key={o.k} className={startIn === o.ms ? 'active' : ''} onClick={() => setStartIn(o.ms)}>{o.k}</button>)}
              </div>
            </div>

            <div className="field" style={{ marginTop: 20 }}>
              <label>Prize pot split (type a number or drag)</label>
              <p className="dim" style={{ margin: '0 0 6px', fontSize: 12.5 }}>The prize pot is BATTLE's trading fee on trades made through this site during the battle. Default is 50 / 25 / 25.</p>
              {PARTS.map(([k, l, d]) => (
                <div key={k} className="split-edit">
                  <div className="grow"><b>{l}</b><div className="dim" style={{ fontSize: 12 }}>{d}</div></div>
                  <input type="range" min={0} max={100} step={1} value={pcts[k]} onChange={(ev) => setPart(k, ev.target.value)} aria-label={`${l} slider`} />
                  <div className="pct-input">
                    <input className="input mono" inputMode="numeric" value={String(pcts[k])} onChange={(ev) => setPart(k, ev.target.value)} aria-label={`${l} percent`} />
                    <span>%</span>
                  </div>
                </div>
              ))}
              <div className="spread" style={{ marginTop: 8 }}>
                <span className={splitOk ? 'up' : 'down'} style={{ fontWeight: 700 }}>Total: {total}% {splitOk ? '✓' : '(must be exactly 100%)'}</span>
                <div className="row" style={{ gap: 8 }}>
                  {!splitOk && <button className="btn btn-sm" onClick={fixTotal}>Make it 100%</button>}
                  <button className="btn btn-sm" onClick={() => setPcts({ winnerLiquidity: 50, holderRewards: 25, platform: 25 })}>Reset</button>
                </div>
              </div>
              {splitOk && <div style={{ marginTop: 12 }}><RewardSplitBar rules={rules} /></div>}
            </div>
          </>
        )}

        {step === 2 && A && B && (
          <>
            <h3 className="wiz-title">Step 3 · Review and start</h3>
            <div className="review-list">
              <div><span>Battle</span><b>${A.ticker} vs ${B.ticker}</b></div>
              <div><span>Starts</span><b>{startIn ? START_OPTIONS.find((o) => o.ms === startIn)?.k : 'Right away (within a minute)'}</b></div>
              <div><span>Length</span><b>At least {duration(rules.randomEnd.minDurationMs)}, then a surprise ending</b></div>
              <div><span>How the winner is picked</span><b>Higher Battle Score when it ends: 60% price performance, 20% new holders, 20% healthy trading</b></div>
              <div><span>Prize pot split</span><b>{pcts.winnerLiquidity}% winner · {pcts.holderRewards}% holders · {pcts.platform}% platform</b></div>
              <div><span>Who can join</span><b>Anyone: buy either coin to back that side</b></div>
            </div>
            <details className="rules-details" style={{ marginTop: 14 }}>
              <summary>📜 Full rules (for the curious)</summary>
              <div style={{ marginTop: 14 }}><RulesContent rules={rules} a={A} b={B} /></div>
            </details>
            <label className="check" style={{ marginTop: 14 }}>
              <input type="checkbox" checked={agree} onChange={(ev) => setAgree(ev.target.checked)} />
              <span>I understand these rules lock when the battle starts, and nobody (including me) can change them or choose when it ends.</span>
            </label>
          </>
        )}

        <div className="spread wizard-nav">
          <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>← Back</button>
          {step < 2 && <button className="btn btn-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Continue →</button>}
          {step === 2 && <button className="btn btn-battle btn-lg" disabled={!canNext || sending} onClick={start}>{sending ? 'Starting…' : '⚔️ Start battle'}</button>}
        </div>
      </div>
    </div>
  );
}

/** Old challenge links: challenges no longer exist, so send people to the battle itself. */
export function ChallengePage() {
  const { id } = useParams();
  useEffect(() => { window.scrollTo(0, 0); }, []);
  return <Navigate to={id ? `/battle/${id}` : '/'} replace />;
}
