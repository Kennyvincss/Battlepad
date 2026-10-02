import type { BattleRules, BattleType, RewardSplit } from './types.ts';
import { sha256 } from './sha256.ts';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/** Hazard per epoch so that the expected time after the minimum equals `meanAfterMin`. */
export function hazardFor(epochMs: number, meanAfterMinMs: number) {
  return 1 - Math.exp(-epochMs / meanAfterMinMs);
}

export const DAY = 24 * HOUR;

/**
 * Ending styles. After the minimum, the battle can end at any check; the expected
 * extra time is max(base, minimum × share), so long battles get a proportionally
 * longer final stretch.
 */
export const BATTLE_TYPES: Record<BattleType, { label: string; blurb: string; meanAfterMin: number; epochMs: number; share: number }> = {
  classic: { label: 'Classic', blurb: 'Balanced finish: the final stretch lasts about 10% of the battle on average.', meanAfterMin: 45 * MINUTE, epochMs: MINUTE, share: 0.1 },
  blitz: { label: 'Blitz', blurb: 'Sharp finish: the final stretch is short (about 5% of the battle).', meanAfterMin: 20 * MINUTE, epochMs: 30_000, share: 0.05 },
  marathon: { label: 'Marathon', blurb: 'Long finish: the final stretch lasts about 20% of the battle.', meanAfterMin: 90 * MINUTE, epochMs: 2 * MINUTE, share: 0.2 },
};

/** Allowed minimum durations, from one hour to a year. */
export const DURATIONS: { ms: number; label: string }[] = [
  { ms: HOUR, label: '1 hour' },
  { ms: 3 * HOUR, label: '3 hours' },
  { ms: 6 * HOUR, label: '6 hours' },
  { ms: 12 * HOUR, label: '12 hours' },
  { ms: DAY, label: '1 day' },
  { ms: 3 * DAY, label: '3 days' },
  { ms: 7 * DAY, label: '1 week' },
  { ms: 14 * DAY, label: '2 weeks' },
  { ms: 30 * DAY, label: '1 month' },
  { ms: 90 * DAY, label: '3 months' },
  { ms: 180 * DAY, label: '6 months' },
  { ms: 365 * DAY, label: '1 year' },
];

/** How often the end check runs: every minute for short battles, less often for long ones. */
function epochFor(type: BattleType, minDurationMs: number) {
  if (minDurationMs <= DAY) return BATTLE_TYPES[type].epochMs;
  if (minDurationMs <= 7 * DAY) return 5 * MINUTE;
  if (minDurationMs <= 31 * DAY) return 15 * MINUTE;
  return HOUR;
}

/** How often the keeper stores a chart/score sample (keeps year-long battles small). */
export function sampleEveryMs(rules: BattleRules) {
  return rules.randomEnd.minDurationMs <= DAY ? MINUTE : rules.randomEnd.epochMs;
}

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
  const minDurationMs = Math.max(HOUR, opts.minDurationMs ?? HOUR);
  const epochMs = epochFor(type, minDurationMs);
  // Identical to the original rules for battles up to 3 hours (the max(...) terms keep the old values).
  const meanAfterMin = Math.max(t.meanAfterMin, minDurationMs * t.share);
  const long = minDurationMs > DAY;
  return {
    version: 'battle-rules/2.0',
    type,
    randomEnd: {
      minDurationMs,
      epochMs,
      hazardPerEpoch: hazardFor(epochMs, meanAfterMin),
      maxDurationMs: minDurationMs <= 3 * HOUR ? 6 * HOUR : minDurationMs + 4 * meanAfterMin,
      beacon: `drand quicknet ${DRAND_QUICKNET.chainHash.slice(0, 12)}… (3s rounds)`,
    },
    weights: { performance: 0.6, holderGrowth: 0.2, marketQuality: 0.2 },
    perfSteepness: 4,
    holderSteepness: 6,
    rewardSplit: opts.split ?? DEFAULT_SPLIT,
    dataSources: {
      prices: 'DexScreener — highest-liquidity pool, sampled every minute',
      trades: long ? 'GeckoTerminal — pool trades (latest 300 per poll, every few minutes); market quality uses the last 7 days of trades' : 'GeckoTerminal — pool trades (latest 300 per minute)',
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
