import { useState } from 'react';
import type { Battle, BattleRules, IntegrityEvent, Token } from '../data/types';
import { useData } from '../data/DataContext';
import { duration, pct, quoteToUsd, sol, usd } from '../lib/format';
import { BATTLE_TYPES, medianEnd, survivalAt } from '../lib/rules';
import { verifyCheck } from '../lib/randomEnd';
import { battleIntegrity } from '../lib/view';
import { InfoButton, Modal, SimPill, TokenLogo, sideColor } from './ui';

/* =================================================================== RULES */

export function RewardSplitBar({ rules, compact }: { rules: BattleRules; compact?: boolean }) {
  const s = rules.rewardSplit;
  const parts = [
    { k: 'Winner liquidity support', v: s.winnerLiquidity, c: '#39e3ff' },
    { k: 'Eligible holder rewards', v: s.holderRewards, c: '#ffcf5a' },
    { k: 'Platform / ecosystem', v: s.platform, c: '#8b7bff' },
  ];
  return (
    <div>
      <div className="split-bar">
        {parts.map((p) => <div key={p.k} style={{ width: `${p.v * 100}%`, background: p.c }} title={`${p.k}: ${Math.round(p.v * 100)}%`} />)}
      </div>
      <div className={compact ? 'row wrap' : 'grid grid-3'} style={{ marginTop: 10, gap: compact ? 12 : 10 }}>
        {parts.map((p) => (
          <div key={p.k} className="split-leg">
            <span className="split-dot" style={{ background: p.c }} />
            <div>
              <div className="mono" style={{ fontWeight: 700 }}>{Math.round(p.v * 100)}% <span className="muted" style={{ fontWeight: 400 }}>· {sol(rules.rewardPoolQuote * p.v, 1)}</span></div>
              <div className="muted" style={{ fontSize: 12 }}>{p.k}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RulesContent({ rules, battle, a, b }: { rules: BattleRules; battle?: Battle; a?: Token; b?: Token }) {
  const r = rules.randomEnd;
  const t = BATTLE_TYPES[rules.type];
  const odds = [1, 1.25, 1.5, 2, 2.5, 3, 4].map((h) => ({ h, p: survivalAt(rules, h * 3_600_000) }));
  return (
    <div className="rules">
      <div className="callout callout-good">
        <span>🔒</span>
        <span>
          <b>These rules are fixed before the battle starts and cannot be changed once it begins.</b> They are hashed into a public commitment
          {battle && <> (<span className="hash">{battle.commitment.rulesHash.slice(0, 24)}…</span>)</>} that anyone can check.
        </span>
      </div>

      <h4>1 · Duration & random end</h4>
      <div className="grid grid-3 rules-stats">
        <div className="stat"><span className="stat-v">{duration(r.minDurationMs)}</span><span className="stat-l">Minimum battle time</span></div>
        <div className="stat"><span className="stat-v">{(r.hazardPerEpoch * 100).toFixed(2)}%</span><span className="stat-l">End chance per {duration(r.epochMs, true).replace(' 00s', '')} check</span></div>
        <div className="stat"><span className="stat-v">{duration(r.maxDurationMs)}</span><span className="stat-l">Hard safety cap</span></div>
      </div>
      <p style={{ marginTop: 12 }}>
        Battle type <b>{t.label}</b>. There is <b>no countdown</b>. The battle cannot end before {duration(r.minDurationMs)}. After that, a check runs every {Math.round(r.epochMs / 1000)}s and the battle
        ends the first time a check succeeds. Nobody knows in advance when that will be — median end ≈ <b>{duration(medianEnd(rules))}</b>.
      </p>
      <div className="odds">
        {odds.map((o) => (
          <div key={o.h} className="odds-cell">
            <div className="odds-bar"><div style={{ height: `${o.p * 100}%` }} /></div>
            <div className="mono" style={{ fontSize: 11 }}>{(o.p * 100).toFixed(0)}%</div>
            <div className="dim" style={{ fontSize: 10.5 }}>{o.h}h</div>
          </div>
        ))}
      </div>
      <div className="dim" style={{ fontSize: 11.5, marginTop: 4 }}>Probability the battle is still live at each elapsed time (published odds, not a timer).</div>

      <h4>2 · How the random end is verifiable</h4>
      <ol className="steps">
        <li>Before start, the battle id and a hash of every rule on this page are published (the <b>commitment</b>).</li>
        <li>At each check after the minimum, the system takes the first <b>public randomness beacon</b> round ({r.beacon}) published <i>after</i> the check time. No creator, trader or the platform can know or pick it in advance.</li>
        <li><span className="mono">value = sha256(battleId | rulesHash | beaconRandomness)</span> mapped to [0, 1).</li>
        <li>If <span className="mono">value &lt; {r.hazardPerEpoch.toFixed(5)}</span> the battle ends at that check. Every check — including the ones that didn't end it — is logged publicly so anyone can recompute it.</li>
      </ol>

      <h4>3 · Battle Score formula</h4>
      <div className="formula">{`SCORE = ${rules.weights.performance * 100}% × Performance
      + ${rules.weights.holderGrowth * 100}% × Holder Growth
      + ${rules.weights.marketQuality * 100}% × Market Quality

Performance    R = (1/T)·∫ ln(price(t) / price_start) dt     (time-weighted)
               P_A = 100 · e^(${rules.perfSteepness}·R_A) / (e^(${rules.perfSteepness}·R_A) + e^(${rules.perfSteepness}·R_B))
Holder Growth  g = eligible_holders / holders_at_start − 1
               H_A = 100 · e^(${rules.holderSteepness}·g_A) / (e^(${rules.holderSteepness}·g_A) + e^(${rules.holderSteepness}·g_B))
Market Quality Q = 100 · mean(Distribution, Organic flow, Liquidity)
               Distribution  = 1 − top-10 wallets' share of battle buys
               Organic flow  = 1 − flagged volume / battle volume
               Liquidity     = min(1, liquidity_now / liquidity_start)`}</div>
      <ul className="bullets">
        <li><b>Time-weighted:</b> every second of the battle counts equally, so a single last-minute pump or dump barely moves the score.</li>
        <li><b>Relative to the battle-start snapshot</b> — both tokens start the battle on identical footing (0% performance, 50/50 sub-scores) regardless of market cap.</li>
        <li><b>Raw trading volume is not a scoring input.</b> Volume is easy to fake, so it can only hurt a token (via the Organic flow term), never help it.</li>
        <li>An eligible holder holds ≥ {rules.minHolderQuote} SOL of the token and is not part of a flagged wallet cluster.</li>
        <li>The higher score at the random end wins. A tie is broken by the higher time-weighted return.</li>
      </ul>

      <h4>4 · Rewards</h4>
      <p>A <b>{sol(rules.rewardPoolQuote, 0)}</b> (≈ {usd(quoteToUsd(rules.rewardPoolQuote))}) Battle Reward Pool is funded and locked before start, then split:</p>
      <RewardSplitBar rules={rules} />
      <div className="formula" style={{ marginTop: 12 }}>{`BATTLE LOYALTY (holders of the winning token)
weight  = ∫ position_value(t) dt over the battle  ×  HoldFactor
HoldFactor = 1.0  still holding ≥ 50% of your peak position at the end
           = 0.5  sold below 50% of peak before the end
           = 0    fully sold before the end
your share = weight / Σ weights of all eligible holders`}</div>
      <ul className="bullets">
        <li>Rewards weigh <b>amount held</b>, <b>time held</b>, and <b>whether you sold</b> before the end.</li>
        <li>Wallets excluded by integrity rules are not eligible.</li>
        <li><b>Winning does not guarantee price appreciation.</b> Liquidity support deepens the pool; it does not set a price.</li>
      </ul>

      <h4>5 · Battle Integrity</h4>
      <IntegrityExplainer />

      <h4>6 · Always true on BATTLE</h4>
      <ul className="bullets">
        <li>You trade real tokens — you are not betting on the outcome. You can sell at any time.</li>
        <li>The losing token is not destroyed. It keeps trading normally after the battle.</li>
        <li>Communities may coordinate and support their token. Only manipulative or fake activity is excluded.</li>
        {a && b && <li>{a.logo} ${a.ticker} and {b.logo} ${b.ticker} entered under these identical conditions.</li>}
      </ul>
    </div>
  );
}

export function RulesModal({ battle, onClose }: { battle: Battle; onClose: () => void }) {
  const e = useData();
  return (
    <Modal title="📜 Battle Rules" onClose={onClose} wide>
      <RulesContent rules={battle.rules} battle={battle} a={e.tokens[battle.a.tokenId]} b={e.tokens[battle.b.tokenId]} />
    </Modal>
  );
}

/* =============================================================== INTEGRITY */

export function IntegrityExplainer() {
  return (
    <div className="col" style={{ gap: 10 }}>
      <p style={{ margin: 0 }}>The platform continuously monitors battle trading for activity that fakes demand rather than reflecting real holders:</p>
      <div className="grid grid-2" style={{ gap: 8 }}>
        {[
          ['🔁', 'Wash trading', 'Buying and selling with yourself to fake volume.'],
          ['🔄', 'Circular trading', 'Tokens passed around a ring of wallets.'],
          ['🕸', 'Coordinated wallet activity', 'Wallets acting as one bot, not as people.'],
          ['👥', 'Same-entity wallets', 'Many wallets funded from and controlled by one source.'],
          ['📈', 'Artificial volume', 'Volume with no change in real ownership.'],
          ['⏱', 'Abnormal synchronized trading', 'Trades on machine-exact cadence across fresh wallets.'],
        ].map(([i, t, d]) => (
          <div key={t} className="integ-item"><span>{i}</span><div><b>{t}</b><div className="muted" style={{ fontSize: 12 }}>{d}</div></div></div>
        ))}
      </div>
      <div className="callout callout-good">
        <span>✅</span>
        <span><b>Normal community buying is never blocked.</b> Hundreds of independent wallets rallying behind their token is legitimate collective participation and counts fully. Signals look at funding sources, wallet age, timing precision and round-trips — not at how many people buy.</span>
      </div>
      <div className="callout callout-info">
        <span>📋</span>
        <span>Flagged activity is <b>excluded from Holder Growth and Market Quality</b> per the published rules. Every exclusion is logged publicly with its reason. Results are never modified silently, and trades themselves are never reversed.</span>
      </div>
    </div>
  );
}

export function IntegrityPanel({ battle }: { battle: Battle }) {
  const e = useData();
  const [open, setOpen] = useState(false);
  const score = battle.status === 'ended' && battle.final ? Math.round((battle.final.integrityA + battle.final.integrityB) / 2) : battleIntegrity(battle);
  const events: IntegrityEvent[] = [...battle.integrity[battle.a.tokenId].events, ...battle.integrity[battle.b.tokenId].events].sort((x, y) => y.t - x.t);
  const tone = score >= 95 ? 'var(--up)' : score >= 85 ? 'var(--warn)' : 'var(--down)';
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">🛡️ Battle Integrity <InfoButton onClick={() => setOpen(true)} label="What is monitored?" /></span>
        <SimPill />
      </div>
      <div className="panel-pad">
        <div className="row" style={{ gap: 16 }}>
          <div className="integ-ring" style={{ '--p': score, '--c': tone } as React.CSSProperties}>
            <span className="mono">{score}%</span>
          </div>
          <div className="grow col" style={{ gap: 4 }}>
            {[battle.a, battle.b].map((s) => {
              const t = e.tokens[s.tokenId];
              const ig = battle.integrity[s.tokenId];
              return (
                <div key={s.tokenId} className="spread" style={{ fontSize: 12.5 }}>
                  <span className="row" style={{ gap: 6 }}><TokenLogo token={t} size={16} />{t.ticker}</span>
                  <span className="mono">{ig.score}% organic · {ig.flaggedWallets.size} wallets excluded</span>
                </div>
              );
            })}
            <div className="dim" style={{ fontSize: 11.5 }}>Share of battle volume considered organic.</div>
          </div>
        </div>
        <div className="integ-log">
          {events.length === 0 && <div className="dim" style={{ fontSize: 12.5, padding: '10px 0' }}>No integrity events yet.</div>}
          {events.slice(0, 6).map((ev) => (
            <div key={ev.id} className={`integ-ev ${ev.severity}`}>
              <div className="spread">
                <b style={{ fontSize: 12.5 }}>{ev.severity === 'alert' ? '⚠️ ' : '✅ '}{ev.title}</b>
                <span className="dim mono" style={{ fontSize: 11 }}>T+{duration(ev.t - (battle.startedAt ?? 0))}</span>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>{ev.detail}</div>
            </div>
          ))}
        </div>
      </div>
      {open && <Modal title="🛡️ Battle Integrity" onClose={() => setOpen(false)}><IntegrityExplainer /></Modal>}
    </div>
  );
}

export function IntegrityAlertBanner({ ev, onDetails }: { ev: IntegrityEvent; onDetails: () => void }) {
  return (
    <div className="integ-alert">
      <span className="integ-alert-icon">⚠️</span>
      <div className="grow">
        <div style={{ fontWeight: 800, letterSpacing: '0.1em', fontSize: 12 }}>INTEGRITY ALERT</div>
        <div style={{ fontSize: 13 }}>Unusual coordinated trading activity detected. Affected activity may be excluded from Battle Score calculations according to the published battle rules.</div>
        <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>Latest: {ev.title} · {ev.wallets} wallets · {ev.excludedQuote.toFixed(1)} SOL excluded</div>
      </div>
      <button className="btn btn-sm" onClick={onDetails}>Details</button>
    </div>
  );
}

/* ============================================================= END PROOF */

export function EndProof({ battle }: { battle: Battle }) {
  const e = useData();
  const [verified, setVerified] = useState<null | { ok: number; total: number }>(null);
  const checks = [...battle.endChecks].reverse();
  const r = battle.rules.randomEnd;
  const elapsed = e.elapsed(battle);
  const verify = () => {
    const ok = battle.endChecks.filter((c) => verifyCheck(battle.id, battle.commitment.rulesHash, c)).length;
    setVerified({ ok, total: battle.endChecks.length });
  };
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">🎲 Random End — Proof Log</span>
        <SimPill text="Sim beacon" />
      </div>
      <div className="panel-pad">
        <div className="kv"><span>Battle id</span><span className="hash">{battle.id}</span></div>
        <div className="kv"><span>Rules commitment</span><span className="hash" title={battle.commitment.rulesHash}>{battle.commitment.rulesHash.slice(0, 20)}…</span></div>
        <div className="kv"><span>Start beacon round</span><span>#{battle.commitment.startRound.toLocaleString()}</span></div>
        <div className="kv"><span>End threshold / check</span><span>&lt; {r.hazardPerEpoch.toFixed(5)}</span></div>
        <div className="kv"><span>Checks run</span><span>{battle.endChecks.length}</span></div>
        {battle.status === 'live' && elapsed < r.minDurationMs && (
          <div className="callout" style={{ marginTop: 8 }}>🛡 <span>Protected phase. End checks begin after the {duration(r.minDurationMs)} minimum.</span></div>
        )}
        <div className="proof-log">
          {checks.slice(0, 40).map((c) => (
            <div key={c.index} className={`proof-row ${c.ended ? 'ended' : ''}`}>
              <span className="mono dim">#{c.index}</span>
              <span className="mono">{duration(c.at, true)}</span>
              <span className="mono dim" title={c.beaconRandomness}>r{c.beaconRound}</span>
              <span className="mono">{c.value.toFixed(4)}</span>
              <span className={`mono ${c.ended ? 'gold' : 'dim'}`}>{c.ended ? 'END ✓' : 'continue'}</span>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 10, gap: 10 }}>
          <button className="btn btn-sm" onClick={verify} disabled={!battle.endChecks.length}>Re-verify all checks</button>
          {verified && <span className={verified.ok === verified.total ? 'up' : 'down'} style={{ fontSize: 12.5 }}>{verified.ok}/{verified.total} checks recomputed ✓</span>}
        </div>
      </div>
    </div>
  );
}

/* ============================================================= LOYALTY */

export function LoyaltyCard({ battle }: { battle: Battle }) {
  const e = useData();
  const sides = [battle.a.tokenId, battle.b.tokenId].filter((t) => e.wallet.loyalty[`${battle.id}:${t}`] || (e.wallet.positions[t]?.amount ?? 0) > 0);
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">🎖 Your Battle Loyalty</span>
        <SimPill text="Simulated estimate" />
      </div>
      <div className="panel-pad">
        {!e.wallet.connected && <div className="muted" style={{ fontSize: 13 }}>Connect a wallet to see your loyalty position.</div>}
        {e.wallet.connected && sides.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Hold either token during the battle to accrue loyalty. If your token wins, you share the holder reward pool.</div>}
        {e.wallet.connected && sides.map((tid) => {
          const t = e.tokens[tid];
          const l = e.loyaltyFor(battle, tid);
          const isWinner = battle.winner === tid;
          const ended = battle.status === 'ended';
          return (
            <div key={tid} className="loyal" style={{ '--h': t.hue } as React.CSSProperties}>
              <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                <TokenLogo token={t} size={22} />
                <b style={{ color: sideColor(t.hue, 70) }}>{t.ticker} ARMY</b>
                {ended && (isWinner ? <span className="pill pill-gold">🏆 Winner</span> : <span className="pill">Lost</span>)}
              </div>
              <div className="grid grid-3" style={{ gap: 8 }}>
                <div className="stat"><span className="stat-l">Held</span><span className="mono" style={{ fontWeight: 700 }}>{usd(quoteToUsd(l.heldQuote), { compact: false })}</span></div>
                <div className="stat"><span className="stat-l">Hold duration</span><span className="mono" style={{ fontWeight: 700 }}>{duration(l.heldMs)}</span></div>
                <div className="stat"><span className="stat-l">{ended ? (isWinner ? 'Reward' : 'Reward') : 'Est. reward*'}</span>
                  <span className="mono" style={{ fontWeight: 700, color: ended && !isWinner ? 'var(--muted)' : 'var(--gold)' }}>
                    {ended && !isWinner ? '$0.00' : usd(quoteToUsd(l.estRewardQuote), { compact: false })}
                  </span>
                </div>
              </div>
              <div className="dim" style={{ fontSize: 11.5, marginTop: 8 }}>
                HoldFactor {l.factor.toFixed(1)} · pool share {pct(l.share, 3, false)}
                {!ended && <> · *only paid if {t.ticker} wins. Estimate moves with the battle and is not guaranteed.</>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
