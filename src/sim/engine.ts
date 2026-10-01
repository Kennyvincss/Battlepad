import type {
  Battle, BattleId, BattleRecordEntry, BattleRules, BattleSideState, BattleType, Challenge, ChatPrefs, Creator, EndCheck,
  FeedItem, GlobalTreasury, IntegrityEvent, IntegrityState, Market, Notification, Token, TokenId, Tournament,
  TournamentMatch, Trade, TradeSide, TreasuryEvent, Wallet,
} from '../data/types';
import type {
  BattleDataProvider, EngineEvent, NewChallengeInput, NewTokenInput, TradeRequest, TradeResult,
} from '../data/provider';
import { CREATORS, START_MCAP, TOKENS, USER_CREATOR_ID, generateHistory } from '../data/seed';
import { applySwap, liquidityQuote, quote as ammQuote, spotPrice } from '../lib/amm';
import { computeScores, emptyScore, holdFactor, leaderOf } from '../lib/score';
import { HOUR, MINUTE, makeRules, rulesHash } from '../lib/rules';
import { SimBeacon, endCheckValue } from '../lib/randomEnd';
import { fakeAddress, fakeHex, gauss } from '../lib/rng';
import { quoteToUsd, short } from '../lib/format';
import { POST_BATTLE_LINES, makeChatLine } from './chat';

const STEP_MS = 2000; // simulation resolution
const SAMPLE_MS = 5000; // price history resolution
const SCORE_SAMPLE_MS = 30_000;
const MAX_TRADES = 400;
const MAX_FEED = 160;
const MAX_CHAT = 150;
/** Share of each swap fee routed to the live battle's treasury (rest stays with LPs). */
export const TREASURY_FEE_SHARE = 0.3;
const ROUND_NAMES: Record<number, string[]> = { 2: ['Semifinal', 'Final'], 3: ['Quarterfinal', 'Semifinal', 'Final'] };
export const roundName = (t: Tournament, r: number) => ROUND_NAMES[t.rounds.length]?.[r] ?? `Round ${r + 1}`;

const rnd = Math.random;
const poisson = (lambda: number) => {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do { k++; p *= rnd(); } while (p > L && k < 50);
  return k - 1;
};

interface SideRuntime {
  wallets: string[];
  lastSample: number;
  bucketVol: number;
  surgeUntil: number;
  surgeBoost: number;
  nextSuspicious: number;
  nextSurge: number;
  holderMilestone: number;
}

/**
 * In-browser battle simulation implementing `BattleDataProvider`.
 * All values produced here are SIMULATED and labelled as such in the UI.
 */
export class SimEngine implements BattleDataProvider {
  readonly source = 'simulated' as const;
  version = 0;
  now: number;
  speed = 1;

  tokens: Record<TokenId, Token> = {};
  markets: Record<TokenId, Market> = {};
  creators: Record<string, Creator> = {};
  battles: Battle[] = [];
  history: BattleRecordEntry[] = [];
  challenges: Challenge[] = [];
  notifications: Notification[] = [];
  wallet: Wallet;
  readonly beacon: SimBeacon;

  private sentiment: Record<TokenId, number> = {};
  private side = new Map<string, SideRuntime>();
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(e: EngineEvent) => void>();
  private timer?: ReturnType<typeof setInterval>;
  private last = 0;
  private silent = false;
  private idn = 0;
  private lastLeadEvent = new Map<BattleId, number>();
  private lastScoreAnnounce = new Map<BattleId, [number, number]>();
  private battleSeq = 183;
  private ffEnd = 0;
  private lastGrowthSample = 0;

  tournaments: Tournament[] = [];
  treasury: GlobalTreasury = { platformQuote: 0, winnerSupportQuote: 0, holderRewardsQuote: 0, tournamentPrizesQuote: 0, events: [], growth: [] };
  chatPrefs: ChatPrefs = { muted: new Set(), blocked: new Set(), reported: new Set() };
  /** Battle the user is watching in spectator mode (counted in the watcher number). */
  spectating?: BattleId;

  constructor() {
    const realNow = Date.now();
    const ff = 82 * MINUTE; // how far back the simulated world starts
    this.now = realNow - ff;
    this.ffEnd = realNow;
    this.beacon = new SimBeacon(realNow - 400 * 24 * HOUR, 3000, fakeHex(rnd, 32));

    for (const t of TOKENS) {
      this.tokens[t.id] = { ...t };
      this.markets[t.id] = this.makeMarket(t.id, START_MCAP[t.id] ?? 1500);
      this.sentiment[t.id] = gauss(rnd) * 0.4;
    }
    for (const c of CREATORS) this.creators[c.id] = structuredClone(c);
    this.history = generateHistory();
    this.seedCompletedTournament('Genesis Cup', 'The first bracket ever fought on BATTLE.', 280, ['shark', 'moon', 'dragon', 'tiger'], 900, realNow - 6.5 * 24 * HOUR);
    this.seedCompletedTournament('Deep Sea Open', 'Eight armies from the deep.', 200, ['octo', 'crab', 'otter', 'turtle', 'croc', 'peng', 'parrot', 'snail'], 1500, realNow - 2.2 * 24 * HOUR);
    this.applyHistoryToCreators();
    this.seedTreasuryFromHistory();

    this.wallet = {
      connected: false,
      address: fakeAddress(rnd),
      quoteBalance: 24.6,
      positions: { owl: { tokenId: 'owl', amount: 18_000_000, costQuote: 9.5 } },
      trades: [],
      loyalty: {},
      armies: {},
      claimedRewardsQuote: 1.84,
      loyaltyPoints: 4210,
    };
    this.markets.owl.holders = 612;

    // Live battles, started in the (simulated) past – fast-forwarded below.
    // Live tournament: its quarterfinals are ordinary live battles (FROG vs CAT is the headline match).
    const apex = this.createTournament({
      name: 'Apex Cup', tagline: 'Eight armies. One champion.', hue: 45, prize: 1200,
      tokens: ['frog', 'cat', 'wolf', 'fox', 'lion', 'bee', 'uni', 'whale'], start: realNow - 68 * MINUTE,
      matchStarts: [realNow - 56 * MINUTE, realNow - 68 * MINUTE, realNow - 49 * MINUTE, realNow - 33 * MINUTE], featuredSlot: 0,
    });
    const featured = this.getBattle(apex.rounds[0][0].battleId!)!;
    this.createTournament({ name: 'Night Owl Invitational', tagline: 'Four night-shift armies, one bracket.', hue: 268, prize: 600, tokens: ['owl', 'ghost', 'bat', 'skull'], start: realNow + 48 * MINUTE });
    this.createTournament({ name: 'Sky Series', tagline: 'High-flying tokens, eight-way bracket.', hue: 200, prize: 1600, tokens: ['eagle', 'rocket', 'robot', 'alien', 'gem', 'bolt', 'koala', 'panda'], start: realNow + 3 * HOUR });
    const LIVE: [string, string, number, BattleType?][] = [
      ['shark', 'octo', 63, 'blitz'], ['ape', 'tiger', 41], ['panda', 'eagle', 23, 'marathon'],
      ['croc', 'peng', 17, 'blitz'], ['sloth', 'otter', 61],
      ['koala', 'bat', 38], ['crab', 'snail', 12], ['turtle', 'parrot', 52, 'marathon'], ['robot', 'alien', 29],
      ['pizza', 'rocket', 44], ['gem', 'bolt', 66], ['mush', 'cactus', 9, 'blitz'],
    ];
    for (const [a, b, ago, type] of LIVE) this.createBattle(a, b, makeRules({ type, rewardPoolQuote: 100 + Math.round(rnd() * 15) * 10 }), realNow - ago * MINUTE);
    // Upcoming
    this.createBattle('dog', 'bull', makeRules(), realNow + 6 * MINUTE);
    this.createBattle('moon', 'dragon', makeRules({ type: 'blitz', rewardPoolQuote: 220 }), realNow + 14 * MINUTE);
    this.createBattle('skull', 'rhino', makeRules(), realNow + 22 * MINUTE);
    this.createBattle('bear', 'pepe', makeRules({ minDurationMs: 2 * HOUR }), realNow + 31 * MINUTE);

    // Incoming challenge for the user's token.
    this.challenges.push({
      id: 'ch-ghost-owl', fromTokenId: 'ghost', toTokenId: 'owl', createdAt: realNow - 4 * MINUTE,
      rules: makeRules({ rewardPoolQuote: 120 }), status: 'pending', incoming: true,
      message: 'Night birds fear ghosts. Accept if you dare. 👻',
    });
    this.notify({ kind: 'challenge', title: '⚔️ BATTLE CHALLENGE', body: '$GHOST has challenged $OWL.', challengeId: 'ch-ghost-owl', t: realNow - 4 * MINUTE });

    // Fast-forward the world to "now". The user's demo wallet buys FROG 14m into the featured battle.
    this.silent = true;
    let userBought = false;
    while (this.now < realNow) {
      this.step(Math.min(STEP_MS, realNow - this.now));
      if (!userBought && featured.startedAt && this.now - featured.startedAt > 14 * MINUTE) {
        userBought = true;
        this.settleUserTrade({ tokenId: 'frog', side: 'buy', amount: 1.62, slippage: 0.05, minOut: 0, battleId: featured.id });
      }
    }
    this.silent = false;
    this.notifications.forEach((n) => { if (n.kind !== 'challenge') n.read = true; });
  }

  /* ================================================================ public API */

  subscribe(cb: () => void) {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  onEvent(cb: (e: EngineEvent) => void) {
    this.eventListeners.add(cb);
    return () => { this.eventListeners.delete(cb); };
  }

  start() {
    if (this.timer) return;
    this.last = performance.now();
    this.timer = setInterval(() => {
      const t = performance.now();
      let dt = Math.min(5000, t - this.last) * this.speed;
      this.last = t;
      while (dt > 0) {
        const s = Math.min(STEP_MS, dt);
        this.step(s);
        dt -= s;
      }
      this.bump();
    }, 400);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  setSpeed(s: number) {
    this.speed = s;
    this.bump();
  }

  getBattle(id: BattleId) {
    return this.battles.find((b) => b.id === id);
  }

  battleForToken(tokenId: TokenId) {
    const mine = this.battles.filter((b) => b.a.tokenId === tokenId || b.b.tokenId === tokenId);
    return mine.find((b) => b.status === 'live') ?? mine.find((b) => b.status === 'scheduled') ?? mine.at(-1);
  }

  quote(tokenId: TokenId, side: TradeSide, amount: number, slippage: number) {
    return ammQuote(this.markets[tokenId], side, amount, slippage);
  }

  async executeTrade(req: TradeRequest): Promise<TradeResult> {
    if (!this.wallet.connected) return { ok: false, error: 'Connect a wallet to trade.' };
    await new Promise((r) => setTimeout(r, 650 + rnd() * 600)); // simulated confirmation latency
    const res = this.settleUserTrade(req);
    this.bump();
    return res;
  }

  async connectWallet(provider: string) {
    await new Promise((r) => setTimeout(r, 700));
    this.wallet.connected = true;
    this.wallet.provider = provider;
    this.bump();
  }

  disconnectWallet() {
    this.wallet.connected = false;
    this.bump();
  }

  createToken(input: NewTokenInput): Token {
    let id = input.ticker.toLowerCase().replace(/[^a-z0-9]/g, '') || `tkn${++this.idn}`;
    while (this.tokens[id]) id += 'x';
    const token: Token = {
      id, name: input.name, ticker: input.ticker.toUpperCase(), logo: input.logo || '✨', hue: input.hue,
      description: input.description, creatorId: USER_CREATOR_ID, mint: fakeAddress(rnd), totalSupply: 1_000_000_000,
      createdAt: this.now, socials: input.socials, launchMode: input.launchMode,
    };
    this.tokens[id] = token;
    this.markets[id] = this.makeMarket(id, 420);
    this.markets[id].holders = 1;
    this.sentiment[id] = 0.2;
    const you = this.creators[USER_CREATOR_ID];
    you.history.tokensLaunched++;
    you.history.tokensActive30d++;
    if (input.initialBuyQuote > 0 && this.wallet.quoteBalance >= input.initialBuyQuote) {
      this.settleUserTrade({ tokenId: id, side: 'buy', amount: input.initialBuyQuote, slippage: 0.1, minOut: 0 });
    }
    this.notify({ kind: 'info', title: `$${token.ticker} launched`, body: input.launchMode === 'battle' ? 'Ready for battle. Pick an opponent.' : 'Trading is live.', link: `/token/${id}` });
    this.bump();
    return token;
  }

  createChallenge(input: NewChallengeInput): Challenge {
    const ch: Challenge = {
      id: `ch-${++this.idn}`, fromTokenId: input.fromTokenId, toTokenId: input.toTokenId, createdAt: this.now,
      rules: input.rules, status: 'pending', incoming: false, message: input.message,
    };
    this.challenges.unshift(ch);
    const battle = this.createBattle(input.fromTokenId, input.toTokenId, input.rules, this.now + 12 * MINUTE, { status: 'pending' });
    const from = this.tokens[input.fromTokenId];
    const to = this.tokens[input.toTokenId];
    // Simulated opponent response.
    setTimeout(() => {
      ch.status = 'accepted';
      battle.status = 'scheduled';
      battle.scheduledStart = this.now + 3 * MINUTE;
      this.notify({ kind: 'battle-start', title: '⚔️ CHALLENGE ACCEPTED', body: `$${to.ticker} accepted $${from.ticker}'s challenge. Rules are locked at start.`, link: `/battle/${battle.id}` });
      this.emit({ type: 'challenge-accepted', challengeId: ch.id, battleId: battle.id });
      this.emit({ type: 'toast', title: '⚔️ Challenge accepted', body: `$${from.ticker} vs $${to.ticker} is scheduled.`, tone: 'good' });
      this.bump();
    }, 6000);
    this.bump();
    return ch;
  }

  respondChallenge(id: string, accept: boolean) {
    const ch = this.challenges.find((c) => c.id === id);
    if (!ch || ch.status !== 'pending') return;
    ch.status = accept ? 'accepted' : 'declined';
    if (accept) {
      const b = this.createBattle(ch.fromTokenId, ch.toTokenId, ch.rules, this.now + 5 * MINUTE);
      this.emit({ type: 'challenge-accepted', challengeId: ch.id, battleId: b.id });
      this.emit({ type: 'toast', title: '⚔️ Battle scheduled', body: `$${this.tokens[ch.fromTokenId].ticker} vs $${this.tokens[ch.toTokenId].ticker}. Rules are now locked.`, tone: 'good' });
    }
    this.bump();
  }

  markNotificationsRead() {
    this.notifications.forEach((n) => (n.read = true));
    this.bump();
  }

  /* ----------------------------------------------------------- derived helpers */

  liveBattles() { return this.battles.filter((b) => b.status === 'live'); }
  upcomingBattles() { return this.battles.filter((b) => b.status === 'scheduled' || b.status === 'pending').sort((x, y) => x.scheduledStart - y.scheduledStart); }
  endedBattles() { return this.battles.filter((b) => b.status === 'ended').sort((x, y) => (y.endedAt ?? 0) - (x.endedAt ?? 0)); }

  elapsed(b: Battle) {
    if (!b.startedAt) return 0;
    return (b.endedAt ?? this.now) - b.startedAt;
  }

  recordFor(tokenId: TokenId) {
    const entries = this.history.filter((h) => h.tokenId === tokenId).sort((a, b) => b.endedAt - a.endedAt);
    const wins = entries.filter((e) => e.won).length;
    let streak = 0;
    for (const e of entries) { if (e.won) streak++; else break; }
    let best = 0;
    let run = 0;
    for (const e of [...entries].reverse()) { run = e.won ? run + 1 : 0; best = Math.max(best, run); }
    return { entries, wins, losses: entries.length - wins, streak, best };
  }

  /** Estimated Battle Loyalty for the user in a battle (SIMULATED estimate). */
  loyaltyFor(b: Battle, tokenId: TokenId) {
    const l = this.wallet.loyalty[`${b.id}:${tokenId}`];
    const pos = this.wallet.positions[tokenId];
    const side = b.a.tokenId === tokenId ? b.a : b.b;
    const m = this.markets[tokenId];
    const heldQuote = (pos?.amount ?? 0) * m.price;
    if (!l) return { heldQuote, heldMs: 0, factor: 0, share: 0, estRewardQuote: 0, weight: 0 };
    const factor = holdFactor(pos?.amount ?? 0, l.peakAmount);
    const weight = l.weightedQuoteMs * factor;
    const share = side.circulatingQuoteMs > 0 ? Math.min(1, weight / side.circulatingQuoteMs) : 0;
    const pool = this.treasuryBalance(b) * b.rules.rewardSplit.holderRewards;
    return { heldQuote, heldMs: l.heldMs, factor, share, estRewardQuote: share * pool, weight };
  }

  /* ------------------------------------------------------------ treasury */

  treasuryBalance(b: Battle) {
    return b.treasury.fundedQuote + b.treasury.feesQuote;
  }

  distributedTotal() {
    const g = this.treasury;
    return g.platformQuote + g.winnerSupportQuote + g.holderRewardsQuote + g.tournamentPrizesQuote;
  }

  /** Locked in live / upcoming battle treasuries right now. */
  lockedTotal() {
    return this.battles.filter((b) => !b.treasury.distributed && b.status !== 'pending').reduce((s, b) => s + this.treasuryBalance(b), 0);
  }

  private globalEvent(e: Omit<TreasuryEvent, 'id'>) {
    this.treasury.events.unshift({ id: `ge${++this.idn}`, ...e });
    if (this.treasury.events.length > 120) this.treasury.events.length = 120;
  }

  private distributeTreasury(b: Battle) {
    if (b.treasury.distributed) return;
    const tr = b.treasury;
    if (tr.pendingFeesQuote > 0) {
      tr.events.push({ id: `te${++this.idn}`, t: this.now, battleId: b.id, kind: 'fees', amountQuote: tr.pendingFeesQuote, text: `+${tr.pendingFeesQuote.toFixed(3)} SOL final swap-fee sweep` });
      tr.pendingFeesQuote = 0;
    }
    const bal = this.treasuryBalance(b);
    const sp = b.rules.rewardSplit;
    const w = this.tokens[b.winner!];
    const holders = b.final ? (b.winner === b.a.tokenId ? b.final.holdersA : b.final.holdersB) : 0;
    const parts: [TreasuryEvent['kind'], number, string][] = [
      ['winner', bal * sp.winnerLiquidity, `Winner liquidity support → $${w.ticker} pool`],
      ['holders', bal * sp.holderRewards, `Battle Loyalty rewards → ${holders.toLocaleString('en-US')} eligible $${w.ticker} holders (weighted)`],
      ['platform', bal * sp.platform, 'Platform / ecosystem allocation'],
    ];
    for (const [kind, amt, text] of parts) {
      tr.events.push({ id: `te${++this.idn}`, t: this.now, battleId: b.id, kind, amountQuote: amt, text });
      this.globalEvent({ t: this.now, battleId: b.id, kind, amountQuote: amt, text: `#${b.number} ${text}` });
    }
    this.treasury.winnerSupportQuote += bal * sp.winnerLiquidity;
    this.treasury.holderRewardsQuote += bal * sp.holderRewards;
    this.treasury.platformQuote += bal * sp.platform;
    tr.history.push({ t: b.final?.durationMs ?? 0, balance: 0 });
    tr.distributed = true;
  }

  /** Simulated history of past distributions, derived from the archived battle results. */
  private seedTreasuryFromHistory() {
    const seen = new Set<string>();
    const past = this.history.filter((h) => h.won && !seen.has(h.battleId) && seen.add(h.battleId)).sort((a, b) => a.endedAt - b.endedAt);
    let cum = 0;
    past.forEach((h, i) => {
      const bal = 100 + ((h.battleId.charCodeAt(h.battleId.length - 1) * 7) % 16) * 10 + 4 + (i % 9) * 2.3;
      const w = this.tokens[h.tokenId];
      this.treasury.winnerSupportQuote += bal * 0.5;
      this.treasury.holderRewardsQuote += bal * 0.25;
      this.treasury.platformQuote += bal * 0.25;
      cum += bal;
      this.treasury.growth.push({ t: h.endedAt, cumulative: cum + this.treasury.tournamentPrizesQuote });
      if (i >= past.length - 18) {
        this.globalEvent({ t: h.endedAt, kind: 'winner', amountQuote: bal * 0.5, text: `$${w.ticker} def. $${this.tokens[h.opponentId].ticker} — winner liquidity support` });
        this.globalEvent({ t: h.endedAt + 1, kind: 'holders', amountQuote: bal * 0.25, text: `$${w.ticker} holder rewards distributed` });
      }
    });
    this.treasury.events.sort((a, b) => b.t - a.t);
    this.treasury.growth.sort((a, b) => a.t - b.t);
  }

  /* ---------------------------------------------------------- tournaments */

  getTournament(id: string) {
    return this.tournaments.find((t) => t.id === id);
  }

  tournamentOf(b: Battle) {
    return b.tournamentId ? this.getTournament(b.tournamentId) : undefined;
  }

  matchOf(b: Battle): TournamentMatch | undefined {
    const t = this.tournamentOf(b);
    return t?.rounds.flat().find((m) => m.id === b.matchId);
  }

  currentRound(t: Tournament) {
    if (t.status === 'completed') return t.rounds.length - 1;
    const i = t.rounds.findIndex((r) => r.some((m) => !m.winner));
    return i < 0 ? t.rounds.length - 1 : i;
  }

  /** Token is still alive in an upcoming or live tournament. */
  private inActiveTournament(tokenId: TokenId) {
    return this.tournaments.some((t) => t.status !== 'completed' && t.rounds[0].some((m) => m.a === tokenId || m.b === tokenId)
      && !t.rounds.flat().some((m) => m.winner && (m.a === tokenId || m.b === tokenId) && m.winner !== tokenId));
  }

  private tokenBusyElsewhere(b: Battle) {
    return this.battles.some((x) => x !== b && x.status === 'live' && [x.a.tokenId, x.b.tokenId].some((t) => t === b.a.tokenId || t === b.b.tokenId));
  }

  createTournament(o: { name: string; tagline: string; hue: number; prize: number; tokens: TokenId[]; start: number; matchStarts?: number[]; featuredSlot?: number }) {
    const size = o.tokens.length as 4 | 8;
    const nRounds = size === 8 ? 3 : 2;
    const id = `t-${o.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const rounds: TournamentMatch[][] = [];
    for (let r = 0; r < nRounds; r++) {
      const count = size / 2 ** (r + 1);
      rounds.push(Array.from({ length: count }, (_, slot) => ({
        id: `${id}-r${r}-m${slot}`, round: r, slot,
        a: r === 0 ? o.tokens[slot * 2] : undefined, b: r === 0 ? o.tokens[slot * 2 + 1] : undefined,
      })));
    }
    const t: Tournament = {
      id, name: o.name, tagline: o.tagline, hue: o.hue, size, status: 'upcoming', prizePoolQuote: o.prize,
      scheduledStart: o.start, rounds, rules: makeRules({ rewardPoolQuote: Math.round(o.prize / (size - 1) / 10) * 10 }),
    };
    this.tournaments.push(t);
    if (o.matchStarts) {
      t.status = 'live';
      t.startedAt = o.start;
      rounds[0].forEach((m, i) => this.createMatchBattle(t, m, o.matchStarts![i], i === o.featuredSlot));
    }
    return t;
  }

  private createMatchBattle(t: Tournament, m: TournamentMatch, start: number, featured = false) {
    const b = this.createBattle(m.a!, m.b!, t.rules, start, { tournamentId: t.id, matchId: m.id, featured });
    m.battleId = b.id;
    return b;
  }

  private startTournament(t: Tournament) {
    t.status = 'live';
    t.startedAt = this.now;
    t.rounds[0].forEach((m, i) => this.createMatchBattle(t, m, this.now + (2 + i * 2) * MINUTE));
    this.notify({ kind: 'battle-start', title: '🏆 TOURNAMENT LIVE', body: `${t.name} has started — ${t.size} tokens, ${t.rounds.length} rounds.`, link: `/tournament/${t.id}` });
    this.emit({ type: 'toast', title: `🏆 ${t.name} has started`, body: `${roundName(t, 0)}s are scheduled.`, tone: 'info' });
  }

  private advanceTournament(b: Battle) {
    const t = this.tournamentOf(b);
    const m = this.matchOf(b);
    if (!t || !m || !b.final) return;
    m.winner = b.winner;
    m.scoreA = b.final.scoreA.total;
    m.scoreB = b.final.scoreB.total;
    m.durationMs = b.final.durationMs;
    m.endedAt = b.endedAt;
    const w = this.tokens[b.winner!];
    const next = t.rounds[m.round + 1];
    if (!next) {
      t.status = 'completed';
      t.endedAt = this.now;
      t.champion = b.winner;
      this.treasury.tournamentPrizesQuote += t.prizePoolQuote;
      this.globalEvent({ t: this.now, tournamentId: t.id, kind: 'tournament', amountQuote: t.prizePoolQuote, text: `${t.name} prize pool paid — champion $${w.ticker}` });
      this.notify({ kind: 'battle-end', title: '🏆 TOURNAMENT CHAMPION', body: `${w.logo} $${w.ticker} won ${t.name}.`, link: `/tournament/${t.id}` });
      this.emit({ type: 'toast', title: `🏆 ${w.logo} $${w.ticker} is the ${t.name} champion`, tone: 'good' });
      return;
    }
    const nm = next[Math.floor(m.slot / 2)];
    if (m.slot % 2 === 0) nm.a = b.winner; else nm.b = b.winner;
    this.emit({ type: 'toast', title: `🏆 ${t.name}: $${w.ticker} advances`, body: `Into the ${roundName(t, m.round + 1).toLowerCase()}.`, tone: 'info' });
    if (nm.a && nm.b && !nm.battleId) {
      this.createMatchBattle(t, nm, this.now + 4 * MINUTE);
    }
  }

  /** Completed (archived) tournament with simulated results; also written into battle history. */
  private seedCompletedTournament(name: string, tagline: string, hue: number, tokens: TokenId[], prize: number, endedAt: number) {
    const t = this.createTournament({ name, tagline, hue, prize, tokens, start: endedAt - tokens.length * 0.9 * HOUR });
    t.status = 'completed';
    t.startedAt = t.scheduledStart;
    t.endedAt = endedAt;
    const rounds = t.rounds.length;
    t.rounds.forEach((round, r) => {
      round.forEach((m) => {
        if (r > 0) {
          m.a = t.rounds[r - 1][m.slot * 2].winner;
          m.b = t.rounds[r - 1][m.slot * 2 + 1].winner;
        }
        const aWins = rnd() < 0.5;
        const win = 64 + rnd() * 16;
        const lose = win - (1 + rnd() * 13);
        m.winner = aWins ? m.a : m.b;
        m.scoreA = aWins ? win : lose;
        m.scoreB = aWins ? lose : win;
        m.durationMs = HOUR + Math.floor(rnd() * 80) * MINUTE;
        m.endedAt = endedAt - (rounds - 1 - r) * 2.5 * HOUR - m.slot * 20 * MINUTE;
        const bid = `${m.id}-h`;
        this.history.push(
          { battleId: bid, tokenId: m.a!, opponentId: m.b!, won: aWins, scoreFor: m.scoreA, scoreAgainst: m.scoreB, durationMs: m.durationMs, endedAt: m.endedAt },
          { battleId: bid, tokenId: m.b!, opponentId: m.a!, won: !aWins, scoreFor: m.scoreB, scoreAgainst: m.scoreA, durationMs: m.durationMs, endedAt: m.endedAt },
        );
      });
    });
    t.champion = t.rounds[rounds - 1][0].winner;
    this.treasury.tournamentPrizesQuote += prize;
    this.globalEvent({ t: endedAt, tournamentId: t.id, kind: 'tournament', amountQuote: prize, text: `${name} prize pool paid — champion $${this.tokens[t.champion!].ticker}` });
    this.history.sort((a, b) => a.endedAt - b.endedAt);
  }

  /* ------------------------------------------------------------------ chat */

  postChat(battleId: BattleId, text: string) {
    const b = this.getBattle(battleId);
    const clean = text.trim().slice(0, 280);
    if (!b || !clean) return;
    this.pushChat(b, { user: 'you', avatar: '🫵', text: clean, mine: true, army: this.wallet.armies[battleId] });
    this.bump();
  }

  deleteChat(battleId: BattleId, msgId: string) {
    const m = this.getBattle(battleId)?.chat.find((x) => x.id === msgId);
    if (m?.mine) { m.deleted = true; this.bump(); }
  }

  reportChat(msgId: string) {
    this.chatPrefs.reported.add(msgId);
    this.emit({ type: 'toast', title: 'Message reported', body: 'Hidden for you and sent to moderators (simulated).', tone: 'info' });
    this.bump();
  }

  toggleMute(user: string) {
    const s = this.chatPrefs.muted;
    if (s.has(user)) s.delete(user); else s.add(user);
    this.bump();
  }

  toggleBlock(user: string) {
    const s = this.chatPrefs.blocked;
    if (s.has(user)) s.delete(user); else s.add(user);
    this.bump();
  }

  setSpectating(battleId?: BattleId) {
    this.spectating = battleId;
    this.bump();
  }

  /* ================================================================ internals */

  private bump() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  private emit(e: EngineEvent) {
    if (this.silent) return;
    this.eventListeners.forEach((l) => l(e));
  }

  private notify(n: Omit<Notification, 'id' | 't' | 'read'> & { t?: number }) {
    this.notifications.unshift({ id: `n${++this.idn}`, t: n.t ?? this.now, read: false, ...n });
    this.notifications = this.notifications.slice(0, 40);
  }

  /** Per-battle trading intensity (trades/s per side), stable for the battle's lifetime. */
  private activityLevel = new Map<BattleId, number>();
  private activity(b: Battle) {
    let a = this.activityLevel.get(b.id);
    if (a === undefined) {
      a = b.featured ? 0.4 : 0.14 + rnd() * 0.24;
      this.activityLevel.set(b.id, a);
    }
    return a;
  }

  private makeMarket(tokenId: TokenId, mcapQuote: number): Market {
    const price = mcapQuote / 1_000_000_000;
    const reserveQuote = Math.max(40, mcapQuote * 0.16);
    return {
      tokenId, reserveQuote, reserveToken: reserveQuote / price, price,
      holders: Math.round(600 + mcapQuote * (0.5 + rnd() * 0.5)), volumeQuote: mcapQuote * (0.4 + rnd()), feeRate: 0.01,
    };
  }

  private applyHistoryToCreators() {
    for (const h of this.history) {
      const c = this.creators[this.tokens[h.tokenId]?.creatorId];
      if (!c) continue;
      c.history.battlesCompleted++;
      c.history.totalBattleParticipants += 400 + Math.round(rnd() * 1400);
      if (rnd() < 0.12) c.history.battlesWithIntegrityAlerts++;
    }
  }

  private newSide(tokenId: TokenId): BattleSideState {
    return {
      tokenId, startPrice: this.markets[tokenId].price, startHolders: 0, startLiquidityQuote: 0, startMarketCapQuote: 0,
      history: [], buyers: new Set(), sellers: new Set(), battleVolumeQuote: 0, flaggedVolumeQuote: 0,
      battleHolders: new Map(), twAccumulator: 0, twTime: 0, circulatingQuoteMs: 0, score: emptyScore(),
    };
  }

  createBattle(aId: TokenId, bId: TokenId, rules: BattleRules, scheduledStart: number, opts: { featured?: boolean; status?: Battle['status']; tournamentId?: string; matchId?: string } = {}) {
    const id = `${aId}-vs-${bId}-${(++this.idn).toString(36)}`;
    const hash = rulesHash(rules, aId, bId);
    const mkIntegrity = (): IntegrityState => ({ score: 100, events: [], flaggedWallets: new Set() });
    const b: Battle = {
      id, a: this.newSide(aId), b: this.newSide(bId), status: opts.status ?? 'scheduled', rules,
      commitment: { battleId: id, rulesHash: hash, startRound: 0, committedAt: this.now },
      scheduledStart, challengerId: aId, createdBy: this.tokens[aId].creatorId, endChecks: [],
      integrity: { [aId]: mkIntegrity(), [bId]: mkIntegrity() }, leadChanges: [], trades: [], scoreHistory: [],
      feed: [], traders: new Set(), featured: opts.featured,
      number: ++this.battleSeq, tournamentId: opts.tournamentId, matchId: opts.matchId,
      treasury: { fundedQuote: rules.rewardPoolQuote, feesQuote: 0, pendingFeesQuote: 0, distributed: false, events: [], history: [] },
      chat: [], spectators: 0,
    };
    b.treasury.events.push({
      id: `te${++this.idn}`, t: this.now, battleId: id, kind: 'fund', amountQuote: rules.rewardPoolQuote,
      text: `Treasury funded with ${rules.rewardPoolQuote.toFixed(0)} SOL (creator stakes + launchpad) and locked`,
    });
    this.battles.push(b);
    return b;
  }

  private startBattle(b: Battle) {
    b.status = 'live';
    b.startedAt = b.scheduledStart;
    b.commitment.startRound = this.beacon.roundAfter(b.startedAt);
    for (const s of [b.a, b.b]) {
      const m = this.markets[s.tokenId];
      s.startPrice = m.price;
      s.startHolders = m.holders;
      s.startLiquidityQuote = liquidityQuote(m);
      s.startMarketCapQuote = m.price * this.tokens[s.tokenId].totalSupply;
      s.history.push({ t: b.startedAt, price: m.price, volume: 0 });
      this.side.set(`${b.id}:${s.tokenId}`, {
        wallets: [], lastSample: b.startedAt, bucketVol: 0, surgeUntil: 0, surgeBoost: 1,
        nextSuspicious: b.startedAt + (10 + rnd() * 50) * MINUTE, nextSurge: b.startedAt + (4 + rnd() * 30) * MINUTE, holderMilestone: 0,
      });
    }
    const [sa, sb] = this.scoreCtx(b);
    [b.a.score, b.b.score] = computeScores(b.rules, sa, sb);
    b.leadChanges.push({ t: 0, leader: leaderOf(b) });
    b.treasury.history.push({ t: 0, balance: this.treasuryBalance(b) });
    this.lastScoreAnnounce.set(b.id, [Math.round(b.a.score.total), Math.round(b.b.score.total)]);
    this.pushFeed(b, { kind: 'lead', text: `⚔️ Battle started. Rules locked · commitment ${b.commitment.rulesHash.slice(0, 10)}…` });
    if (!this.silent) {
      const ta = this.tokens[b.a.tokenId];
      const tb = this.tokens[b.b.tokenId];
      this.notify({ kind: 'battle-start', title: '⚔️ LIVE BATTLE', body: `$${ta.ticker} vs $${tb.ticker} has started.`, link: `/battle/${b.id}` });
      this.emit({ type: 'battle-start', battleId: b.id });
      this.emit({ type: 'toast', title: `⚔️ ${ta.logo} $${ta.ticker} vs ${tb.logo} $${tb.ticker}`, body: 'A new battle is live.', tone: 'info' });
    }
  }

  private scoreCtx(b: Battle) {
    const mk = (s: BattleSideState) => {
      const integ = b.integrity[s.tokenId];
      let flaggedHolders = 0;
      integ.flaggedWallets.forEach((w) => { if ((s.battleHolders.get(w) ?? 0) > 0) flaggedHolders++; });
      return { side: s, market: this.markets[s.tokenId], token: this.tokens[s.tokenId], flaggedHolders };
    };
    return [mk(b.a), mk(b.b)] as const;
  }

  /** Advance the world by dt ms. */
  private step(dt: number) {
    this.now += dt;
    for (const b of this.battles) {
      if (b.status === 'scheduled' && this.now >= b.scheduledStart) {
        // Tournament matches wait until both tokens are free of other live battles.
        if (b.tournamentId && this.tokenBusyElsewhere(b)) b.scheduledStart = this.now + MINUTE;
        else this.startBattle(b);
      }
      if (b.status === 'live') this.stepLive(b, dt);
      else if (b.status === 'ended' && b.startedAt) this.stepPost(b, dt);
    }
    // idle drift for tokens not in a battle
    for (const id in this.sentiment) {
      const s = this.sentiment[id];
      this.sentiment[id] = s - s * (dt / 600_000) + 0.035 * Math.sqrt(dt / 1000) * gauss(rnd);
    }
    for (const t of this.tournaments) if (t.status === 'upcoming' && this.now >= t.scheduledStart) this.startTournament(t);
    if (this.now - this.lastGrowthSample >= 10 * MINUTE) {
      this.lastGrowthSample = this.now;
      this.treasury.growth.push({ t: this.now, cumulative: this.distributedTotal() });
    }
    this.keepPipelineFull();
  }

  private stepLive(b: Battle, dt: number) {
    const elapsed = this.now - (b.startedAt ?? this.now);
    const tension = elapsed > b.rules.randomEnd.minDurationMs ? 1.35 : 1;
    const base = this.activity(b);
    for (const s of [b.a, b.b]) {
      const rt = this.side.get(`${b.id}:${s.tokenId}`)!;
      this.maybeIntegrityEvents(b, s, rt);
      const boost = this.now < rt.surgeUntil ? rt.surgeBoost : 1;
      const n = poisson(base * tension * boost * (dt / 1000));
      for (let i = 0; i < n; i++) this.botTrade(b, s, rt, boost > 1);
      this.sample(b, s, rt, dt);
    }
    // Scores are cheap but not free; during the silent fast-forward compute them every 10s.
    if (!this.silent || elapsed % 10_000 < dt) {
      const [ca, cb] = this.scoreCtx(b);
      [b.a.score, b.b.score] = computeScores(b.rules, ca, cb);
    }

    const last = b.scoreHistory.at(-1);
    if (!last || elapsed - last.t >= SCORE_SAMPLE_MS) b.scoreHistory.push({ t: elapsed, a: b.a.score.total, b: b.b.score.total });

    // lead changes (with a small hysteresis so noise doesn't spam)
    const leader = b.leadChanges.at(-1)?.leader;
    const diff = b.a.score.total - b.b.score.total;
    const newLeader = diff > 0.15 ? b.a.tokenId : diff < -0.15 ? b.b.tokenId : leader;
    if (newLeader && newLeader !== leader) {
      b.leadChanges.push({ t: elapsed, leader: newLeader });
      const tk = this.tokens[newLeader];
      this.pushFeed(b, { kind: 'lead', tokenId: newLeader, text: `${tk.logo} $${tk.ticker} takes the lead` });
      const lastEv = this.lastLeadEvent.get(b.id) ?? 0;
      if (this.now - lastEv > 20_000) {
        this.lastLeadEvent.set(b.id, this.now);
        this.emit({ type: 'lead-change', battleId: b.id, leader: newLeader });
      }
    }

    this.liveExtras(b, elapsed, dt);
    this.accrueLoyalty(b, dt);
    this.runEndChecks(b);
  }

  /** Spectators, notable-moment feed items, simulated chat and treasury bookkeeping. */
  private liveExtras(b: Battle, elapsed: number, dt: number) {
    const ta = this.tokens[b.a.tokenId];
    const tb = this.tokens[b.b.tokenId];
    const phase = (b.number % 7) * 0.9;
    b.spectators = Math.round((60 + b.traders.size * 0.62) * (1 + 0.07 * Math.sin(this.now / 45_000 + phase))) + (this.spectating === b.id ? 1 : 0);

    for (const s of [b.a, b.b]) {
      const rt = this.side.get(`${b.id}:${s.tokenId}`)!;
      const gained = this.markets[s.tokenId].holders - s.startHolders;
      const step = 100;
      if (gained >= rt.holderMilestone + step) {
        rt.holderMilestone = Math.floor(gained / step) * step;
        const tk = this.tokens[s.tokenId];
        this.pushFeed(b, { kind: 'holders', tokenId: s.tokenId, text: `🎉 ${rt.holderMilestone} new ${tk.ticker} holders since the battle started` });
      }
    }
    const prev = this.lastScoreAnnounce.get(b.id);
    const ra = Math.round(b.a.score.total);
    const rb = Math.round(b.b.score.total);
    if (prev && (Math.abs(ra - prev[0]) >= 3 || Math.abs(rb - prev[1]) >= 3)) {
      const [tk, from, to] = Math.abs(ra - prev[0]) >= Math.abs(rb - prev[1]) ? [ta, prev[0], ra] : [tb, prev[1], rb];
      this.pushFeed(b, { kind: 'score', tokenId: tk.id, text: `📊 Battle Score changed: ${tk.ticker} ${from} → ${to}` });
      this.lastScoreAnnounce.set(b.id, [ra, rb]);
    }

    // Simulated chat (only near "now" during the fast-forward so history stays small).
    if (this.now > this.ffEnd - 8 * MINUTE) {
      const rate = 0.03 + this.activity(b) * 0.3;
      const n = poisson(rate * (dt / 1000));
      for (let i = 0; i < n; i++) {
        const line = makeChatLine(b, ta, tb, elapsed, rnd);
        this.pushChat(b, { ...line });
      }
    }

    const th = b.treasury.history.at(-1);
    if (!th || elapsed - th.t >= MINUTE) b.treasury.history.push({ t: elapsed, balance: this.treasuryBalance(b) });
    const lastFee = b.treasury.events.findLast((x) => x.kind === 'fees');
    if (b.treasury.pendingFeesQuote > 0 && this.now - (lastFee?.t ?? b.startedAt!) >= 5 * MINUTE) {
      const amt = b.treasury.pendingFeesQuote;
      b.treasury.pendingFeesQuote = 0;
      b.treasury.events.push({ id: `te${++this.idn}`, t: this.now, battleId: b.id, kind: 'fees', amountQuote: amt, text: `+${amt.toFixed(3)} SOL from swap fees (${TREASURY_FEE_SHARE * 100}% of the 1% pool fee)` });
      if (b.treasury.events.length > 80) b.treasury.events.splice(1, 1);
    }
  }

  private accrueFee(b: Battle, quoteAmt: number) {
    if (b.status !== 'live') return;
    const f = quoteAmt * 0.01 * TREASURY_FEE_SHARE;
    b.treasury.feesQuote += f;
    b.treasury.pendingFeesQuote += f;
  }

  private pushChat(b: Battle, m: Omit<Battle['chat'][number], 'id' | 't'>) {
    b.chat.push({ id: `c${++this.idn}`, t: this.now, ...m });
    if (b.chat.length > MAX_CHAT) b.chat.splice(0, b.chat.length - MAX_CHAT);
  }

  /** Losing (and winning) tokens keep trading normally after the battle. */
  private stepPost(b: Battle, dt: number) {
    if (b.endedAt && this.now - b.endedAt < 12 * MINUTE && this.now > this.ffEnd - 8 * MINUTE && rnd() < 0.04 * (dt / 1000)) {
      const who = ['gm_gm', 'battlefan', 'holdooor', 'oracle', 'trader42'][Math.floor(rnd() * 5)];
      this.pushChat(b, { user: who, avatar: '💬', text: POST_BATTLE_LINES[Math.floor(rnd() * POST_BATTLE_LINES.length)](this.tokens[b.winner!]) });
    }
    b.spectators = Math.max(0, Math.round(b.spectators * (1 - 0.002 * (dt / 1000))));
    for (const s of [b.a, b.b]) {
      const rt = this.side.get(`${b.id}:${s.tokenId}`);
      if (!rt) continue;
      // Stop tracking if the token is in a newer battle.
      if (this.battleForToken(s.tokenId) !== b) continue;
      const n = poisson((b.featured ? 0.35 : 0.1) * (dt / 1000));
      for (let i = 0; i < n; i++) this.botTrade(b, s, rt, false, true);
      this.sample(b, s, rt, dt);
    }
  }

  private sample(b: Battle, s: BattleSideState, rt: SideRuntime, dt: number) {
    const m = this.markets[s.tokenId];
    if (b.status === 'live') {
      s.twAccumulator += Math.log(m.price / s.startPrice) * dt;
      s.twTime += dt;
      const circulating = (this.tokens[s.tokenId].totalSupply - m.reserveToken) * m.price;
      s.circulatingQuoteMs += circulating * dt;
    }
    if (this.now - rt.lastSample >= SAMPLE_MS) {
      s.history.push({ t: this.now, price: m.price, volume: rt.bucketVol });
      rt.bucketVol = 0;
      rt.lastSample = this.now;
      if (s.history.length > 9000) s.history.splice(1, 2);
    }
  }

  private botTrade(b: Battle, s: BattleSideState, rt: SideRuntime, surge: boolean, post = false) {
    const m = this.markets[s.tokenId];
    const sent = this.sentiment[s.tokenId] + (surge ? 1.2 : 0);
    const pBuy = 0.485 + 0.16 * Math.tanh(sent) + (post ? -0.03 : 0);
    let wallet: string;
    let side: TradeSide;
    let quoteAmt: number;
    let tokenAmt: number;
    if (rnd() < pBuy) {
      side = 'buy';
      const isNew = surge || rt.wallets.length < 5 || rnd() < 0.55;
      wallet = isNew ? fakeAddress(rnd, 32) : rt.wallets[Math.floor(rnd() * rt.wallets.length)];
      quoteAmt = Math.min(40, Math.exp(gauss(rnd) * 0.85) * 0.2 * (rnd() < 0.02 ? 14 : 1));
      tokenAmt = applySwap(m, 'buy', quoteAmt);
      const prev = s.battleHolders.get(wallet) ?? 0;
      if (prev <= 0) {
        m.holders++;
        if (isNew) rt.wallets.push(wallet);
        if (!post && b.status === 'live' && rnd() < 0.18) {
          const tk = this.tokens[s.tokenId];
          this.pushFeed(b, { kind: 'join', tokenId: s.tokenId, text: `${short(wallet)} joined the ${tk.logo} ${tk.ticker} ARMY` });
        }
      }
      s.battleHolders.set(wallet, prev + tokenAmt);
      if (quoteAmt > 3.5 && b.status === 'live') {
        const tk = this.tokens[s.tokenId];
        this.pushFeed(b, { kind: 'whale', tokenId: s.tokenId, text: `🐋 ${short(wallet)} bought ${quoteAmt.toFixed(1)} SOL of $${tk.ticker}` });
      }
      if (b.status === 'live') s.buyers.add(wallet);
    } else {
      side = 'sell';
      const fromBattle = rt.wallets.length > 0 && rnd() < 0.62;
      if (fromBattle) {
        wallet = rt.wallets[Math.floor(rnd() * rt.wallets.length)];
        const bal = s.battleHolders.get(wallet) ?? 0;
        if (bal <= 0) return;
        const full = rnd() < 0.38;
        tokenAmt = full ? bal : bal * (0.2 + rnd() * 0.6);
        quoteAmt = applySwap(m, 'sell', tokenAmt);
        s.battleHolders.set(wallet, bal - tokenAmt);
        if (full) m.holders = Math.max(1, m.holders - 1);
      } else {
        wallet = fakeAddress(rnd, 32);
        const wantQuote = Math.min(30, Math.exp(gauss(rnd) * 0.8) * 0.24);
        tokenAmt = wantQuote / m.price;
        quoteAmt = applySwap(m, 'sell', tokenAmt);
        if (rnd() < 0.25) m.holders = Math.max(1, m.holders - 1);
      }
      if (b.status === 'live') s.sellers.add(wallet);
    }
    rt.bucketVol += quoteAmt;
    if (b.status === 'live') {
      s.battleVolumeQuote += quoteAmt;
      b.traders.add(wallet);
      this.accrueFee(b, quoteAmt);
      if (quoteAmt >= 1 && quoteAmt <= 3.5) {
        const tk = this.tokens[s.tokenId];
        this.pushFeed(b, { kind: 'trade', tokenId: s.tokenId, text: `Wallet ${wallet.slice(0, 4)}… ${side === 'buy' ? 'bought' : 'sold'} $${Math.round(quoteToUsd(quoteAmt)).toLocaleString('en-US')} ${tk.ticker}` });
      }
    }
    this.pushTrade(b, { id: `t${++this.idn}`, t: this.now, tokenId: s.tokenId, wallet, side, quoteAmount: quoteAmt, tokenAmount: tokenAmt, price: m.price });
  }

  private pushTrade(b: Battle, t: Trade) {
    b.trades.push(t);
    if (b.trades.length > MAX_TRADES) b.trades.splice(0, b.trades.length - MAX_TRADES);
  }

  private pushFeed(b: Battle, f: Omit<FeedItem, 'id' | 't'>) {
    b.feed.push({ id: `f${++this.idn}`, t: this.now, ...f });
    if (b.feed.length > MAX_FEED) b.feed.splice(0, b.feed.length - MAX_FEED);
  }

  /**
   * Integrity simulation: occasionally a cluster of linked wallets wash-trades
   * (flagged, excluded from score inputs), and occasionally a legitimate
   * community surge happens (many independent wallets – NOT flagged).
   */
  private maybeIntegrityEvents(b: Battle, s: BattleSideState, rt: SideRuntime) {
    const tk = this.tokens[s.tokenId];
    const integ = b.integrity[s.tokenId];
    const m = this.markets[s.tokenId];
    if (this.now >= rt.nextSurge) {
      rt.nextSurge = this.now + (18 + rnd() * 40) * MINUTE;
      rt.surgeUntil = this.now + (90 + rnd() * 90) * 1000;
      rt.surgeBoost = 3 + rnd() * 3;
      const n = 25 + Math.floor(rnd() * 50);
      const ev: IntegrityEvent = {
        id: `ie${++this.idn}`, t: this.now, tokenId: s.tokenId, severity: 'info', kind: 'community-surge',
        title: `${tk.logo} $${tk.ticker} community surge — legitimate`,
        detail: `~${n} wallets with independent funding histories and varied sizes bought within minutes of a community call. Collective support is allowed; counted normally.`,
        wallets: n, excludedQuote: 0,
      };
      integ.events.unshift(ev);
      this.sentiment[s.tokenId] += 0.35;
      this.pushFeed(b, { kind: 'surge', tokenId: s.tokenId, text: `📣 ${tk.ticker} ARMY is rallying — ${n} wallets joined` });
    }
    if (this.now >= rt.nextSuspicious) {
      rt.nextSuspicious = this.now + (35 + rnd() * 60) * MINUTE;
      const kinds = [
        ['coordinated-wallets', 'Coordinated wallet cluster', (n: number) => `${n} wallets funded from one source within 90s executed near-identical buys within the same 3 blocks.`],
        ['wash-trading', 'Wash trading', (n: number) => `${n} linked wallets bought and sold the same size back-and-forth with no net position change.`],
        ['circular-trading', 'Circular trading', (n: number) => `Tokens cycled through a ring of ${n} wallets (A→B→C→A) generating volume without new holders.`],
        ['synchronized-trading', 'Abnormal synchronized trading', (n: number) => `${n} fresh wallets traded on an exact 4-second cadence, a pattern consistent with a single bot operator.`],
      ] as const;
      const [kind, title, detail] = kinds[Math.floor(rnd() * kinds.length)];
      const n = 5 + Math.floor(rnd() * 12);
      let vol = 0;
      for (let i = 0; i < n; i++) {
        const w = fakeAddress(rnd, 32);
        integ.flaggedWallets.add(w);
        const amt = (b.featured ? 0.5 : 0.25) + rnd() * (b.featured ? 1 : 0.5);
        const got = applySwap(m, 'buy', amt);
        const back = applySwap(m, 'sell', got * (kind === 'coordinated-wallets' ? 0.3 : 0.98));
        if (kind === 'coordinated-wallets') s.battleHolders.set(w, got * 0.7);
        vol += amt + back;
        this.pushTrade(b, { id: `t${++this.idn}`, t: this.now, tokenId: s.tokenId, wallet: w, side: 'buy', quoteAmount: amt, tokenAmount: got, price: m.price, flagged: true });
      }
      s.battleVolumeQuote += vol;
      s.flaggedVolumeQuote += vol;
      this.accrueFee(b, vol);
      rt.bucketVol += vol;
      integ.events.unshift({
        id: `ie${++this.idn}`, t: this.now, tokenId: s.tokenId, severity: 'alert', kind, title: `${title} on $${tk.ticker}`,
        detail: `${detail(n)} ${vol.toFixed(1)} SOL of volume and ${n} wallets excluded from Holder Growth and Market Quality per published rules.`,
        wallets: n, excludedQuote: vol,
      });
      this.pushFeed(b, { kind: 'alert', tokenId: s.tokenId, text: `⚠️ Integrity alert on $${tk.ticker}: ${title.toLowerCase()} — activity excluded` });
      this.emit({ type: 'integrity-alert', battleId: b.id, tokenId: s.tokenId });
    }
    integ.score = s.battleVolumeQuote > 0 ? Math.round(100 * (1 - s.flaggedVolumeQuote / s.battleVolumeQuote)) : 100;
  }

  private accrueLoyalty(b: Battle, dt: number) {
    for (const s of [b.a, b.b]) {
      const pos = this.wallet.positions[s.tokenId];
      const key = `${b.id}:${s.tokenId}`;
      if (!pos || pos.amount <= 0) continue;
      const l = (this.wallet.loyalty[key] ??= { battleId: b.id, tokenId: s.tokenId, weightedQuoteMs: 0, heldMs: 0, peakAmount: 0, soldDuringBattle: false });
      l.firstHeldAt ??= this.now;
      l.heldMs += dt;
      l.weightedQuoteMs += pos.amount * this.markets[s.tokenId].price * dt;
      l.peakAmount = Math.max(l.peakAmount, pos.amount);
    }
  }

  private runEndChecks(b: Battle) {
    const { minDurationMs, epochMs, hazardPerEpoch, maxDurationMs } = b.rules.randomEnd;
    const elapsed = this.now - b.startedAt!;
    while (true) {
      const k = b.endChecks.length + 1;
      const at = minDurationMs + k * epochMs;
      if (at > elapsed) return;
      if (at >= maxDurationMs) {
        this.finalize(b, maxDurationMs, undefined, true);
        return;
      }
      const round = this.beacon.roundAfter(b.startedAt! + at);
      const randomness = this.beacon.randomness(round);
      const value = endCheckValue(b.id, b.commitment.rulesHash, randomness);
      const check: EndCheck = { index: k, at, beaconRound: round, beaconRandomness: randomness, value, threshold: hazardPerEpoch, ended: value < hazardPerEpoch };
      b.endChecks.push(check);
      if (check.ended) {
        this.finalize(b, at, check, false);
        return;
      }
    }
  }

  private finalize(b: Battle, at: number, check: EndCheck | undefined, hitCap: boolean) {
    b.status = 'ended';
    b.endedAt = b.startedAt! + at;
    const sa = b.a.score;
    const sb = b.b.score;
    const aWins = sa.total !== sb.total ? sa.total > sb.total : sa.inputs.twReturn >= sb.inputs.twReturn;
    b.winner = aWins ? b.a.tokenId : b.b.tokenId;
    const ma = this.markets[b.a.tokenId];
    const mb = this.markets[b.b.tokenId];
    b.final = {
      durationMs: at, scoreA: structuredClone(sa), scoreB: structuredClone(sb),
      marketCapA: ma.price * this.tokens[b.a.tokenId].totalSupply, marketCapB: mb.price * this.tokens[b.b.tokenId].totalSupply,
      returnA: ma.price / b.a.startPrice - 1, returnB: mb.price / b.b.startPrice - 1,
      holderGrowthA: sa.inputs.holderGrowthPct, holderGrowthB: sb.inputs.holderGrowthPct,
      integrityA: b.integrity[b.a.tokenId].score, integrityB: b.integrity[b.b.tokenId].score, endCheck: check, hitCap,
      holdersA: ma.holders, holdersB: mb.holders,
    };
    const id = b.id;
    this.history.push(
      { battleId: id, tokenId: b.a.tokenId, opponentId: b.b.tokenId, won: aWins, scoreFor: sa.total, scoreAgainst: sb.total, durationMs: at, endedAt: b.endedAt },
      { battleId: id, tokenId: b.b.tokenId, opponentId: b.a.tokenId, won: !aWins, scoreFor: sb.total, scoreAgainst: sa.total, durationMs: at, endedAt: b.endedAt },
    );
    for (const s of [b.a, b.b]) {
      const c = this.creators[this.tokens[s.tokenId].creatorId];
      if (c) { c.history.battlesCompleted++; c.history.totalBattleParticipants += b.traders.size; }
    }
    const w = this.tokens[b.winner];
    const l = this.tokens[aWins ? b.b.tokenId : b.a.tokenId];
    this.pushFeed(b, { kind: 'lead', tokenId: b.winner, text: `🏆 BATTLE OVER — ${w.logo} $${w.ticker} wins` });

    // Battle Loyalty for the user (simulated payout estimate).
    const userHeld = Object.values(this.wallet.loyalty).filter((x) => x.battleId === b.id);
    if (userHeld.length) {
      const lw = this.loyaltyFor(b, b.winner);
      if (lw.estRewardQuote > 0) {
        this.wallet.claimedRewardsQuote += lw.estRewardQuote;
        this.wallet.loyaltyPoints += Math.round(lw.weight / 60_000 / 10);
        this.notify({ kind: 'reward', title: '🏆 Battle Loyalty reward (simulated)', body: `+${lw.estRewardQuote.toFixed(3)} SOL from the $${w.ticker} holder pool.`, link: `/battle/${b.id}` });
      }
    }
    if (!this.silent) {
      this.notify({ kind: 'battle-end', title: '⚔️ BATTLE OVER', body: `${w.logo} $${w.ticker} defeated $${l.ticker}.`, link: `/battle/${b.id}` });
    }
    this.distributeTreasury(b);
    if (b.tournamentId) this.advanceTournament(b);
    this.emit({ type: 'battle-end', battleId: b.id, winner: b.winner });
  }

  /** Keep the arena busy: when battles end, new challenges get scheduled. */
  private keepPipelineFull() {
    const active = this.battles.filter((b) => b.status === 'live' || b.status === 'scheduled' || b.status === 'pending');
    if (active.length >= 22) return;
    const busy = new Set(active.flatMap((b) => [b.a.tokenId, b.b.tokenId]));
    for (const b of this.battles) {
      if (b.status === 'ended' && this.now - (b.endedAt ?? 0) < 25 * MINUTE) { busy.add(b.a.tokenId); busy.add(b.b.tokenId); }
    }
    busy.add('owl');
    for (const t of Object.keys(this.tokens)) if (this.inActiveTournament(t)) busy.add(t);
    const free = Object.keys(this.tokens).filter((t) => !busy.has(t) && this.tokens[t].creatorId !== USER_CREATOR_ID);
    if (free.length < 2) return;
    const a = free[Math.floor(rnd() * free.length)];
    const rest = free.filter((x) => x !== a);
    const bId = rest[Math.floor(rnd() * rest.length)];
    const types = ['classic', 'classic', 'blitz', 'marathon'] as const;
    this.createBattle(a, bId, makeRules({ type: types[Math.floor(rnd() * types.length)], rewardPoolQuote: 100 + Math.round(rnd() * 15) * 10 }), this.now + (8 + rnd() * 25) * MINUTE);
  }

  /** Settle a user trade against the AMM (shared by real UI trades and the seeded demo trade). */
  private settleUserTrade(req: TradeRequest): TradeResult {
    const m = this.markets[req.tokenId];
    const tk = this.tokens[req.tokenId];
    if (!m || !tk) return { ok: false, error: 'Unknown token.' };
    const w = this.wallet;
    const pos = (w.positions[req.tokenId] ??= { tokenId: req.tokenId, amount: 0, costQuote: 0 });
    if (req.amount <= 0) return { ok: false, error: 'Enter an amount.' };
    if (req.side === 'buy' && req.amount > w.quoteBalance + 1e-9) return { ok: false, error: 'Insufficient SOL balance.' };
    if (req.side === 'sell' && req.amount > pos.amount * (1 + 1e-9)) return { ok: false, error: `Insufficient $${tk.ticker} balance.` };
    const q = ammQuote(m, req.side, req.amount, req.slippage);
    if (q.outputAmount < req.minOut) return { ok: false, error: 'Price moved beyond your slippage tolerance. Nothing was executed.' };

    const out = applySwap(m, req.side, req.amount);
    const battle = req.battleId ? this.getBattle(req.battleId) : this.battleForToken(req.tokenId);
    const s = battle ? (battle.a.tokenId === req.tokenId ? battle.a : battle.b.tokenId === req.tokenId ? battle.b : undefined) : undefined;
    let joinedArmy: TokenId | undefined;
    if (req.side === 'buy') {
      w.quoteBalance -= req.amount;
      if (pos.amount <= 0) m.holders++;
      pos.amount += out;
      pos.costQuote += req.amount;
      if (battle && battle.status === 'live' && s) {
        s.buyers.add(w.address);
        s.battleHolders.set(w.address, (s.battleHolders.get(w.address) ?? 0) + out);
        if (w.armies[battle.id] !== req.tokenId) joinedArmy = req.tokenId;
        w.armies[battle.id] = req.tokenId;
        this.pushFeed(battle, { kind: 'you', tokenId: req.tokenId, text: `You joined the ${tk.logo} ${tk.ticker} ARMY with ${req.amount.toFixed(2)} SOL` });
      }
    } else {
      const frac = req.amount / pos.amount;
      pos.costQuote *= 1 - frac;
      pos.amount -= req.amount;
      if (pos.amount < 1) { pos.amount = 0; pos.costQuote = 0; m.holders = Math.max(1, m.holders - 1); }
      w.quoteBalance += out;
      if (battle && battle.status === 'live' && s) {
        s.sellers.add(w.address);
        s.battleHolders.set(w.address, Math.max(0, (s.battleHolders.get(w.address) ?? 0) - req.amount));
        const l = w.loyalty[`${battle.id}:${req.tokenId}`];
        if (l) l.soldDuringBattle = true;
      }
    }
    const trade: Trade = {
      id: `t${++this.idn}`, t: this.now, tokenId: req.tokenId, wallet: w.address, side: req.side,
      quoteAmount: req.side === 'buy' ? req.amount : out, tokenAmount: req.side === 'buy' ? out : req.amount, price: spotPrice(m), isUser: true,
    };
    w.trades.unshift(trade);
    if (battle) {
      this.pushTrade(battle, trade);
      if (battle.status === 'live' && s) {
        s.battleVolumeQuote += trade.quoteAmount;
        battle.traders.add(w.address);
        this.accrueFee(battle, trade.quoteAmount);
      }
    }
    return { ok: true, trade, signature: fakeAddress(rnd, 88), joinedArmy };
  }
}
