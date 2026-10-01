import type { BattleRules, ScoreInputs, SideScore } from './types.ts';

/**
 * BATTLE SCORE (fixed before start, part of the rules commitment)
 *
 *   Score = 60% · Performance + 20% · Holder Growth + 20% · Market Quality
 *
 * Performance    – time-weighted average log return R = (1/T)∫ ln(p/p₀) dt,
 *                  scored relative to the opponent with a softmax (k = 4).
 * Holder Growth  – holders now / holders at start − 1, relative softmax (k = 6).
 *                  Neutral (50/50) when holder data is unavailable for either side.
 * Market Quality – 100 · mean(distribution, organic flow, liquidity retention).
 * Raw volume is never a scoring input.
 */
function softmaxPair(k: number, x: number, y: number): [number, number] {
  const m = Math.max(k * x, k * y);
  const ex = Math.exp(k * x - m);
  const ey = Math.exp(k * y - m);
  return [(100 * ex) / (ex + ey), (100 * ey) / (ex + ey)];
}

const growth = (i: ScoreInputs) =>
  i.holdersStart && i.holdersNow !== null && i.holdersStart > 0 ? i.holdersNow / i.holdersStart - 1 : null;

export function computeScores(rules: BattleRules, a: ScoreInputs, b: ScoreInputs): [SideScore, SideScore] {
  const [pa, pb] = softmaxPair(rules.perfSteepness, a.twReturn, b.twReturn);
  const ga = growth(a);
  const gb = growth(b);
  const [ha, hb] = ga !== null && gb !== null ? softmaxPair(rules.holderSteepness, ga, gb) : [50, 50];
  const q = (i: ScoreInputs) => (100 * (i.distribution + i.organicFlow + i.liquidityRetention)) / 3;
  const w = rules.weights;
  const mk = (p: number, h: number, i: ScoreInputs, g: number | null): SideScore => ({
    total: w.performance * p + w.holderGrowth * h + w.marketQuality * q(i),
    performance: p, holderGrowth: h, marketQuality: q(i), holderGrowthPct: g, inputs: i,
  });
  return [mk(pa, ha, a, ga), mk(pb, hb, b, gb)];
}

export function neutralInputs(): ScoreInputs {
  return { twReturn: 0, currentReturn: 0, holdersStart: null, holdersNow: null, distribution: 0.5, organicFlow: 1, liquidityRetention: 1 };
}

/** Battle Loyalty hold factor: rewards keeping the position through the end. */
export function holdFactor(currentAmount: number, peakAmount: number) {
  if (peakAmount <= 0 || currentAmount <= 0) return 0;
  return currentAmount >= peakAmount * 0.5 ? 1 : 0.5;
}
