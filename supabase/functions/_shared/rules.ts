import type { BattleRules, BattleType, RewardSplit } from './types.ts';
import { sha256 } from './sha256.ts';

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

export const DRAND_QUICKNET = {
  chainHash: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
  genesisTime: 1692803367,
  periodSec: 3,
  url: 'https://api.drand.sh',
};

export function makeRules(opts: { type?: BattleType; minDurationMs?: number; split?: RewardSplit } = {}): BattleRules {
  const type = opts.type ?? 'classic';
  const t = BATTLE_TYPES[type];
  return {
    version: 'battle-rules/2.0',
    type,
    randomEnd: {
      minDurationMs: Math.max(HOUR, opts.minDurationMs ?? HOUR),
      epochMs: t.epochMs,
      hazardPerEpoch: hazardFor(t.epochMs, t.meanAfterMin),
      maxDurationMs: 6 * HOUR,
      beacon: `drand quicknet ${DRAND_QUICKNET.chainHash.slice(0, 12)}… (3s rounds)`,
    },
    weights: { performance: 0.6, holderGrowth: 0.2, marketQuality: 0.2 },
    perfSteepness: 4,
    holderSteepness: 6,
    rewardSplit: opts.split ?? DEFAULT_SPLIT,
    dataSources: {
      prices: 'DexScreener — highest-liquidity pool, sampled every minute',
      trades: 'GeckoTerminal — pool trades (latest 300 per minute)',
      holders: 'Birdeye token overview; if unavailable for either token, Holder Growth is neutral (50/50)',
      randomness: 'drand quicknet public beacon',
    },
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
  return (1 - hazardPerEpoch) ** Math.floor((t - minDurationMs) / epochMs);
}

export function medianEnd(rules: BattleRules) {
  const { minDurationMs, epochMs, hazardPerEpoch } = rules.randomEnd;
  return minDurationMs + Math.ceil(Math.log(0.5) / Math.log(1 - hazardPerEpoch)) * epochMs;
}
