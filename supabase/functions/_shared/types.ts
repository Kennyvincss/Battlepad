/**
 * Types shared by the web app and the Supabase battle keeper.
 * Pure TypeScript: no runtime imports, so it runs in both Vite and Deno.
 */
export type BattleType = 'classic' | 'blitz' | 'marathon';
export type BattleStatus = 'pending' | 'scheduled' | 'live' | 'ended' | 'declined' | 'cancelled';

export interface RewardSplit {
  winnerLiquidity: number;
  holderRewards: number;
  platform: number;
}

export interface RandomEndRules {
  minDurationMs: number;
  epochMs: number;
  hazardPerEpoch: number;
  maxDurationMs: number;
  beacon: string;
}

export interface BattleRules {
  version: string;
  type: BattleType;
  randomEnd: RandomEndRules;
  weights: { performance: number; holderGrowth: number; marketQuality: number };
  perfSteepness: number;
  holderSteepness: number;
  /** Treasury is funded by BATTLE's swap fee on trades made through the app. */
  rewardSplit: RewardSplit;
  /** Published data sources each score input is read from. */
  dataSources: { prices: string; trades: string; holders: string; randomness: string };
  integrity: { excludeFlagged: boolean; excludeClusterWallets: boolean };
}

export interface ScoreInputs {
  /** Time-weighted average log return since battle start. */
  twReturn: number;
  currentReturn: number;
  /** null when holder data is unavailable. */
  holdersStart: number | null;
  holdersNow: number | null;
  /** 1 − top-10 wallets' share of battle buys (0..1). */
  distribution: number;
  /** 1 − flagged volume / battle volume (0..1). */
  organicFlow: number;
  /** min(1, liquidity now / liquidity at start). */
  liquidityRetention: number;
}

export interface SideScore {
  total: number;
  performance: number;
  holderGrowth: number;
  marketQuality: number;
  holderGrowthPct: number | null;
  inputs: ScoreInputs;
}

export interface EndCheck {
  index: number;
  /** Battle-relative ms at which the epoch closed. */
  at: number;
  beaconRound: number;
  beaconRandomness: string;
  value: number;
  threshold: number;
  ended: boolean;
}
