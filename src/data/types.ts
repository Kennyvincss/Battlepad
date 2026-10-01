/**
 * Core domain types for BATTLE.
 *
 * Everything the UI renders flows through these shapes. The prototype fills
 * them from the in-browser simulation (`src/sim`), but they are deliberately
 * chain-agnostic so a real indexer / RPC-backed provider can populate them
 * later without touching the components. See `src/data/provider.ts`.
 */

export type Address = string;
export type TokenId = string;
export type BattleId = string;

/** Where a value came from. Every user-facing number carries this so the UI can label it. */
export type DataSource = 'simulated' | 'onchain';

export interface Socials {
  website?: string;
  x?: string;
  telegram?: string;
}

export interface Token {
  id: TokenId;
  name: string;
  ticker: string;
  /** Emoji glyph used as the logo in the prototype. A real provider would supply `logoUrl`. */
  logo: string;
  logoUrl?: string;
  /** Brand hue (0-360) used for the token's side colour. */
  hue: number;
  description: string;
  creatorId: string;
  mint: Address;
  totalSupply: number;
  createdAt: number;
  socials: Socials;
  launchMode: 'battle' | 'normal';
}

/** Live market state for a token. Prices are denominated in the quote asset (SOL). */
export interface Market {
  tokenId: TokenId;
  /** AMM reserves (constant product). */
  reserveQuote: number;
  reserveToken: number;
  /** Price in quote per token. */
  price: number;
  /** Holders with non-dust balances (includes pre-battle holders). */
  holders: number;
  /** Cumulative 24h-style volume in quote. */
  volumeQuote: number;
  /** Fee charged on each swap (e.g. 0.01 = 1%). */
  feeRate: number;
}

export interface PricePoint {
  /** Battle-relative or absolute sim ms timestamp. */
  t: number;
  price: number;
  volume: number;
}

export type TradeSide = 'buy' | 'sell';

export interface Trade {
  id: string;
  t: number;
  tokenId: TokenId;
  wallet: Address;
  side: TradeSide;
  quoteAmount: number;
  tokenAmount: number;
  price: number;
  /** True when the integrity engine has excluded this trade from Battle Score inputs. */
  flagged?: boolean;
  isUser?: boolean;
}

/* ---------------------------------------------------------------- Battle rules */

export interface ScoreWeights {
  performance: number;
  holderGrowth: number;
  marketQuality: number;
}

export interface RewardSplit {
  /** Fraction of the pool used to deepen the winner's liquidity. */
  winnerLiquidity: number;
  /** Fraction paid to eligible holders of the winning token (Battle Loyalty). */
  holderRewards: number;
  /** Fraction kept for the platform / ecosystem. */
  platform: number;
}

export interface RandomEndRules {
  /** Battle cannot end before this many ms. */
  minDurationMs: number;
  /** Interval between end checks after the minimum time. */
  epochMs: number;
  /** Probability that any single post-minimum epoch check ends the battle. */
  hazardPerEpoch: number;
  /** Hard safety cap (published). The battle ends at the cap if no check fired. */
  maxDurationMs: number;
  /** Public randomness beacon used for end checks. */
  beacon: string;
}

export type BattleType = 'classic' | 'blitz' | 'marathon';

export interface BattleRules {
  version: string;
  type: BattleType;
  randomEnd: RandomEndRules;
  weights: ScoreWeights;
  /** Softmax steepness used for relative performance & holder growth sub-scores. */
  perfSteepness: number;
  holderSteepness: number;
  /** A holder must have at least this much quote value to count. */
  minHolderQuote: number;
  rewardPoolQuote: number;
  rewardSplit: RewardSplit;
  integrity: {
    /** Flagged volume is excluded from Market Quality & holder growth. */
    excludeFlagged: boolean;
    /** Wallets in a flagged cluster are excluded from holder growth. */
    excludeClusterWallets: boolean;
  };
}

/* ---------------------------------------------------------------- Scores */

export interface SideScore {
  total: number;
  performance: number;
  holderGrowth: number;
  marketQuality: number;
  /** Raw inputs, exposed so the UI can show the math. */
  inputs: {
    twReturn: number;
    currentReturn: number;
    holderGrowthPct: number;
    eligibleHoldersStart: number;
    eligibleHolders: number;
    distribution: number;
    organicFlow: number;
    liquidityRetention: number;
  };
}

/* ---------------------------------------------------------------- Integrity */

export type IntegritySeverity = 'info' | 'warning' | 'alert';

export interface IntegrityEvent {
  id: string;
  t: number;
  tokenId: TokenId;
  severity: IntegritySeverity;
  kind:
    | 'wash-trading'
    | 'circular-trading'
    | 'coordinated-wallets'
    | 'common-funding'
    | 'artificial-volume'
    | 'synchronized-trading'
    | 'community-surge';
  title: string;
  detail: string;
  wallets: number;
  excludedQuote: number;
}

export interface IntegrityState {
  /** 0-100 – share of battle volume considered organic, rounded. */
  score: number;
  events: IntegrityEvent[];
  flaggedWallets: Set<Address>;
}

/* ---------------------------------------------------------------- Random end */

export interface EndCheck {
  index: number;
  /** Battle-relative ms at which the epoch closed. */
  at: number;
  beaconRound: number;
  beaconRandomness: string;
  /** sha256(battleId | rulesHash | randomness) → uniform [0,1). */
  value: number;
  threshold: number;
  ended: boolean;
}

export interface RandomEndCommitment {
  battleId: BattleId;
  rulesHash: string;
  /** Beacon round that maps to the battle's start; checks use later rounds only. */
  startRound: number;
  committedAt: number;
}

/* ---------------------------------------------------------------- Battle */

export type BattleStatus = 'pending' | 'scheduled' | 'live' | 'ended';

export interface BattleSideState {
  tokenId: TokenId;
  startPrice: number;
  startHolders: number;
  startLiquidityQuote: number;
  startMarketCapQuote: number;
  history: PricePoint[];
  buyers: Set<Address>;
  sellers: Set<Address>;
  battleVolumeQuote: number;
  flaggedVolumeQuote: number;
  /** wallet -> token balance acquired during battle (for loyalty + distribution). */
  battleHolders: Map<Address, number>;
  /** running sum of return * dt for time-weighted return. */
  twAccumulator: number;
  twTime: number;
  /** ∫ circulating holder value dt (quote·ms) – Battle Loyalty denominator. */
  circulatingQuoteMs: number;
  score: SideScore;
}

export interface Battle {
  id: BattleId;
  a: BattleSideState;
  b: BattleSideState;
  status: BattleStatus;
  rules: BattleRules;
  commitment: RandomEndCommitment;
  /** Absolute sim ms. */
  scheduledStart: number;
  startedAt?: number;
  endedAt?: number;
  challengerId: TokenId;
  createdBy: string;
  endChecks: EndCheck[];
  integrity: Record<TokenId, IntegrityState>;
  winner?: TokenId;
  /** Lead changes timeline (battle-relative ms). */
  leadChanges: { t: number; leader: TokenId }[];
  trades: Trade[];
  /** Battle Score samples for the score timeline (battle-relative ms). */
  scoreHistory: { t: number; a: number; b: number }[];
  /** Social feed: wallets joining an army, surges, alerts. */
  feed: FeedItem[];
  /** Approx unique traders in the battle across both tokens. */
  traders: Set<Address>;
  final?: BattleFinal;
  featured?: boolean;
  /** Static legacy results generated for history – no live data attached. */
  archived?: boolean;
}

export interface FeedItem {
  id: string;
  t: number;
  kind: 'join' | 'whale' | 'lead' | 'alert' | 'surge' | 'you';
  tokenId?: TokenId;
  text: string;
}

export interface BattleFinal {
  durationMs: number;
  scoreA: SideScore;
  scoreB: SideScore;
  marketCapA: number;
  marketCapB: number;
  returnA: number;
  returnB: number;
  holderGrowthA: number;
  holderGrowthB: number;
  integrityA: number;
  integrityB: number;
  endCheck?: EndCheck;
  hitCap: boolean;
}

/** Lightweight record for historic battles (and live/ended ones once summarised). */
export interface BattleRecordEntry {
  battleId: BattleId;
  tokenId: TokenId;
  opponentId: TokenId;
  won: boolean;
  scoreFor: number;
  scoreAgainst: number;
  durationMs: number;
  endedAt: number;
}

/* ---------------------------------------------------------------- Users */

export interface Creator {
  id: string;
  name: string;
  handle: string;
  wallet: Address;
  avatar: string;
  joinedAt: number;
  /** Transparent historical facts – reputation is derived from these, not assigned. */
  history: {
    tokensLaunched: number;
    tokensActive30d: number;
    liquidityPulls: number;
    battlesCompleted: number;
    battlesWithIntegrityAlerts: number;
    avgLiquidityRetained7d: number;
    totalBattleParticipants: number;
  };
}

export interface Position {
  tokenId: TokenId;
  amount: number;
  /** Cost basis in quote. */
  costQuote: number;
}

export interface LoyaltyState {
  battleId: BattleId;
  tokenId: TokenId;
  /** ∫ positionQuote dt (quote·ms) during the battle. */
  weightedQuoteMs: number;
  firstHeldAt?: number;
  heldMs: number;
  peakAmount: number;
  soldDuringBattle: boolean;
}

export interface Wallet {
  connected: boolean;
  address: Address;
  provider?: string;
  quoteBalance: number;
  positions: Record<TokenId, Position>;
  trades: Trade[];
  loyalty: Record<string, LoyaltyState>;
  /** Armies joined per battle (social only). */
  armies: Record<BattleId, TokenId>;
  claimedRewardsQuote: number;
  loyaltyPoints: number;
}

export interface Challenge {
  id: string;
  fromTokenId: TokenId;
  toTokenId: TokenId;
  createdAt: number;
  rules: BattleRules;
  status: 'pending' | 'accepted' | 'declined';
  incoming: boolean;
  message?: string;
}

export interface Notification {
  id: string;
  t: number;
  kind: 'challenge' | 'battle-start' | 'battle-end' | 'reward' | 'info';
  title: string;
  body: string;
  link?: string;
  challengeId?: string;
  read: boolean;
}

export interface Quote {
  side: TradeSide;
  tokenId: TokenId;
  inputAmount: number;
  outputAmount: number;
  /** Execution price incl. fee, quote per token. */
  avgPrice: number;
  priceImpact: number;
  fee: number;
  minReceived: number;
}
