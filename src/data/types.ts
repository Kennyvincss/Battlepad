/**
 * Live domain types. Rows from Supabase (battle state written by the keeper)
 * and market data from DexScreener / GeckoTerminal are mapped into these.
 * All money values are USD unless the name says otherwise.
 */
import type { BattleRules, BattleStatus, EndCheck, SideScore } from '../lib/shared';

export type { BattleRules, BattleStatus, EndCheck, SideScore };
export type TokenId = string; // = mint address
export type BattleId = string;
export type TradeSide = 'buy' | 'sell';

export interface Token {
  id: TokenId;
  mint: string;
  ticker: string;
  name: string;
  logoUrl?: string;
  hue: number;
  pairAddress: string;
  dexId?: string;
  description?: string;
  socials: { website?: string; x?: string; telegram?: string; [k: string]: string | undefined };
  listedBy: string;
  listedAt: number;
}

/** Live market for a token's listed pool (DexScreener). */
export interface Market {
  tokenId: TokenId;
  priceUsd: number;
  priceNative: number;
  mcapUsd: number;
  liquidityUsd: number;
  volume24Usd: number;
  change24: number | null;
  buys24: number;
  sells24: number;
  pairUrl?: string;
  updatedAt: number;
}

export interface SideState {
  tokenId: TokenId;
  startPrice: number | null;
  startHolders: number | null;
  startLiquidity: number | null;
  startMcap: number | null;
  priceUsd: number | null;
  mcapUsd: number | null;
  liquidityUsd: number | null;
  holders: number | null;
  volumeUsd: number;
  flaggedUsd: number;
  buyers: number;
  sellers: number;
  score: SideScore | null;
}

export interface BattleFinal {
  durationMs: number;
  scoreA: SideScore;
  scoreB: SideScore;
  marketCapA: number;
  marketCapB: number;
  returnA: number;
  returnB: number;
  holderGrowthA: number | null;
  holderGrowthB: number | null;
  holdersA: number | null;
  holdersB: number | null;
  integrityA: number;
  integrityB: number;
  endCheck: EndCheck | null;
  hitCap: boolean;
}

export interface Battle {
  id: BattleId;
  number: number;
  a: SideState;
  b: SideState;
  status: BattleStatus;
  rules: BattleRules;
  rulesHash: string;
  createdBy: string;
  challengeMessage?: string;
  scheduledStart: number;
  startedAt?: number;
  endedAt?: number;
  winner?: TokenId;
  tournamentId?: string;
  matchRound?: number;
  matchSlot?: number;
  traders: number;
  leadChanges: number;
  leader?: TokenId;
  final?: BattleFinal;
}

export interface Snapshot {
  t: number;
  priceA: number; priceB: number;
  mcapA: number; mcapB: number;
  holdersA: number | null; holdersB: number | null;
  scoreA: number; scoreB: number;
}

export interface Trade {
  tx: string;
  tokenId: TokenId;
  wallet: string;
  side: TradeSide;
  usd: number;
  t: number;
  flagged: boolean;
}

export interface FeedItem {
  id: number;
  t: number;
  kind: 'join' | 'whale' | 'lead' | 'alert' | 'surge' | 'you' | 'trade' | 'holders' | 'score';
  tokenId?: TokenId;
  text: string;
}

export interface IntegrityEvent {
  id: number;
  tokenId: TokenId;
  t: number;
  kind: string;
  severity: 'alert' | 'info';
  title: string;
  detail: string;
  wallets: number;
  excludedUsd: number;
}

export interface ChatMessage {
  id: number;
  battleId: BattleId;
  wallet: string;
  text: string;
  army?: TokenId;
  deleted: boolean;
  t: number;
}

export interface SwapRecord {
  tx: string;
  battleId?: BattleId;
  wallet: string;
  tokenId: TokenId;
  side: TradeSide;
  solAmount: number;
  feeSol: number;
  verified: boolean;
  t: number;
}

/** Everything loaded lazily for one battle page. */
export interface BattleDetail {
  loaded: boolean;
  snapshots: Snapshot[];
  trades: Trade[];
  feed: FeedItem[];
  endChecks: EndCheck[];
  integrity: IntegrityEvent[];
  chat: ChatMessage[];
  swaps: SwapRecord[];
  watchers: number;
}

export interface TournamentMatch {
  id: string;
  round: number;
  slot: number;
  scoreA?: number;
  scoreB?: number;
  durationMs?: number;
  endedAt?: number;
  a?: TokenId;
  b?: TokenId;
  battleId?: BattleId;
  winner?: TokenId;
}

export interface Tournament {
  id: string;
  slug: string;
  name: string;
  tagline?: string;
  hue: number;
  size: 4 | 8;
  status: 'upcoming' | 'live' | 'completed';
  prizeNote?: string;
  rules: BattleRules;
  scheduledStart: number;
  startedAt?: number;
  endedAt?: number;
  champion?: TokenId;
  rounds: TournamentMatch[][];
}

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

export interface WalletState {
  connected: boolean;
  address?: string;
  provider?: string;
  /** Supabase session exists (Sign in with Solana) — needed to chat, list, challenge. */
  signedIn: boolean;
  solBalance: number | null;
  /** mint → ui amount */
  tokens: Record<string, { amount: number; decimals: number }>;
}

export interface Quote {
  side: TradeSide;
  tokenId: TokenId;
  inputAmount: number;
  outputAmount: number;
  priceImpact: number;
  minReceived: number;
  feeBps: number;
  route: string;
  raw: unknown;
}

export interface AppNotification {
  id: string;
  t: number;
  kind: 'challenge' | 'battle-start' | 'battle-end' | 'info';
  title: string;
  body: string;
  link?: string;
}
