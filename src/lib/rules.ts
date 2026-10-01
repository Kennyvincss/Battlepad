import type { BattleRules, BattleType, RewardSplit } from '../data/types';
import { sha256 } from './sha256';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/** Hazard per epoch so that the expected time after the minimum equals `meanAfterMin`. */
export function hazardFor(epochMs: number, meanAfterMinMs: number) {
  return 1 - Math.exp(-epochMs / meanAfterMinMs);
}

export const BATTLE_TYPES: Record<BattleType, { label: string; blurb: string; meanAfterMin: number; epochMs: number }> = {
  classic: { label: 'Classic', blurb: 'Balanced pace. Expected ~45m of sudden-death after the minimum.', meanAfterMin: 45 * MINUTE, epochMs: MINUTE },
  blitz: { label: 'Blitz', blurb: 'Sharper finish. Expected ~20m of sudden-death after the minimum.', meanAfterMin: 20 * MINUTE, epochMs: 30_000 },
  marathon: { label: 'Marathon', blurb: 'Long war. Expected ~90m of sudden-death after the minimum.', meanAfterMin: 90 * MINUTE, epochMs: 2 * MINUTE },
};

export const DEFAULT_SPLIT: RewardSplit = { winnerLiquidity: 0.5, holderRewards: 0.25, platform: 0.25 };

export function makeRules(opts: {
  type?: BattleType;
  minDurationMs?: number;
  rewardPoolQuote?: number;
  split?: RewardSplit;
} = {}): BattleRules {
  const type = opts.type ?? 'classic';
  const t = BATTLE_TYPES[type];
  return {
    version: 'battle-rules/1.0',
    type,
    randomEnd: {
      minDurationMs: Math.max(HOUR, opts.minDurationMs ?? HOUR),
      epochMs: t.epochMs,
      hazardPerEpoch: hazardFor(t.epochMs, t.meanAfterMin),
      maxDurationMs: 6 * HOUR,
      beacon: 'drand quicknet (3s rounds) — simulated in prototype',
    },
    weights: { performance: 0.6, holderGrowth: 0.2, marketQuality: 0.2 },
    perfSteepness: 4,
    holderSteepness: 6,
    minHolderQuote: 0.05,
    rewardPoolQuote: opts.rewardPoolQuote ?? 150,
    rewardSplit: opts.split ?? DEFAULT_SPLIT,
    integrity: { excludeFlagged: true, excludeClusterWallets: true },
  };
}

/** Canonical (key-sorted) JSON so the commitment hash is reproducible. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

export function rulesHash(rules: BattleRules, tokenA: string, tokenB: string) {
  return sha256(canonical({ rules, tokenA, tokenB }));
}

/** Probability the battle is still live at `t` (battle-relative ms) – for the published odds table. */
export function survivalAt(rules: BattleRules, t: number) {
  const { minDurationMs, epochMs, hazardPerEpoch, maxDurationMs } = rules.randomEnd;
  if (t < minDurationMs) return 1;
  if (t >= maxDurationMs) return 0;
  const epochs = Math.floor((t - minDurationMs) / epochMs);
  return (1 - hazardPerEpoch) ** epochs;
}

export function medianEnd(rules: BattleRules) {
  const { minDurationMs, epochMs, hazardPerEpoch } = rules.randomEnd;
  const epochs = Math.ceil(Math.log(0.5) / Math.log(1 - hazardPerEpoch));
  return minDurationMs + epochs * epochMs;
}
