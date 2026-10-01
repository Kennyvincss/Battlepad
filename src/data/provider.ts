import type {
  Battle, BattleId, BattleRecordEntry, BattleRules, Challenge, Creator, DataSource, Market, Notification, Quote,
  Token, TokenId, Trade, TradeSide, Wallet,
} from './types';

/**
 * The single seam between UI and data.
 *
 * The prototype ships `SimEngine` (src/sim/engine.ts), an in-browser simulation.
 * A production build would implement this interface on top of:
 *   - an indexer / websocket feed for markets, trades, holders & liquidity
 *   - the wallet adapter for balances, signing and sending swaps
 *   - the battle program for rules commitments, end checks and reward claims
 *   - a drand client for the public randomness used by end checks
 * Components only ever talk to this interface (via `useData()`), never to the
 * simulation directly.
 */
export interface BattleDataProvider {
  readonly source: DataSource;
  /** Monotonic version, bumped on every state change (drives re-renders). */
  readonly version: number;
  /** Current time in ms (sim clock or wall clock). */
  readonly now: number;

  readonly tokens: Record<TokenId, Token>;
  readonly markets: Record<TokenId, Market>;
  readonly creators: Record<string, Creator>;
  readonly battles: Battle[];
  readonly history: BattleRecordEntry[];
  readonly wallet: Wallet;
  readonly challenges: Challenge[];
  readonly notifications: Notification[];

  subscribe(cb: () => void): () => void;
  onEvent(cb: (e: EngineEvent) => void): () => void;

  getBattle(id: BattleId): Battle | undefined;
  battleForToken(tokenId: TokenId): Battle | undefined;

  quote(tokenId: TokenId, side: TradeSide, amount: number, slippage: number): Quote;
  executeTrade(req: TradeRequest): Promise<TradeResult>;

  connectWallet(provider: string): Promise<void>;
  disconnectWallet(): void;

  createToken(input: NewTokenInput): Token;
  createChallenge(input: NewChallengeInput): Challenge;
  respondChallenge(id: string, accept: boolean): void;
  markNotificationsRead(): void;
}

export interface TradeRequest {
  tokenId: TokenId;
  side: TradeSide;
  /** Quote (SOL) for buys, token amount for sells. */
  amount: number;
  slippage: number;
  minOut: number;
  battleId?: BattleId;
}

export type TradeResult =
  | { ok: true; trade: Trade; signature: string; joinedArmy?: TokenId }
  | { ok: false; error: string };

export interface NewTokenInput {
  name: string;
  ticker: string;
  logo: string;
  hue: number;
  description: string;
  socials: Token['socials'];
  initialBuyQuote: number;
  launchMode: 'battle' | 'normal';
}

export interface NewChallengeInput {
  fromTokenId: TokenId;
  toTokenId: TokenId;
  rules: BattleRules;
  message?: string;
}

export type EngineEvent =
  | { type: 'battle-start'; battleId: BattleId }
  | { type: 'battle-end'; battleId: BattleId; winner: TokenId }
  | { type: 'lead-change'; battleId: BattleId; leader: TokenId }
  | { type: 'integrity-alert'; battleId: BattleId; tokenId: TokenId }
  | { type: 'challenge-accepted'; challengeId: string; battleId: BattleId }
  | { type: 'toast'; title: string; body?: string; tone?: 'good' | 'bad' | 'info'; tokenId?: TokenId };
