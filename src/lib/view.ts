import type { Battle, BattleSideState } from '../data/types';
import type { SimEngine } from '../sim/engine';
import { liquidityQuote } from './amm';
import { quoteToUsd } from './format';

export interface SideView {
  side: BattleSideState;
  token: SimEngine['tokens'][string];
  price: number;
  mcapUsd: number;
  change: number;
  liquidityUsd: number;
  holders: number;
  holdersDelta: number;
  volumeUsd: number;
  buyers: number;
  sellers: number;
  score: number;
  position: 1 | 2;
  integrity: number;
  spark: number[];
}

export function sideView(e: SimEngine, b: Battle, which: 'a' | 'b'): SideView {
  const s = b[which];
  const other = which === 'a' ? b.b : b.a;
  const token = e.tokens[s.tokenId];
  const m = e.markets[s.tokenId];
  const ended = b.status === 'ended' && b.final;
  const score = ended ? (which === 'a' ? b.final!.scoreA.total : b.final!.scoreB.total) : s.score.total;
  const otherScore = ended ? (which === 'a' ? b.final!.scoreB.total : b.final!.scoreA.total) : other.score.total;
  const live = b.status === 'live' || b.status === 'ended';
  const hist = s.history;
  const step = Math.max(1, Math.floor(hist.length / 40));
  const spark: number[] = [];
  for (let i = 0; i < hist.length; i += step) spark.push(hist[i].price);
  if (hist.length) spark.push(m.price);
  const winnerPos = b.winner ? (b.winner === s.tokenId ? 1 : 2) : score >= otherScore ? 1 : 2;
  return {
    side: s, token, price: m.price,
    mcapUsd: quoteToUsd(m.price * token.totalSupply),
    change: live ? m.price / s.startPrice - 1 : 0,
    liquidityUsd: quoteToUsd(liquidityQuote(m)),
    holders: m.holders,
    holdersDelta: live ? m.holders - s.startHolders : 0,
    volumeUsd: quoteToUsd(s.battleVolumeQuote),
    buyers: s.buyers.size,
    sellers: s.sellers.size,
    score,
    position: winnerPos as 1 | 2,
    integrity: b.integrity[s.tokenId]?.score ?? 100,
    spark,
  };
}

export function battleIntegrity(b: Battle) {
  const vol = b.a.battleVolumeQuote + b.b.battleVolumeQuote;
  const flagged = b.a.flaggedVolumeQuote + b.b.flaggedVolumeQuote;
  return vol > 0 ? Math.round(100 * (1 - flagged / vol)) : 100;
}

export function recentAlert(e: SimEngine, b: Battle, windowMs = 12 * 60_000) {
  const evs = [...b.integrity[b.a.tokenId].events, ...b.integrity[b.b.tokenId].events]
    .filter((x) => x.severity === 'alert' && e.now - x.t < windowMs)
    .sort((x, y) => y.t - x.t);
  return evs[0];
}

export function combinedVolumeUsd(b: Battle) {
  return quoteToUsd(b.a.battleVolumeQuote + b.b.battleVolumeQuote);
}

/** Profile stats for the demo wallet: seeded history (simulated) + this session's activity. */
export function userStats(e: SimEngine) {
  const armies = Object.entries(e.wallet.armies);
  const endedArmies = armies.filter(([bid]) => e.getBattle(bid)?.status === 'ended');
  const won = endedArmies.filter(([bid, tid]) => e.getBattle(bid)?.winner === tid).length;
  return {
    totalTrades: 137 + e.wallet.trades.length,
    battles: 23 + armies.length,
    winningSides: 15 + won,
    rewardsQuote: e.wallet.claimedRewardsQuote,
    loyaltyPoints: e.wallet.loyaltyPoints,
  };
}
