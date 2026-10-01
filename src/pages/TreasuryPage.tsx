import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../data/DataContext';
import { TREASURY_FEE_SHARE } from '../sim/engine';
import { quoteToUsd, usd } from '../lib/format';
import { SimPill, TokenLogo } from '../components/ui';
import { TREASURY_COLORS, TreasuryEventRow } from '../components/Treasury';

function GrowthChart({ points, now }: { points: { t: number; cumulative: number }[]; now: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 800, H = 240, padL = 8, padR = 70, padT = 14, padB = 24;
  if (points.length < 2) return null;
  const pts = [...points, { t: now, cumulative: points.at(-1)!.cumulative }];
  const t0 = pts[0].t, t1 = now;
  const max = Math.max(...pts.map((p) => p.cumulative)) * 1.08;
  const X = (t: number) => padL + ((t - t0) / (t1 - t0)) * (W - padL - padR);
  const Y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.cumulative).toFixed(1)}`).join('');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const days = Math.round((t1 - t0) / 86_400_000);
  const hp = hover !== null ? pts.reduce((b, p) => (Math.abs(X(p.t) - hover) < Math.abs(X(b.t) - hover) ? p : b), pts[0]) : null;
  return (
    <div className="tre-chart" onMouseLeave={() => setHover(null)}
      onMouseMove={(ev) => { const r = ev.currentTarget.getBoundingClientRect(); setHover(((ev.clientX - r.left) / r.width) * W); }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: H, display: 'block' }}>
        <defs>
          <linearGradient id="treg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#2ee6a0" stopOpacity="0.35" /><stop offset="1" stopColor="#2ee6a0" stopOpacity="0" /></linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={Y(v)} y2={Y(v)} stroke="rgba(255,255,255,0.06)" vectorEffect="non-scaling-stroke" />
            <text x={W - padR + 6} y={Y(v) + 4} fill="rgba(180,188,203,0.7)" fontSize="11" fontFamily="JetBrains Mono, monospace">{usd(quoteToUsd(v))}</text>
          </g>
        ))}
        <path d={`${d}L${X(t1)},${Y(0)}L${X(t0)},${Y(0)}Z`} fill="url(#treg)" />
        <path d={d} fill="none" stroke="#2ee6a0" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <circle cx={X(t1)} cy={Y(pts.at(-1)!.cumulative)} r="4" fill="#2ee6a0" />
        {hp && <line x1={X(hp.t)} x2={X(hp.t)} y1={padT} y2={H - padB} stroke="rgba(255,255,255,0.25)" vectorEffect="non-scaling-stroke" />}
        <text x={padL} y={H - 6} fill="rgba(180,188,203,0.6)" fontSize="11" fontFamily="JetBrains Mono, monospace">{days}d ago</text>
        <text x={W - padR - 30} y={H - 6} fill="rgba(180,188,203,0.6)" fontSize="11" fontFamily="JetBrains Mono, monospace">now</text>
      </svg>
      {hp && <div className="chart-tip" style={{ left: `min(calc(${(X(hp.t) / W) * 100}% + 12px), calc(100% - 170px))` }}><div className="dim mono">{new Date(hp.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div><div className="mono up">{usd(quoteToUsd(hp.cumulative), { compact: false, decimals: 0 })}</div><div className="dim" style={{ fontSize: 11 }}>cumulative distributed</div></div>}
    </div>
  );
}

export function TreasuryPage() {
  const e = useData();
  const g = e.treasury;
  const distributed = e.distributedTotal();
  const locked = e.lockedTotal();
  const liveTreasuries = e.battles
    .filter((b) => b.status === 'live' || b.status === 'scheduled')
    .sort((a, b) => e.treasuryBalance(b) - e.treasuryBalance(a))
    .slice(0, 8);
  const tiles: [string, number, string, string][] = [
    ['Total platform treasury', g.platformQuote, 'Platform / ecosystem allocations received', TREASURY_COLORS.platform],
    ['Battle rewards distributed', distributed, 'Winner support + holder rewards + platform + tournament prizes', TREASURY_COLORS.fees],
    ['Holder rewards distributed', g.holderRewardsQuote, 'Paid to eligible Battle Loyalty holders', TREASURY_COLORS.holders],
    ['Liquidity support', g.winnerSupportQuote, 'Added to winning tokens’ pools', TREASURY_COLORS.winner],
    ['Tournament prizes', g.tournamentPrizesQuote, 'Paid out to completed brackets', TREASURY_COLORS.tournament],
    ['Locked in live treasuries', locked, 'Live and scheduled battles, not yet distributed', TREASURY_COLORS.fund],
  ];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">🏛 Treasury</h1>
          <div className="page-sub">Every battle has its own treasury, funded before it starts and topped up by {TREASURY_FEE_SHARE * 100}% of swap fees while live. When a battle ends, its locked split pays out. Every movement is listed here.</div>
        </div>
        <SimPill text="Simulated treasury data" />
      </div>

      <div className="tre-tiles">
        {tiles.map(([l, v, sub, c]) => (
          <div key={l} className="panel panel-pad tre-tile" style={{ '--c': c } as React.CSSProperties}>
            <span className="stat-l">{l}</span>
            <span className="tre-tile-v mono">{usd(quoteToUsd(v))}</span>
            <span className="dim" style={{ fontSize: 11.5 }}>{sub}</span>
          </div>
        ))}
      </div>

      <div className="tre-grid">
        <div className="col" style={{ gap: 14, minWidth: 0 }}>
          <div className="panel">
            <div className="panel-head"><span className="panel-title">📈 Historical treasury growth</span><span className="dim" style={{ fontSize: 11.5 }}>Cumulative value distributed</span></div>
            <div className="panel-pad"><GrowthChart points={g.growth} now={e.now} /></div>
          </div>
          <div className="panel">
            <div className="panel-head"><span className="panel-title">💰 Largest live treasuries</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Battle</th><th className="num">Balance</th><th className="num hide-mobile">Fees</th><th className="num hide-mobile">Winner</th><th className="num hide-mobile">Holders</th><th>Status</th></tr></thead>
                <tbody>
                  {liveTreasuries.map((b) => {
                    const bal = e.treasuryBalance(b);
                    const ta = e.tokens[b.a.tokenId];
                    const tb = e.tokens[b.b.tokenId];
                    return (
                      <tr key={b.id}>
                        <td><Link to={`/battle/${b.id}`} className="row" style={{ gap: 6 }}><span className="dim mono">#{b.number}</span><TokenLogo token={ta} size={20} /><b>{ta.ticker}</b><span className="dim">vs</span><TokenLogo token={tb} size={20} /><b>{tb.ticker}</b></Link></td>
                        <td className="num">{usd(quoteToUsd(bal))}</td>
                        <td className="num up hide-mobile">+{usd(quoteToUsd(b.treasury.feesQuote))}</td>
                        <td className="num hide-mobile">{usd(quoteToUsd(bal * b.rules.rewardSplit.winnerLiquidity))}</td>
                        <td className="num hide-mobile">{usd(quoteToUsd(bal * b.rules.rewardSplit.holderRewards))}</td>
                        <td>{b.status === 'live' ? <span className="pill pill-live">Live</span> : <span className="pill pill-upcoming">Locked</span>}</td>
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
            {g.events.slice(0, 60).map((ev) => <TreasuryEventRow key={ev.id} ev={ev} now={e.now} showLink />)}
          </div>
        </div>
      </div>
      <p className="dim" style={{ fontSize: 12, marginTop: 14 }}>All treasury values are simulated in this prototype. In production each battle treasury is an on-chain account and these figures come from its transaction history.</p>
    </div>
  );
}
