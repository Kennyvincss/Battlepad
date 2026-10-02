import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SwapRecord } from '../data/types';
import { useData } from '../data/DataContext';
import { config, treasuryEnabled } from '../live/config';
import { short, sol, solscanAccount, usd } from '../lib/format';
import { TokenLogo } from '../components/ui';
import { useUi } from '../components/AppState';
import { SwapFeeRow, TREASURY_COLORS } from '../components/Treasury';

function GrowthChart({ swaps, solUsd }: { swaps: SwapRecord[]; solUsd: number | null }) {
  const W = 800, H = 220, padL = 8, padR = 80, padT = 14, padB = 24;
  const pts = [...swaps].sort((a, b) => a.t - b.t);
  if (pts.length < 2) return <div className="empty">Growth appears after the first fees are collected.</div>;
  let cum = 0;
  const series = pts.map((s) => ({ t: s.t, v: (cum += s.feeSol) * (solUsd ?? 1) }));
  const t0 = series[0].t, t1 = Math.max(series.at(-1)!.t, Date.now());
  const max = series.at(-1)!.v * 1.1 || 1;
  const X = (t: number) => padL + ((t - t0) / (t1 - t0 || 1)) * (W - padL - padR);
  const Y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const d = series.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const fmt = (v: number) => (solUsd ? usd(v) : sol(v, 3));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: H, display: 'block' }}>
      <defs><linearGradient id="treg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#059669" stopOpacity="0.35" /><stop offset="1" stopColor="#059669" stopOpacity="0" /></linearGradient></defs>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={padL} x2={W - padR} y1={Y(f * max)} y2={Y(f * max)} stroke="rgba(15,23,42,0.051)" vectorEffect="non-scaling-stroke" />
          <text x={W - padR + 6} y={Y(f * max) + 4} fill="rgba(71,85,105,0.7)" fontSize="11" fontFamily="JetBrains Mono, monospace">{fmt(f * max)}</text>
        </g>
      ))}
      <path d={`${d}L${X(series.at(-1)!.t)},${Y(0)}L${X(t0)},${Y(0)}Z`} fill="url(#treg)" />
      <path d={d} fill="none" stroke="#059669" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <text x={padL} y={H - 6} fill="rgba(71,85,105,0.6)" fontSize="11" fontFamily="JetBrains Mono, monospace">{new Date(t0).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</text>
      <text x={W - padR - 30} y={H - 6} fill="rgba(71,85,105,0.6)" fontSize="11" fontFamily="JetBrains Mono, monospace">now</text>
    </svg>
  );
}

/** Helps the operator create the wrapped-SOL account that receives the swap fee. */
function FeeSetup() {
  const e = useData();
  const ui = useUi();
  const [st, setSt] = useState<{ address: string; exists: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  useEffect(() => {
    setErr(undefined);
    void e.feeAccountStatus().then(setSt).catch((x) => { setSt(null); setErr(`Could not check the fee account: ${(x as Error).message}. Check VITE_SOLANA_RPC_URL.`); });
  }, [e, e.wallet.address]);
  const create = async () => {
    setBusy(true);
    try {
      const address = await e.createFeeAccount();
      setSt({ address, exists: true });
      ui.toast({ title: 'Fee account ready', body: 'Copy the address into VITE_FEE_ACCOUNT and FEE_ACCOUNT.', tone: 'good' });
    } catch (err) {
      ui.toast({ title: 'Could not create fee account', body: (err as Error).message, tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel panel-pad col" style={{ gap: 10, marginBottom: 14 }}>
      <b>Set up the treasury fee (operator)</b>
      <span className="muted" style={{ fontSize: 12.5 }}>Fees are paid into a wrapped-SOL token account owned by your treasury wallet. Connect that wallet, create the account (about 0.002 SOL rent, one time), then set <code>VITE_PLATFORM_FEE_BPS</code> and <code>VITE_FEE_ACCOUNT</code> in Vercel and <code>FEE_ACCOUNT</code> in Supabase secrets.</span>
      {!e.wallet.connected && <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => ui.openWallet()}>Connect treasury wallet</button>}
      {err && <span className="down" style={{ fontSize: 12 }}>{err}</span>}
      {st && (
        <div className="row wrap" style={{ gap: 10 }}>
          <span className="hash">{st.address}</span>
          {st.exists
            ? <><span className="up" style={{ fontSize: 12 }}>✓ exists</span><button className="btn btn-sm" onClick={() => void navigator.clipboard?.writeText(st.address)}>Copy</button></>
            : <button className="btn btn-sm btn-primary" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create fee account'}</button>}
        </div>
      )}
    </div>
  );
}

export function TreasuryPage() {
  const e = useData();
  const [swaps, setSwaps] = useState<SwapRecord[] | null>(null);
  const [launches, setLaunches] = useState<{ feeUsd: number; feeSol: number; t: number }[] | null>(null);
  useEffect(() => {
    void e.loadTreasury().then((r) => setSwaps(r.swaps));
    void e.launchFees().then(setLaunches);
  }, [e]);
  const list = swaps ?? [];
  const total = list.reduce((s, x) => s + x.feeSol, 0);
  const toUsd = (v: number) => (e.solUsd !== null ? usd(v * e.solUsd) : sol(v, 3));
  const ended = new Set(e.battles.filter((b) => b.status === 'ended').map((b) => b.id));
  const settled = list.filter((s) => s.battleId && ended.has(s.battleId)).reduce((s, x) => s + x.feeSol, 0);
  const locked = total - settled;
  const sp = { w: 0.5, h: 0.25, p: 0.25 };
  const byBattle = new Map<string, number>();
  list.forEach((s) => s.battleId && byBattle.set(s.battleId, (byBattle.get(s.battleId) ?? 0) + s.feeSol));
  const top = [...byBattle.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const tiles: [string, number, string, string][] = [
    ['Total fees collected', total, 'Verified BATTLE swap fees across all battles', TREASURY_COLORS.fees],
    ['Allocated to winners', settled * sp.w, 'Liquidity support from ended battles (default 50%)', TREASURY_COLORS.winner],
    ['Allocated to holders', settled * sp.h, 'Battle Loyalty share of ended battles (default 25%)', TREASURY_COLORS.holders],
    ['Platform treasury', settled * sp.p, 'Platform / ecosystem share of ended battles (default 25%)', TREASURY_COLORS.platform],
    ['In live treasuries', locked, 'Collected in battles still running', TREASURY_COLORS.fund],
  ];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">🏛 Treasury</h1>
          <div className="page-sub">Battle treasuries are funded by BATTLE's swap fee on trades made through the app while a battle is live. Every fee is checked on-chain before it counts. When a battle ends, its locked split decides where its treasury goes.</div>
        </div>
        {config.feeAccount && <a className="pill" href={solscanAccount(config.feeAccount)} target="_blank" rel="noopener noreferrer">Fee account {short(config.feeAccount)} ↗</a>}
      </div>
      {!treasuryEnabled() && <div className="callout callout-warn" style={{ marginBottom: 14 }}><span>🚧</span><span>The treasury swap fee isn't enabled on this deployment (<code>VITE_PLATFORM_FEE_BPS</code> and <code>VITE_FEE_ACCOUNT</code>), so no fees are being collected yet.</span></div>}
      {!treasuryEnabled() && <FeeSetup />}
      <div className="callout callout-info" style={{ marginBottom: 14 }}><span>ℹ️</span><span>Allocations are per-battle splits of collected fees (shown here with the default 50/25/25). Payouts are made by the platform until the battle contract automates them.</span></div>

      <div className="tre-tiles">
        {tiles.map(([l, v, sub, c]) => (
          <div key={l} className="panel panel-pad tre-tile" style={{ '--c': c } as React.CSSProperties}>
            <span className="stat-l">{l}</span>
            <span className="tre-tile-v mono">{swaps === null ? '…' : toUsd(v)}</span>
            <span className="dim" style={{ fontSize: 11.5 }}>{sub}</span>
          </div>
        ))}
        {(config.launchFeeUsd > 0 || (launches ?? []).some((x) => x.feeUsd > 0)) && <div className="panel panel-pad tre-tile" style={{ '--c': TREASURY_COLORS.platform } as React.CSSProperties}>
          <span className="stat-l">Launch fees</span>
          <span className="tre-tile-v mono">{launches === null ? '…' : usd(launches.reduce((s, x) => s + x.feeUsd, 0), { compact: false })}</span>
          <span className="dim" style={{ fontSize: 11.5 }}>{launches?.length ?? 0} tokens launched on BATTLE · platform revenue, separate from battle treasuries</span>
        </div>}
      </div>

      <div className="tre-grid">
        <div className="col" style={{ gap: 14, minWidth: 0 }}>
          <div className="panel">
            <div className="panel-head"><span className="panel-title">📈 Treasury growth</span><span className="dim" style={{ fontSize: 11.5 }}>Cumulative fees collected</span></div>
            <div className="panel-pad"><GrowthChart swaps={list} solUsd={e.solUsd} /></div>
          </div>
          <div className="panel">
            <div className="panel-head"><span className="panel-title">💰 Largest battle treasuries</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Battle</th><th className="num">Fees</th><th className="num hide-mobile">Winner</th><th className="num hide-mobile">Holders</th><th>Status</th></tr></thead>
                <tbody>
                  {top.length === 0 && <tr><td colSpan={5} className="empty">No treasury fees collected yet.</td></tr>}
                  {top.map(([id, fee]) => {
                    const b = e.getBattle(id);
                    if (!b) return null;
                    const ta = e.token(b.a.tokenId), tb = e.token(b.b.tokenId);
                    return (
                      <tr key={id}>
                        <td><Link to={`/battle/${id}`} className="row" style={{ gap: 6 }}><span className="dim mono">#{b.number}</span>{ta && <TokenLogo token={ta} size={20} />}<b>{ta?.ticker}</b><span className="dim">vs</span>{tb && <TokenLogo token={tb} size={20} />}<b>{tb?.ticker}</b></Link></td>
                        <td className="num">{toUsd(fee)}</td>
                        <td className="num hide-mobile">{toUsd(fee * b.rules.rewardSplit.winnerLiquidity)}</td>
                        <td className="num hide-mobile">{toUsd(fee * b.rules.rewardSplit.holderRewards)}</td>
                        <td>{b.status === 'live' ? <span className="pill pill-live">Live</span> : <span className="pill pill-ended">Ended</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><span className="panel-title">🧾 Recent treasury activity</span></div>
          <div className="panel-pad tre-list" style={{ maxHeight: 640, overflow: 'auto' }}>
            {swaps === null && <div className="empty">Loading…</div>}
            {swaps?.length === 0 && <div className="empty">No fees collected yet.</div>}
            {list.slice(0, 60).map((s) => <SwapFeeRow key={s.tx} s={s} now={e.now} solUsd={e.solUsd} showBattle />)}
          </div>
        </div>
      </div>
    </div>
  );
}
