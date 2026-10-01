import { Link } from 'react-router-dom';
import type { Battle, BattleDetail, SwapRecord } from '../data/types';
import { useData } from '../data/DataContext';
import { config, treasuryEnabled } from '../live/config';
import { ago, short, sol, solscanTx, usd } from '../lib/format';
import { Sparkline } from './ui';

export const TREASURY_COLORS = { fees: '#2ee6a0', winner: '#39e3ff', holders: '#ffcf5a', platform: '#8b7bff', tournament: '#ff7a3d', fund: '#6aa8ff' } as const;

export function SwapFeeRow({ s, now, solUsd, showBattle }: { s: SwapRecord; now: number; solUsd: number | null; showBattle?: boolean }) {
  const e = useData();
  const t = e.tokens[s.tokenId];
  const b = s.battleId ? e.getBattle(s.battleId) : undefined;
  return (
    <a className="tre-row" href={solscanTx(s.tx)} target="_blank" rel="noopener noreferrer">
      <span className="tre-ico" style={{ color: TREASURY_COLORS.fees, borderColor: TREASURY_COLORS.fees }}>➕</span>
      <span className="grow tre-text">
        Fee from {s.side} of ${t?.ticker ?? '?'} by {short(s.wallet)}{showBattle && b && <> · battle #{b.number}</>}
      </span>
      <span className="mono tre-amt" style={{ color: TREASURY_COLORS.fees }}>+{solUsd ? usd(s.feeSol * solUsd, { compact: false }) : sol(s.feeSol, 5)}</span>
      <span className="mono dim tre-ago">{ago(now - s.t)}</span>
    </a>
  );
}

/** Per-battle treasury: verified BATTLE swap fees collected during the battle, split by the locked rules. */
export function BattleTreasuryCard({ battle, detail }: { battle: Battle; detail?: BattleDetail }) {
  const e = useData();
  const swaps = (detail?.swaps ?? []).filter((s) => s.verified).sort((a, b) => a.t - b.t);
  const feesSol = swaps.reduce((s, x) => s + x.feeSol, 0);
  const balUsd = e.solUsd !== null ? feesSol * e.solUsd : null;
  const sp = battle.rules.rewardSplit;
  const rows = [
    { k: 'Winner Support', v: sp.winnerLiquidity, c: TREASURY_COLORS.winner },
    { k: 'Holder Rewards', v: sp.holderRewards, c: TREASURY_COLORS.holders },
    { k: 'Platform', v: sp.platform, c: TREASURY_COLORS.platform },
  ];
  let run = 0;
  const growth = swaps.map((s) => (run += s.feeSol));
  return (
    <div className="panel treasury-card">
      <div className="panel-head">
        <span className="panel-title">🏛 Battle Treasury</span>
        <span className="dim" style={{ fontSize: 11 }}>On-chain verified</span>
      </div>
      <div className="panel-pad col" style={{ gap: 14 }}>
        {!treasuryEnabled() ? (
          <div className="callout callout-warn"><span>🚧</span><span>The swap fee that funds battle treasuries isn't enabled on this deployment yet, so this treasury is empty. The split below is still locked into the battle rules.</span></div>
        ) : (
          <div className="spread" style={{ alignItems: 'flex-end' }}>
            <div>
              <div className="label">{battle.status === 'ended' ? 'Final treasury' : 'Current balance'}</div>
              <div className="tre-balance mono">{balUsd !== null ? usd(balUsd, { compact: false, decimals: 2 }) : sol(feesSol, 4)}</div>
              <div className="muted mono" style={{ fontSize: 12 }}>{sol(feesSol, 4)} · {(config.feeBps / 100).toFixed(2)}% of swaps made through BATTLE</div>
            </div>
            {growth.length > 1 && <Sparkline points={growth} color={TREASURY_COLORS.fees} width={110} height={40} />}
          </div>
        )}
        <div className="tre-split">
          {rows.map((r) => (
            <div key={r.k} className="tre-split-row">
              <span className="split-dot" style={{ background: r.c }} />
              <span className="grow">{r.k} <span className="dim">{Math.round(r.v * 100)}%</span></span>
              <span className="mono" style={{ fontWeight: 700 }}>{balUsd !== null ? usd(balUsd * r.v, { compact: false }) : '—'}</span>
            </div>
          ))}
        </div>
        {swaps.length > 0 && (
          <div>
            <div className="label" style={{ marginBottom: 6 }}>Recent treasury activity</div>
            <div className="tre-list">{[...swaps].reverse().slice(0, 5).map((s) => <SwapFeeRow key={s.tx} s={s} now={e.now} solUsd={e.solUsd} />)}</div>
          </div>
        )}
        <div className="dim" style={{ fontSize: 11.5 }}>
          Payouts are made by the platform from the tracked allocation until the battle contract automates them. <Link to="/treasury" className="link">Platform treasury →</Link>
        </div>
      </div>
    </div>
  );
}
