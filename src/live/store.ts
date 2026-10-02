import type { RealtimeChannel } from '@supabase/supabase-js';
import type {
  AppNotification, Battle, BattleDetail, BattleId, BattleRecordEntry, BattleRules, ChatMessage, EndCheck, FeedItem,
  IntegrityEvent, Market, Quote, Snapshot, SwapRecord, Token, TokenId, Tournament, Trade, TradeSide, WalletState,
} from '../data/types';
import { supabase } from './supabase';
import { SOL_MINT, config, isConfigured } from './config';
import { fetchMarkets, fetchSolPrice } from './market';
import { buildSwap, getQuote } from './jupiter';
import { accountExists, associatedTokenAddress, confirm, createAtaTx, solBalance, tokenBalances } from './rpc';
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import { getWallet, signAndSend, siwsAdapter, type InjectedWallet } from './wallet';
import { rulesHash } from '../lib/shared';

export type StoreEvent =
  | { type: 'battle-end'; battleId: BattleId; winner: TokenId }
  | { type: 'battle-start'; battleId: BattleId }
  | { type: 'lead-change'; battleId: BattleId; leader: TokenId }
  | { type: 'toast'; title: string; body?: string; tone?: 'good' | 'bad' | 'info' };

/** One swap made through BATTLE by the connected wallet (amounts as quoted at the time). */
export interface LedgerEntry { tx: string; tokenId: TokenId; side: TradeSide; sol: number; tokens: number; t: number }

/** Average-cost PnL for one coin, in USD at the current SOL price. */
export interface Pnl {
  held: number; tracked: number; avgCostSol: number;
  valueUsd: number | null; costUsd: number | null; unrealizedUsd: number | null; realizedUsd: number | null; totalUsd: number | null;
  pct: number | null; untrackedQty: number;
}

export type TradeResult = { ok: true; signature: string; joinedArmy?: TokenId } | { ok: false; error: string };

const ROUND_NAMES: Record<number, string[]> = { 2: ['Semifinal', 'Final'], 3: ['Quarterfinal', 'Semifinal', 'Final'] };
export const roundName = (t: Tournament, r: number) => ROUND_NAMES[t.rounds.length]?.[r] ?? `Round ${r + 1}`;

const ls = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

const ms = (v: string | null | undefined) => (v ? new Date(v).getTime() : undefined);

function mapToken(r: any): Token {
  return {
    id: r.mint, mint: r.mint, ticker: r.symbol, name: r.name, logoUrl: r.logo_url ?? undefined, hue: r.hue ?? 200,
    pairAddress: r.pair_address, dexId: r.dex_id ?? undefined, description: r.description ?? undefined,
    socials: r.socials ?? {}, listedBy: r.listed_by, listedAt: ms(r.listed_at) ?? 0,
  };
}

function mapBattle(r: any): Battle {
  const st = r.state ?? {};
  const side = (k: 'a' | 'b') => ({
    tokenId: r[`token_${k}`],
    startPrice: r[`start_price_${k}`], startHolders: r[`start_holders_${k}`], startLiquidity: r[`start_liq_${k}`], startMcap: r[`start_mcap_${k}`],
    priceUsd: st[k]?.priceUsd ?? null, mcapUsd: st[k]?.mcapUsd ?? null, liquidityUsd: st[k]?.liqUsd ?? null, holders: st[k]?.holders ?? null,
    volumeUsd: st[k]?.volumeUsd ?? 0, flaggedUsd: st[k]?.flaggedUsd ?? 0, buyers: st[k]?.buyers ?? 0, sellers: st[k]?.sellers ?? 0,
    score: st[k]?.score ?? null,
  });
  return {
    id: r.id, number: r.number, a: side('a'), b: side('b'), status: r.status, rules: r.rules, rulesHash: r.rules_hash,
    createdBy: r.created_by, challengeMessage: r.challenge_message ?? undefined, scheduledStart: ms(r.scheduled_start)!,
    startedAt: ms(r.started_at), endedAt: ms(r.ended_at), winner: r.winner ?? undefined, tournamentId: r.tournament_id ?? undefined,
    matchRound: r.match_round ?? undefined, matchSlot: r.match_slot ?? undefined, traders: st.traders ?? 0,
    leadChanges: st.leadChanges ?? 0, leader: st.leader ?? undefined, final: r.final ?? undefined,
  };
}

const mapCheck = (r: any): EndCheck => ({ index: r.idx, at: +r.at_ms, beaconRound: +r.round, beaconRandomness: r.randomness, value: r.value, threshold: r.threshold, ended: r.ended });
const mapFeed = (r: any): FeedItem => ({ id: r.id, t: ms(r.ts)!, kind: r.kind, tokenId: r.token ?? undefined, text: r.text });
const mapChat = (r: any): ChatMessage => ({ id: r.id, battleId: r.battle_id, wallet: r.wallet, text: r.text, army: r.army ?? undefined, deleted: r.deleted, t: ms(r.created_at)! });
const mapSnap = (r: any): Snapshot => ({ t: ms(r.t)!, priceA: r.price_a, priceB: r.price_b, mcapA: r.mcap_a, mcapB: r.mcap_b, holdersA: r.holders_a, holdersB: r.holders_b, scoreA: r.score_a, scoreB: r.score_b });
const mapTrade = (r: any): Trade => ({ tx: r.tx, tokenId: r.token, wallet: r.wallet, side: r.side, usd: r.usd, t: ms(r.ts)!, flagged: r.flagged });
const mapIntegrity = (r: any): IntegrityEvent => ({ id: r.id, tokenId: r.token, t: ms(r.ts)!, kind: r.kind, severity: r.severity, title: r.title, detail: r.detail, wallets: r.wallets, excludedUsd: r.excluded_usd });
const mapSwap = (r: any): SwapRecord => ({ tx: r.tx, battleId: r.battle_id ?? undefined, wallet: r.wallet, tokenId: r.token, side: r.side, solAmount: r.sol_amount, feeSol: r.fee_sol, verified: r.verified, t: ms(r.created_at)! });

export class LiveStore {
  version = 0;
  now = Date.now();
  readonly configured = isConfigured();
  ready = false;
  error?: string;
  marketError?: string;

  tokens: Record<TokenId, Token> = {};
  markets: Record<TokenId, Market> = {};
  battles: Battle[] = [];
  tournaments: Tournament[] = [];
  solUsd: number | null = null;
  wallet: WalletState = { connected: false, signedIn: false, solBalance: null, tokens: {} };
  armies: Record<BattleId, TokenId> = ls.get('battle.armies', {});
  chatPrefs = { muted: new Set<string>(ls.get<string[]>('battle.muted', [])), blocked: new Set<string>(ls.get<string[]>('battle.blocked', [])), reported: new Set<number>(ls.get<number[]>('battle.reported', [])) };
  private details = new Map<BattleId, BattleDetail>();
  private channels = new Map<BattleId, { ch: RealtimeChannel; refs: number; poll: ReturnType<typeof setInterval> }>();
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(e: StoreEvent) => void>();
  private provider?: InjectedWallet;

  constructor() {
    setInterval(() => { this.now = Date.now(); this.bump(); }, 1000);
    if (this.configured) void this.init();
    else this.ready = true;
    void this.restoreWallet();
  }

  /* ------------------------------------------------------------ plumbing */
  subscribe(cb: () => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  onEvent(cb: (e: StoreEvent) => void) { this.eventListeners.add(cb); return () => { this.eventListeners.delete(cb); }; }
  private bump() { this.version++; this.listeners.forEach((l) => l()); }
  private emit(e: StoreEvent) { this.eventListeners.forEach((l) => l(e)); }

  private async init() {
    const db = supabase!;
    try {
      const [tk, bt, tr, tm] = await Promise.all([
        db.from('tokens').select('*'),
        db.from('battles').select('*').in('status', ['pending', 'scheduled', 'live', 'ended']).order('number', { ascending: false }).limit(500),
        db.from('tournaments').select('*').order('scheduled_start', { ascending: false }),
        db.from('tournament_matches').select('*'),
      ]);
      for (const r of [tk, bt, tr, tm]) if (r.error) throw r.error;
      tk.data!.forEach((r) => (this.tokens[r.mint] = mapToken(r)));
      this.battles = bt.data!.map(mapBattle);
      this.setTournaments(tr.data!, tm.data!);
      this.ready = true;
    } catch (e) {
      this.error = `Could not load from the backend: ${(e as Error).message}`;
      this.ready = true;
    }
    this.bump();

    db.channel('global')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'battles' }, (p) => this.onBattleRow(p.new as any))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tokens' }, (p) => this.onTokenRow(p.eventType, (p.new ?? p.old) as any))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, () => void this.reloadTournaments())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_matches' }, () => void this.reloadTournaments())
      .subscribe();

    db.auth.onAuthStateChange(() => void this.syncSession());
    await this.syncSession();
    void this.refreshMarkets();
    setInterval(() => void this.refreshMarkets(), 20_000);
  }

  private onBattleRow(r: any) {
    if (!r?.id) return;
    const next = mapBattle(r);
    const i = this.battles.findIndex((b) => b.id === r.id);
    const prev = i >= 0 ? this.battles[i] : undefined;
    if (i >= 0) this.battles[i] = next; else this.battles.unshift(next);
    if (prev && prev.status !== 'live' && next.status === 'live') this.emit({ type: 'battle-start', battleId: next.id });
    if (prev && prev.status === 'live' && next.status === 'ended' && next.winner) this.emit({ type: 'battle-end', battleId: next.id, winner: next.winner });
    if (prev?.leader && next.leader && prev.leader !== next.leader && next.status === 'live') this.emit({ type: 'lead-change', battleId: next.id, leader: next.leader });
    if (next.tournamentId) this.syncMatches();
    this.bump();
  }

  private setTournaments(rows: any[], matches: any[]) {
    this.tournaments = rows.map((t) => {
      const rounds: Tournament['rounds'] = Array.from({ length: Math.log2(t.size) }, () => []);
      for (const m of matches.filter((x) => x.tournament_id === t.id)) {
        (rounds[m.round] ??= [])[m.slot] = { id: `${t.id}-${m.round}-${m.slot}`, round: m.round, slot: m.slot, a: m.token_a ?? undefined, b: m.token_b ?? undefined, battleId: m.battle_id ?? undefined, winner: m.winner ?? undefined };
      }
      return {
        id: t.id, slug: t.slug, name: t.name, tagline: t.tagline ?? undefined, hue: t.hue, size: t.size, status: t.status,
        prizeNote: t.prize_note ?? undefined, rules: t.rules, scheduledStart: ms(t.scheduled_start)!, startedAt: ms(t.started_at),
        endedAt: ms(t.ended_at), champion: t.champion ?? undefined, rounds,
      };
    });
    this.syncMatches();
  }

  /** Copy final scores from finished match battles into the bracket. */
  private syncMatches() {
    for (const t of this.tournaments) for (const m of t.rounds.flat()) {
      const b = m?.battleId ? this.getBattle(m.battleId) : undefined;
      if (!b?.final) continue;
      m.scoreA = b.final.scoreA.total; m.scoreB = b.final.scoreB.total;
      m.durationMs = b.final.durationMs; m.endedAt = b.endedAt; m.winner = m.winner ?? b.winner;
    }
  }

  private async reloadTournaments() {
    const [tr, tm] = await Promise.all([supabase!.from('tournaments').select('*'), supabase!.from('tournament_matches').select('*')]);
    if (tr.data && tm.data) { this.setTournaments(tr.data, tm.data); this.bump(); }
  }

  private marketsTimer?: ReturnType<typeof setTimeout>;
  private lastFullMarkets = 0;

  /** Token rows arrive in bursts when the keeper auto-lists pump.fun coins: batch the price refresh. */
  private onTokenRow(kind: string, r: any) {
    if (!r?.mint) return;
    if (kind === 'DELETE') delete this.tokens[r.mint]; else this.tokens[r.mint] = mapToken(r);
    clearTimeout(this.marketsTimer);
    this.marketsTimer = setTimeout(() => void this.refreshMarkets(), 1500);
    this.bump();
  }

  /**
   * Prices for coins in battles, coins you hold and coins without a price yet refresh every
   * 20s; every other coin every 2 minutes (keeps DexScreener calls low with many coins).
   */
  async refreshMarkets() {
    const now = Date.now();
    const full = now - this.lastFullMarkets > 120_000;
    const hot = new Set<string>(Object.keys(this.wallet.tokens));
    this.battles.forEach((b) => { if (b.status !== 'ended' && b.status !== 'declined' && b.status !== 'cancelled') { hot.add(b.a.tokenId); hot.add(b.b.tokenId); } });
    if (full) this.lastFullMarkets = now;
    const list = Object.values(this.tokens)
      .filter((t) => full || hot.has(t.id) || !this.markets[t.id])
      .map((t) => ({ mint: t.mint, pairAddress: t.pairAddress }));
    try {
      if (list.length) {
        const m = await fetchMarkets(list);
        m.forEach((v, k) => (this.markets[k] = v));
      }
      this.solUsd = (await fetchSolPrice()) ?? this.solUsd;
      this.marketError = undefined;
    } catch (e) {
      this.marketError = `Live prices unavailable: ${(e as Error).message}`;
    }
    this.bump();
  }

  /* ------------------------------------------------------------ queries */
  /** Never undefined: a placeholder stands in while a token is still loading (or was removed). */
  token(id: TokenId | undefined | null): Token {
    return (id && this.tokens[id]) || { id: id ?? '', mint: id ?? '', ticker: id ? `${id.slice(0, 4)}…` : '—', name: 'Loading…', hue: 200, pairAddress: '', socials: {}, listedBy: '', listedAt: 0 };
  }
  getBattle(id: BattleId) { return this.battles.find((b) => b.id === id); }
  liveBattles() { return this.battles.filter((b) => b.status === 'live'); }
  upcomingBattles() { return this.battles.filter((b) => b.status === 'scheduled' || b.status === 'pending').sort((x, y) => x.scheduledStart - y.scheduledStart); }
  endedBattles() { return this.battles.filter((b) => b.status === 'ended').sort((x, y) => (y.endedAt ?? 0) - (x.endedAt ?? 0)); }
  elapsed(b: Battle) { return b.startedAt ? (b.endedAt ?? this.now) - b.startedAt : 0; }

  battleForToken(tokenId: TokenId) {
    const mine = this.battles.filter((b) => b.a.tokenId === tokenId || b.b.tokenId === tokenId);
    return mine.find((b) => b.status === 'live') ?? mine.find((b) => b.status === 'scheduled') ?? mine.find((b) => b.status === 'pending') ?? mine.find((b) => b.status === 'ended');
  }

  get history(): BattleRecordEntry[] {
    return this.endedBattles().filter((b) => b.final).flatMap((b) => {
      const f = b.final!;
      const base = { battleId: b.id, durationMs: f.durationMs, endedAt: b.endedAt ?? 0 };
      return [
        { ...base, tokenId: b.a.tokenId, opponentId: b.b.tokenId, won: b.winner === b.a.tokenId, scoreFor: f.scoreA.total, scoreAgainst: f.scoreB.total },
        { ...base, tokenId: b.b.tokenId, opponentId: b.a.tokenId, won: b.winner === b.b.tokenId, scoreFor: f.scoreB.total, scoreAgainst: f.scoreA.total },
      ];
    });
  }

  recordFor(tokenId: TokenId) {
    const entries = this.history.filter((h) => h.tokenId === tokenId).sort((a, b) => b.endedAt - a.endedAt);
    const wins = entries.filter((e) => e.won).length;
    let streak = 0;
    for (const e of entries) { if (e.won) streak++; else break; }
    let best = 0, run = 0;
    for (const e of [...entries].reverse()) { run = e.won ? run + 1 : 0; best = Math.max(best, run); }
    return { entries, wins, losses: entries.length - wins, streak, best };
  }

  getTournament(id: string) { return this.tournaments.find((t) => t.id === id || t.slug === id); }
  tournamentOf(b: Battle) { return b.tournamentId ? this.getTournament(b.tournamentId) : undefined; }
  matchOf(b: Battle) { return this.tournamentOf(b)?.rounds[b.matchRound ?? -1]?.[b.matchSlot ?? -1]; }
  currentRound(t: Tournament) {
    if (t.status === 'completed') return t.rounds.length - 1;
    const i = t.rounds.findIndex((r) => r.some((m) => !m.winner));
    return i < 0 ? t.rounds.length - 1 : i;
  }

  /** Latest holder count the keeper recorded for a token (null if never in a battle / no holder data). */
  holdersOf(tokenId: TokenId): number | null {
    for (const b of this.battles) {
      if (b.status !== 'live' && b.status !== 'ended') continue;
      const s = b.a.tokenId === tokenId ? b.a : b.b.tokenId === tokenId ? b.b : undefined;
      if (s?.holders != null) return s.holders;
    }
    return null;
  }

  myTokens() { return this.wallet.address ? Object.values(this.tokens).filter((t) => t.listedBy === this.wallet.address) : []; }

  get notifications(): AppNotification[] {
    const mine = new Set(this.myTokens().map((t) => t.id));
    const out: AppNotification[] = [];
    for (const b of this.battles) {
      const ta = this.tokens[b.a.tokenId], tb = this.tokens[b.b.tokenId];
      if (!ta || !tb) continue;
      if ((b.status === 'scheduled' || b.status === 'pending') && mine.has(b.b.tokenId) && b.createdBy !== this.wallet.address) out.push({ id: `c${b.id}`, t: b.scheduledStart, kind: 'challenge', title: '⚔️ YOUR COIN WAS CHALLENGED', body: `$${ta.ticker} vs $${tb.ticker} starts ${b.scheduledStart <= this.now ? 'now' : 'soon'}.`, link: `/battle/${b.id}` });
      if ((mine.has(b.a.tokenId) || mine.has(b.b.tokenId) || b.createdBy === this.wallet.address) && b.status === 'live') out.push({ id: `l${b.id}`, t: b.startedAt ?? 0, kind: 'battle-start', title: '⚔️ YOUR BATTLE IS LIVE', body: `$${ta.ticker} vs $${tb.ticker}`, link: `/battle/${b.id}` });
      if ((mine.has(b.a.tokenId) || mine.has(b.b.tokenId) || b.createdBy === this.wallet.address) && b.status === 'ended' && this.now - (b.endedAt ?? 0) < 86_400_000) out.push({ id: `e${b.id}`, t: b.endedAt ?? 0, kind: 'battle-end', title: '🏁 BATTLE OVER', body: `$${this.tokens[b.winner!]?.ticker} won $${ta.ticker} vs $${tb.ticker}.`, link: `/battle/${b.id}` });
    }
    return out.sort((x, y) => y.t - x.t);
  }

  /* ------------------------------------------------------------ battle detail (lazy + realtime) */
  detail(id: BattleId): BattleDetail {
    return this.details.get(id) ?? { loaded: false, snapshots: [], trades: [], feed: [], endChecks: [], integrity: [], chat: [], swaps: [], watchers: 0 };
  }

  /** Load a battle's detail and keep it live while mounted. Returns an unsubscribe. */
  watch(id: BattleId) {
    if (!supabase) return () => {};
    const existing = this.channels.get(id);
    if (existing) { existing.refs++; return () => this.unwatch(id); }
    const d: BattleDetail = { ...this.detail(id) };
    this.details.set(id, d);
    const db = supabase;
    const load = async () => {
      const [sn, tr, fd, ec, ie, ch, sw] = await Promise.all([
        db.from('battle_snapshots').select('*').eq('battle_id', id).order('t').limit(2000),
        db.from('battle_trades').select('*').eq('battle_id', id).order('ts', { ascending: false }).limit(300),
        db.from('battle_feed').select('*').eq('battle_id', id).order('id', { ascending: false }).limit(150),
        db.from('end_checks').select('*').eq('battle_id', id).order('idx'),
        db.from('integrity_events').select('*').eq('battle_id', id).order('id', { ascending: false }),
        db.from('chat_messages').select('*').eq('battle_id', id).order('id', { ascending: false }).limit(150),
        db.from('battle_swaps').select('*').eq('battle_id', id).eq('verified', true),
      ]);
      d.snapshots = (sn.data ?? []).map(mapSnap);
      d.trades = (tr.data ?? []).map(mapTrade);
      d.feed = (fd.data ?? []).map(mapFeed).reverse();
      d.endChecks = (ec.data ?? []).map(mapCheck);
      d.integrity = (ie.data ?? []).map(mapIntegrity);
      d.chat = (ch.data ?? []).map(mapChat).reverse();
      d.swaps = (sw.data ?? []).map(mapSwap);
      d.loaded = true;
      this.bump();
    };
    void load();
    const filter = `battle_id=eq.${id}`;
    const presenceKey = this.wallet.address ?? `anon-${Math.random().toString(36).slice(2, 10)}`;
    const ch = db.channel(`battle:${id}`, { config: { presence: { key: presenceKey } } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'battle_snapshots', filter }, (p) => { d.snapshots.push(mapSnap(p.new)); this.bump(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'battle_feed', filter }, (p) => { d.feed.push(mapFeed(p.new)); d.feed = d.feed.slice(-200); this.bump(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'end_checks', filter }, (p) => { d.endChecks.push(mapCheck(p.new)); this.bump(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'integrity_events', filter }, (p) => { d.integrity.unshift(mapIntegrity(p.new)); this.bump(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter }, (p) => {
        const m = mapChat(p.new);
        const i = d.chat.findIndex((x) => x.id === m.id);
        if (i >= 0) d.chat[i] = m; else d.chat.push(m);
        d.chat = d.chat.slice(-200);
        this.bump();
      })
      .on('presence', { event: 'sync' }, () => { d.watchers = Object.keys(ch.presenceState()).length; this.bump(); })
      .subscribe((status) => { if (status === 'SUBSCRIBED') void ch.track({ at: Date.now() }); });
    // Trades arrive in keeper batches each minute; poll rather than stream every row.
    const poll = setInterval(async () => {
      const { data } = await db.from('battle_trades').select('*').eq('battle_id', id).order('ts', { ascending: false }).limit(300);
      if (data) { d.trades = data.map(mapTrade); this.bump(); }
    }, 30_000);
    this.channels.set(id, { ch, refs: 1, poll });
    return () => this.unwatch(id);
  }

  private unwatch(id: BattleId) {
    const c = this.channels.get(id);
    if (!c) return;
    if (--c.refs > 0) return;
    clearInterval(c.poll);
    void supabase?.removeChannel(c.ch);
    this.channels.delete(id);
  }

  /** Treasury of a battle: verified BATTLE swap fees during the battle (USD). */
  treasuryUsd(b: Battle) {
    const fees = this.detail(b.id).swaps.filter((s) => s.verified).reduce((s, x) => s + x.feeSol, 0);
    return { feesSol: fees, usd: this.solUsd ? fees * this.solUsd : null };
  }

  async loadTreasury() {
    if (!supabase) return { swaps: [] as SwapRecord[] };
    const { data } = await supabase.from('battle_swaps').select('*').eq('verified', true).order('created_at', { ascending: false }).limit(5000);
    return { swaps: (data ?? []).map(mapSwap) };
  }

  async loadTraderStats() {
    if (!supabase) return [];
    const { data } = await supabase.from('trader_stats').select('*').order('battles', { ascending: false }).limit(100);
    return (data ?? []) as { wallet: string; battles: number; trades: number; volume_usd: number; winning_sides: number }[];
  }

  /* ------------------------------------------------------------ wallet */
  private async restoreWallet() {
    const id = ls.get<string | null>('battle.wallet', null);
    const w = id ? getWallet(id) : undefined;
    if (!w) return;
    try {
      const r = await w.connect({ onlyIfTrusted: true });
      const pk = (r && 'publicKey' in r ? r.publicKey : w.publicKey)?.toBase58();
      if (pk) await this.setConnected(w, id!, pk);
    } catch { /* not previously approved */ }
  }

  private async setConnected(w: InjectedWallet, id: string, address: string) {
    this.provider = w;
    this.wallet = { ...this.wallet, connected: true, address, provider: id };
    ls.set('battle.wallet', id);
    w.on?.('accountChanged', () => void this.disconnectWallet());
    await this.syncSession();
    void this.refreshBalances();
    void this.loadLedger();
    this.bump();
  }

  /* ------------------------------------------------------------ PnL */
  ledger: LedgerEntry[] = [];

  /** Swaps made through BATTLE: kept on this device and (when signed in) in the database. */
  private async loadLedger() {
    const a = this.wallet.address;
    if (!a) return;
    const byTx = new Map<string, LedgerEntry>(ls.get<LedgerEntry[]>(`battle.ledger.${a}`, []).map((x) => [x.tx, x]));
    if (supabase) {
      const { data } = await supabase.from('battle_swaps').select('tx, token, side, sol_amount, token_amount, created_at').eq('wallet', a).not('token_amount', 'is', null).limit(5000);
      for (const r of data ?? []) if (!byTx.has(r.tx)) byTx.set(r.tx, { tx: r.tx, tokenId: r.token, side: r.side, sol: +r.sol_amount, tokens: +r.token_amount, t: Date.parse(r.created_at) });
    }
    if (this.wallet.address !== a) return;
    this.ledger = [...byTx.values()].sort((x, y) => x.t - y.t);
    this.bump();
  }

  private addLedger(x: LedgerEntry) {
    const a = this.wallet.address;
    if (!a) return;
    this.ledger = [...this.ledger.filter((l) => l.tx !== x.tx), x].sort((p, q) => p.t - q.t);
    ls.set(`battle.ledger.${a}`, this.ledger.slice(-2000));
  }

  /**
   * Live PnL for a coin from trades made through BATTLE (average cost). Coins bought
   * elsewhere have no known cost, so they're left out and reported as `untrackedQty`.
   */
  pnl(tokenId: TokenId): Pnl | null {
    const trades = this.ledger.filter((x) => x.tokenId === tokenId);
    if (!trades.length) return null;
    let qty = 0, cost = 0, realized = 0;
    for (const x of trades) {
      if (x.side === 'buy') { qty += x.tokens; cost += x.sol; continue; }
      const sold = Math.min(x.tokens, qty);
      const avg = qty > 0 ? cost / qty : 0;
      realized += x.sol - avg * sold;
      cost -= avg * sold;
      qty -= sold;
    }
    const held = this.wallet.tokens[tokenId]?.amount ?? 0;
    const tracked = Math.min(held, qty);
    const avgCostSol = qty > 0 ? cost / qty : 0;
    const px = this.markets[tokenId]?.priceUsd;
    const sol = this.solUsd;
    const valueUsd = px != null ? tracked * px : null;
    const costUsd = sol != null ? tracked * avgCostSol * sol : null;
    const unrealizedUsd = valueUsd != null && costUsd != null ? valueUsd - costUsd : null;
    const realizedUsd = sol != null ? realized * sol : null;
    return {
      held, tracked, avgCostSol, valueUsd, costUsd, unrealizedUsd, realizedUsd,
      totalUsd: unrealizedUsd != null && realizedUsd != null ? unrealizedUsd + realizedUsd : null,
      pct: unrealizedUsd != null && costUsd ? unrealizedUsd / costUsd : null,
      untrackedQty: Math.max(0, held - qty),
    };
  }

  /** Returns false when the wallet extension isn't installed. */
  async connectWallet(id: string): Promise<boolean> {
    const w = getWallet(id);
    if (!w) return false;
    const r = await w.connect();
    const pk = (r && 'publicKey' in r ? r.publicKey : w.publicKey)?.toBase58();
    if (!pk) throw new Error('Wallet did not return an address.');
    await this.setConnected(w, id, pk);
    return true;
  }

  async disconnectWallet() {
    try { await this.provider?.disconnect(); } catch { /* ignore */ }
    await supabase?.auth.signOut();
    this.provider = undefined;
    this.wallet = { connected: false, signedIn: false, solBalance: null, tokens: {} };
    this.ledger = [];
    ls.set('battle.wallet', null);
    this.bump();
  }

  /** Sign in with Solana (message signature, no transaction) → Supabase session for chat, listing and challenges. */
  async signIn() {
    if (!supabase) throw new Error('Backend not configured.');
    if (!this.provider) throw new Error('Connect a wallet first.');
    // The message's URI must be a plain URL: wallets (Phantom) reject Sign-In-With-Solana
    // messages whose URI carries the hash route (e.g. https://site/#/launch).
    const { error } = await supabase.auth.signInWithWeb3({
      chain: 'solana',
      statement: 'Sign in to BATTLE. This signature does not move funds.',
      wallet: siwsAdapter(this.provider),
      options: { url: `${location.origin}/` },
    });
    if (error) throw error;
    await this.syncSession();
  }

  private async syncSession() {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const meta = data.session?.user?.user_metadata ?? {};
    const addr = String(meta.custom_claims?.address ?? meta.address ?? meta.wallet_address ?? '').replace(/^solana:/, '');
    this.wallet.signedIn = !!data.session && (!this.wallet.address || addr === this.wallet.address);
    this.bump();
  }

  async refreshBalances() {
    const a = this.wallet.address;
    if (!a) return;
    try {
      const [s, t] = await Promise.all([solBalance(a), tokenBalances(a)]);
      this.wallet.solBalance = s;
      this.wallet.tokens = t;
    } catch (e) {
      this.emit({ type: 'toast', title: 'Could not load wallet balances', body: (e as Error).message, tone: 'bad' });
    }
    this.bump();
  }

  /* ------------------------------------------------------------ trading (Jupiter, real swaps) */
  quote(tokenId: TokenId, side: TradeSide, amount: number, slippage: number): Promise<Quote> {
    return getQuote(tokenId, side, amount, slippage);
  }

  async executeTrade(q: Quote, battleId?: BattleId): Promise<TradeResult> {
    if (!this.provider || !this.wallet.address) return { ok: false, error: 'Connect a wallet to trade.' };
    try {
      const tx = await buildSwap(q, this.wallet.address);
      const signature = await signAndSend(this.provider, tx);
      await confirm(signature);
      const b = battleId ? this.getBattle(battleId) : undefined;
      const solAmount = q.side === 'buy' ? q.inputAmount : q.outputAmount;
      const tokenAmount = q.side === 'buy' ? q.outputAmount : q.inputAmount;
      this.addLedger({ tx: signature, tokenId: q.tokenId, side: q.side, sol: solAmount, tokens: tokenAmount, t: Date.now() });
      if (supabase && this.wallet.signedIn) {
        await supabase.from('battle_swaps').insert({
          tx: signature, battle_id: b?.status === 'live' ? b.id : null, wallet: this.wallet.address, token: q.tokenId, side: q.side,
          sol_amount: solAmount, token_amount: tokenAmount, fee_sol: (solAmount * q.feeBps) / 10_000,
        });
      }
      let joinedArmy: TokenId | undefined;
      if (b?.status === 'live' && q.side === 'buy') {
        if (this.armies[b.id] !== q.tokenId) joinedArmy = q.tokenId;
        this.armies[b.id] = q.tokenId;
        ls.set('battle.armies', this.armies);
      }
      void this.refreshBalances();
      return { ok: true, signature, joinedArmy };
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      return { ok: false, error: /reject|denied|cancel/i.test(msg) ? 'You rejected the transaction in your wallet. Nothing was sent.' : msg };
    }
  }

  /* ------------------------------------------------------------ listing, challenges */
  private async invoke<T>(fn: string, body: unknown): Promise<T> {
    if (!supabase) throw new Error('Backend not configured.');
    const { data, error } = await supabase.functions.invoke(fn, { body: body as FormData });
    if (error) {
      const ctx = (error as { context?: Response }).context;
      const b = ctx ? await ctx.json().catch(() => null) : null;
      throw Object.assign(new Error(b?.error ?? error.message), { retry: !!b?.retry });
    }
    return data as T;
  }

  private addListed(r: any) {
    this.tokens[r.mint] = mapToken({ ...r, listed_at: new Date().toISOString() });
    void this.refreshMarkets();
    return this.tokens[r.mint];
  }

  async listToken(mint: string, description: string) {
    const { token } = await this.invoke<{ token: any }>('list-token', { mint, description });
    return this.addListed(token);
  }

  /** A launch that was paid and landed on-chain but not yet registered (e.g. the tab closed). */
  pendingLaunch() { return ls.get<{ mint: string; signature: string; symbol: string } | null>('battle.pendingLaunch', null); }

  /** Registers a landed launch with the backend; retries while the RPC catches up. */
  async finishLaunch(p: { mint: string; signature: string }) {
    for (let i = 0; ; i++) {
      try {
        const { token } = await this.invoke<{ token: any }>('launch-token', p);
        ls.set('battle.pendingLaunch', null);
        return this.addListed(token);
      } catch (e) {
        if (!(e as { retry?: boolean }).retry || i >= 9) throw e;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  /**
   * Creates a new token on pump.fun: the backend uploads metadata and builds the create
   * transaction (with the BATTLE launch fee inside it); we co-sign with a fresh mint keypair
   * and the user's wallet signs and sends. Nothing is charged unless the launch lands.
   */
  async launchToken(input: { name: string; symbol: string; description: string; image: File; devBuySol: number; socials: { website?: string; x?: string; telegram?: string } }, onStep?: (s: string) => void) {
    if (!this.provider || !this.wallet.address) throw new Error('Connect a wallet first.');
    const mint = Keypair.generate();
    const f = new FormData();
    f.append('name', input.name);
    f.append('symbol', input.symbol);
    f.append('description', input.description);
    f.append('devBuySol', String(input.devBuySol));
    f.append('mint', mint.publicKey.toBase58());
    f.append('file', input.image);
    for (const [k, v] of Object.entries(input.socials)) if (v) f.append(k, v);
    onStep?.('Uploading metadata…');
    const prep = await this.invoke<{ tx: string; feeSol: number }>('launch-token', f);
    const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(prep.tx), (c) => c.charCodeAt(0)));
    tx.sign([mint]);
    onStep?.('Approve in your wallet…');
    const r = await this.provider.signAndSendTransaction(tx);
    const signature = typeof r === 'string' ? r : r.signature;
    const pending = { mint: mint.publicKey.toBase58(), signature, symbol: input.symbol };
    ls.set('battle.pendingLaunch', pending);
    onStep?.('Confirming on Solana…');
    await confirm(signature, 90_000);
    onStep?.('Listing on BATTLE…');
    const token = await this.finishLaunch(pending);
    void this.refreshBalances();
    return { token, signature };
  }

  /** The connected wallet's wrapped-SOL token account, which can receive the treasury swap fee. */
  async feeAccountStatus() {
    if (!this.wallet.address) return null;
    const address = associatedTokenAddress(this.wallet.address, SOL_MINT);
    return { address, exists: await accountExists(address) };
  }

  async createFeeAccount() {
    if (!this.provider || !this.wallet.address) throw new Error('Connect a wallet first.');
    const r = await this.provider.signAndSendTransaction(await createAtaTx(this.wallet.address, SOL_MINT));
    await confirm(typeof r === 'string' ? r : r.signature);
    return associatedTokenAddress(this.wallet.address, SOL_MINT);
  }

  async launchFees() {
    if (!supabase) return [] as { feeUsd: number; feeSol: number; t: number }[];
    const { data } = await supabase.from('launches').select('fee_usd, fee_lamports, launched_at').order('launched_at', { ascending: false }).limit(5000);
    return (data ?? []).map((r) => ({ feeUsd: +r.fee_usd, feeSol: r.fee_lamports / 1e9, t: Date.parse(r.launched_at) }));
  }

  /** Starts a battle between any two listed coins. No accept step: it goes live at `start` (or within a minute). */
  async createBattle(a: TokenId, b: TokenId, rules: BattleRules, start: number) {
    if (!supabase) throw new Error('Backend not configured.');
    const { data, error } = await supabase.rpc('create_battle', {
      p_a: a, p_b: b, p_rules: rules, p_rules_hash: rulesHash(rules, a, b), p_start: new Date(start).toISOString(),
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  /* ------------------------------------------------------------ chat */
  async postChat(battleId: BattleId, text: string) {
    if (!supabase || !this.wallet.signedIn) throw new Error('Sign in with your wallet to chat.');
    const { error } = await supabase.from('chat_messages').insert({ battle_id: battleId, wallet: this.wallet.address, text: text.trim().slice(0, 280), army: this.armies[battleId] ?? null });
    if (error) throw new Error(error.message);
  }

  async deleteChat(msgId: number) {
    await supabase?.from('chat_messages').update({ deleted: true }).eq('id', msgId);
  }

  async reportChat(msgId: number) {
    this.chatPrefs.reported.add(msgId);
    ls.set('battle.reported', [...this.chatPrefs.reported]);
    if (supabase && this.wallet.signedIn) await supabase.from('chat_reports').insert({ message_id: msgId });
    this.emit({ type: 'toast', title: 'Message reported', body: 'Hidden for you and sent to moderators.', tone: 'info' });
    this.bump();
  }

  toggleMute(w: string) { this.toggle('muted', w); }
  toggleBlock(w: string) { this.toggle('blocked', w); }
  private toggle(k: 'muted' | 'blocked', w: string) {
    const s = this.chatPrefs[k];
    if (s.has(w)) s.delete(w); else s.add(w);
    ls.set(`battle.${k}`, [...s]);
    this.bump();
  }

  get rpcUrl() { return config.rpcUrl; }
}
