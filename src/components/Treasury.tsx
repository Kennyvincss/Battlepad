import { Link } from 'react-router-dom';
import type { Battle, TreasuryEvent } from '../data/types';
import { useData } from '../data/DataContext';
import { TREASURY_FEE_SHARE } from '../sim/engine';
import { ago, quoteToUsd, sol, usd } from '../lib/format';
import { SimPill, Sparkline } from './ui';

export const TREASURY_COLORS: Record<TreasuryEvent['kind'], string> = {
  fund: '#6aa8ff', fees: '#2ee6a0', winner: '#39e3ff', holders: '#ffcf5a', platform: '#8b7bff', tournament: '#ff7a3d',
};
const ICON: Record<TreasuryEvent['kind'], string> = { fund: '🔒', fees: '➕', winner: '💧', holders: '🎖', platform: '🏛', tournament: '🏆' };

export function TreasuryEventRow({ ev, now, showLink }: { ev: TreasuryEvent; now: number; showLink?: boolean }) {
  const body = (
    <>
      <span className="tre-ico" style={{ color: TREASURY_COLORS[ev.kind], borderColor: TREASURY_COLORS[ev.kind] }}>{ICON[ev.kind]}</span>
      <span className="grow tre-text">{ev.text}</span>
      <span className="mono tre-amt" style={{ color: TREASURY_COLORS[ev.kind] }}>{ev.kind === 'fees' || ev.kind === 'fund' ? '+' : ''}{usd(quoteToUsd(ev.amountQuote))}</span>
      <span className="mono dim tre-ago">{ago(now - ev.t)}</span>
    </>
  );
  if (showLink && ev.battleId) return <Link to={`/battle/${ev.battleId}`} className="tre-row">{body}</Link>;
  if (showLink && ev.tournamentId) return <Link to={`/tournament/${ev.tournamentId}`} className="tre-row">{body}</Link>;
  return <div className="tre-row">{body}</div>;
}

/** Visible per-battle treasury: balance, fee inflow, locked split and activity. */
export function BattleTreasuryCard({ battle }: { battle: Battle }) {
  const e = useData();
  const tr = battle.treasury;
  const bal = e.treasuryBalance(battle);
  const sp = battle.rules.rewardSplit;
  const done = tr.distributed;
  const rows = [
    { k: 'Winner Support', v: sp.winnerLiquidity, c: TREASURY_COLORS.winner },
    { k: 'Holder Rewards', v: sp.holderRewards, c: TREASURY_COLORS.holders },
    { k: 'Platform', v: sp.platform, c: TREASURY_COLORS.platform },
  ];
  const events = [...tr.events].reverse().slice(0, 5);
  return (
    <div className="panel treasury-card">
      <div className="panel-head">
        <span className="panel-title">🏛 Battle Treasury</span>
        <SimPill />
      </div>
      <div className="panel-pad col" style={{ gap: 14 }}>
        <div className="spread" style={{ alignItems: 'flex-end' }}>
          <div>
            <div className="label">{done ? 'Distributed' : 'Current balance'}</div>
            <div className="tre-balance mono">{usd(quoteToUsd(bal), { compact: false, decimals: 0 })}</div>
            <div className="muted mono" style={{ fontSize: 12 }}>{sol(bal, 2)} · {done ? 'paid out at battle end' : battle.status === 'live' ? 'growing with every swap' : 'locked until start'}</div>
          </div>
          <Sparkline points={tr.history.map((h) => h.balance)} color={TREASURY_COLORS.fees} width={110} height={40} />
        </div>
        <div className="tre-split">
          {rows.map((r) => (
            <div key={r.k} className="tre-split-row">
              <span className="split-dot" style={{ background: r.c }} />
              <span className="grow">{r.k} <span className="dim">{Math.round(r.v * 100)}%</span></span>
              <span className="mono" style={{ fontWeight: 700 }}>{usd(quoteToUsd(bal * r.v), { compact: false, decimals: 0 })}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-2" style={{ gap: 8 }}>
          <div className="tre-mini"><span className="label">Funded at lock</span><span className="mono">{sol(tr.fundedQuote, 0)}</span></div>
          <div className="tre-mini"><span className="label">Fees accumulated</span><span className="mono up">+{sol(tr.feesQuote, 3)}</span></div>
        </div>
        <div>
          <div className="label" style={{ marginBottom: 6 }}>Recent treasury activity</div>
          <div className="tre-list">{events.map((ev) => <TreasuryEventRow key={ev.id} ev={ev} now={e.now} />)}</div>
        </div>
        <div className="dim" style={{ fontSize: 11.5 }}>
          {TREASURY_FEE_SHARE * 100}% of the 1% swap fee flows in while live. Split is locked with the battle rules (configurable per battle at creation). <Link to="/treasury" className="link">Platform treasury →</Link>
        </div>
      </div>
    </div>
  );
}
