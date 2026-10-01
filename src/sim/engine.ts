import type {
  Battle, BattleId, BattleRecordEntry, BattleRules, BattleSideState, Challenge, Creator, EndCheck, FeedItem,
  IntegrityEvent, IntegrityState, Market, Notification, Token, TokenId, Trade, TradeSide, Wallet,
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
import { short } from '../lib/format';

const STEP_MS = 2000; // simulation resolution
const SAMPLE_MS = 5000; // price history resolution
const SCORE_SAMPLE_MS = 30_000;
const MAX_TRADES = 400;
const MAX_FEED = 80;

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

  constructor() {
    const realNow = Date.now();
    const ff = 82 * MINUTE; // how far back the simulated world starts
    this.now = realNow - ff;
    this.beacon = new SimBeacon(realNow - 400 * 24 * HOUR, 3000, fakeHex(rnd, 32));

    for (const t of TOKENS) {
      this.tokens[t.id] = { ...t };
      this.markets[t.id] = this.makeMarket(t.id, START_MCAP[t.id] ?? 1500);
      this.sentiment[t.id] = gauss(rnd) * 0.4;
    }
    for (const c of CREATORS) this.creators[c.id] = structuredClone(c);
    this.history = generateHistory();
    this.applyHistoryToCreators();

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
    const featured = this.createBattle('frog', 'cat', makeRules(), realNow - 56 * MINUTE, { featured: true });
    this.createBattle('wolf', 'fox', makeRules(), realNow - 68 * MINUTE);
    this.createBattle('shark', 'octo', makeRules({ type: 'blitz' }), realNow - 63 * MINUTE);
    this.createBattle('ape', 'tiger', makeRules(), realNow - 41 * MINUTE);
    this.createBattle('panda', 'eagle', makeRules({ type: 'marathon' }), realNow - 23 * MINUTE);
    // Upcoming
    this.createBattle('dog', 'bull', makeRules(), realNow + 6 * MINUTE);
    this.createBattle('moon', 'dragon', makeRules({ type: 'blitz', rewardPoolQuote: 220 }), realNow + 14 * MINUTE);
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
    const pool = b.rules.rewardPoolQuote * b.rules.rewardSplit.holderRewards;
    return { heldQuote, heldMs: l.heldMs, factor, share, estRewardQuote: share * pool, weight };
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

  createBattle(aId: TokenId, bId: TokenId, rules: BattleRules, scheduledStart: number, opts: { featured?: boolean; status?: Battle['status'] } = {}) {
    const id = `${aId}-vs-${bId}-${(++this.idn).toString(36)}`;
    const hash = rulesHash(rules, aId, bId);
    const mkIntegrity = (): IntegrityState => ({ score: 100, events: [], flaggedWallets: new Set() });
    const b: Battle = {
      id, a: this.newSide(aId), b: this.newSide(bId), status: opts.status ?? 'scheduled', rules,
      commitment: { battleId: id, rulesHash: hash, startRound: 0, committedAt: this.now },
      scheduledStart, challengerId: aId, createdBy: this.tokens[aId].creatorId, endChecks: [],
      integrity: { [aId]: mkIntegrity(), [bId]: mkIntegrity() }, leadChanges: [], trades: [], scoreHistory: [],
      feed: [], traders: new Set(), featured: opts.featured,
    };
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
        nextSuspicious: b.startedAt + (10 + rnd() * 50) * MINUTE, nextSurge: b.startedAt + (4 + rnd() * 30) * MINUTE,
      });
    }
    const [sa, sb] = this.scoreCtx(b);
    [b.a.score, b.b.score] = computeScores(b.rules, sa, sb);
    b.leadChanges.push({ t: 0, leader: leaderOf(b) });
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
      if ((b.status === 'scheduled') && this.now >= b.scheduledStart) this.startBattle(b);
      if (b.status === 'live') this.stepLive(b, dt);
      else if (b.status === 'ended' && b.startedAt) this.stepPost(b, dt);
    }
    // idle drift for tokens not in a battle
    for (const id in this.sentiment) {
      const s = this.sentiment[id];
      this.sentiment[id] = s - s * (dt / 600_000) + 0.035 * Math.sqrt(dt / 1000) * gauss(rnd);
    }
    this.keepPipelineFull();
  }

  private stepLive(b: Battle, dt: number) {
    const elapsed = this.now - (b.startedAt ?? this.now);
    const tension = elapsed > b.rules.randomEnd.minDurationMs ? 1.35 : 1;
    const base = b.featured ? 0.42 : 0.2;
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

    this.accrueLoyalty(b, dt);
    this.runEndChecks(b);
  }

  /** Losing (and winning) tokens keep trading normally after the battle. */
  private stepPost(b: Battle, dt: number) {
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
    this.emit({ type: 'battle-end', battleId: b.id, winner: b.winner });
  }

  /** Keep the arena busy: when battles end, new challenges get scheduled. */
  private keepPipelineFull() {
    const active = this.battles.filter((b) => b.status === 'live' || b.status === 'scheduled' || b.status === 'pending');
    if (active.length >= 8) return;
    const busy = new Set(active.flatMap((b) => [b.a.tokenId, b.b.tokenId]));
    for (const b of this.battles) {
      if (b.status === 'ended' && this.now - (b.endedAt ?? 0) < 25 * MINUTE) { busy.add(b.a.tokenId); busy.add(b.b.tokenId); }
    }
    busy.add('owl');
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
      }
    }
    return { ok: true, trade, signature: fakeAddress(rnd, 88), joinedArmy };
  }
}
