import type { Battle, BattleRules, BattleSideState, Market, SideScore, Token } from '../data/types';
import { clamp } from './format';
import { liquidityQuote } from './amm';

/**
 * BATTLE SCORE (fixed before start, published in the rules commitment)
 *
 *   Score = 60% · Performance + 20% · Holder Growth + 20% · Market Quality
 *
 * Performance   – time-weighted average log-return since the battle-start
 *                 snapshot, R = (1/T)∫ ln(p(t)/p₀) dt. Each second of the battle
 *                 counts equally, so a last-second pump barely moves it.
 *                 Scored relative to the opponent:
 *                 P_A = 100 · e^(k·R_A) / (e^(k·R_A) + e^(k·R_B)),  k = 4.
 * Holder Growth – growth of eligible holders (≥ min position, not in a flagged
 *                 cluster) vs. the start snapshot, scored relatively with k = 6.
 * Market Quality – absolute 0–100, mean of:
 *                 · Distribution  = 1 − top-10 wallets' share of battle buys
 *                 · Organic flow  = 1 − flagged volume / battle volume
 *                 · Liquidity     = min(1, liquidity now / liquidity at start)
 *
 * Raw trading volume is intentionally NOT a scoring input.
 */
export interface ScoreContext {
  side: BattleSideState;
  market: Market;
  token: Token;
  flaggedHolders: number;
}

function softmaxPair(k: number, x: number, y: number): [number, number] {
  const m = Math.max(k * x, k * y);
  const ex = Math.exp(k * x - m);
  const ey = Math.exp(k * y - m);
  return [(100 * ex) / (ex + ey), (100 * ey) / (ex + ey)];
}

function rawInputs(c: ScoreContext, rules: BattleRules) {
  const s = c.side;
  const twReturn = s.twTime > 0 ? s.twAccumulator / s.twTime : 0;
  const currentReturn = c.market.price / s.startPrice - 1;
  const eligibleHolders = Math.max(0, c.market.holders - c.flaggedHolders);
  const holderGrowthPct = eligibleHolders / Math.max(1, s.startHolders) - 1;

  const minBal = rules.minHolderQuote / c.market.price;
  let totalBal = 0;
  const top: number[] = [];
  for (const v of s.battleHolders.values()) {
    if (v < minBal) continue;
    totalBal += v;
    if (top.length < 10) { top.push(v); top.sort((x, y) => y - x); }
    else if (v > top[9]) { top[9] = v; top.sort((x, y) => y - x); }
  }
  const top10 = top.reduce((x, y) => x + y, 0);
  const distribution = totalBal > 0 ? clamp(1 - top10 / totalBal, 0, 1) : 0.5;

  const organicFlow = s.battleVolumeQuote > 0 ? clamp(1 - s.flaggedVolumeQuote / s.battleVolumeQuote, 0, 1) : 1;
  const liquidityRetention = clamp(liquidityQuote(c.market) / s.startLiquidityQuote, 0, 1);

  return {
    twReturn, currentReturn, holderGrowthPct, eligibleHoldersStart: s.startHolders, eligibleHolders,
    distribution, organicFlow, liquidityRetention,
  };
}

export function computeScores(rules: BattleRules, a: ScoreContext, b: ScoreContext): [SideScore, SideScore] {
  const ia = rawInputs(a, rules);
  const ib = rawInputs(b, rules);
  const [pa, pb] = softmaxPair(rules.perfSteepness, ia.twReturn, ib.twReturn);
  const [ha, hb] = softmaxPair(rules.holderSteepness, ia.holderGrowthPct, ib.holderGrowthPct);
  const qa = (100 * (ia.distribution + ia.organicFlow + ia.liquidityRetention)) / 3;
  const qb = (100 * (ib.distribution + ib.organicFlow + ib.liquidityRetention)) / 3;
  const w = rules.weights;
  const mk = (p: number, h: number, q: number, inputs: SideScore['inputs']): SideScore => ({
    total: w.performance * p + w.holderGrowth * h + w.marketQuality * q,
    performance: p,
    holderGrowth: h,
    marketQuality: q,
    inputs,
  });
  return [mk(pa, ha, qa, ia), mk(pb, hb, qb, ib)];
}

export function emptyScore(): SideScore {
  return {
    total: 0, performance: 50, holderGrowth: 50, marketQuality: 0,
    inputs: { twReturn: 0, currentReturn: 0, holderGrowthPct: 0, eligibleHoldersStart: 0, eligibleHolders: 0, distribution: 0, organicFlow: 1, liquidityRetention: 1 },
  };
}

export function leaderOf(b: Battle) {
  if (b.winner) return b.winner;
  return b.a.score.total >= b.b.score.total ? b.a.tokenId : b.b.tokenId;
}

/** Loyalty: share of holder pool. HoldFactor rewards keeping the position through the end. */
export function holdFactor(currentAmount: number, peakAmount: number) {
  if (peakAmount <= 0 || currentAmount <= 0) return 0;
  return currentAmount >= peakAmount * 0.5 ? 1 : 0.5;
}
