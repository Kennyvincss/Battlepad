import type {
  Battle, BattleId, BattleRecordEntry, BattleRules, Challenge, ChatPrefs, Creator, DataSource, GlobalTreasury, Market,
  Notification, Quote, Token, TokenId, Tournament, Trade, TradeSide, Wallet,
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
  readonly tournaments: Tournament[];
  readonly treasury: GlobalTreasury;
  readonly chatPrefs: ChatPrefs;

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

  // Tournaments: every match is an ordinary Battle with `tournamentId` set.
  getTournament(id: string): Tournament | undefined;
  tournamentOf(b: Battle): Tournament | undefined;

  // Treasury: on-chain this would read the battle's treasury account.
  treasuryBalance(b: Battle): number;

  // Battle chat: production would use a websocket chat service with server-side moderation.
  postChat(battleId: BattleId, text: string): void;
  deleteChat(battleId: BattleId, msgId: string): void;
  reportChat(msgId: string): void;
  toggleMute(user: string): void;
  toggleBlock(user: string): void;
  setSpectating(battleId?: BattleId): void;
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
