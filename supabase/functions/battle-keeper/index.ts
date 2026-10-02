// BATTLE keeper — runs every minute (pg_cron → pg_net → this function).
//
// Starts scheduled battles, samples live market data, ingests trades, runs
// integrity heuristics, computes Battle Scores, performs drand-based random end
// checks, finalizes results, advances tournament brackets and verifies swaps
// made through the app. All writes use the service role; browsers only read.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (provided by Supabase),
//      KEEPER_SECRET (required), BIRDEYE_API_KEY (optional, holder counts),
//      SOLANA_RPC_URL (optional, swap verification), FEE_ACCOUNT (optional).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { BattleRules, EndCheck, ScoreInputs, SideScore } from '../_shared/types.ts';
import { canonical, makeRules, rulesHash } from '../_shared/rules.ts';
import { computeScores } from '../_shared/score.ts';
import { drandRoundAfter, drandRoundTime, drandRoundUrl, endCheckValue } from '../_shared/randomEnd.ts';
import { analyzeTrades, type TradeLite } from '../_shared/integrity.ts';

const MIN = 60_000;
const env = (k: string) => Deno.env.get(k) ?? '';

// ------------------------------------------------------------------ market data
interface Mkt { priceUsd: number; mcapUsd: number; liqUsd: number; holders: number | null; pair: string }

async function fetchJson(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

/** DexScreener: batch of up to 30 mints → market for the token's listed pair. */
async function markets(tokens: { mint: string; pair_address: string }[]): Promise<Map<string, Mkt>> {
  const out = new Map<string, Mkt>();
  for (let i = 0; i < tokens.length; i += 30) {
    const chunk = tokens.slice(i, i + 30);
    const pairs: any[] = await fetchJson(`https://api.dexscreener.com/tokens/v1/solana/${chunk.map((t) => t.mint).join(',')}`);
    for (const t of chunk) {
      const own = pairs.filter((p) => p.baseToken?.address === t.mint);
      const deepest = own.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      const listed = own.find((x) => x.pairAddress === t.pair_address);
      // Keep the listed pool unless it has been drained (e.g. a graduated bonding curve).
      const p = listed && (listed.liquidity?.usd ?? 0) * 2 >= (deepest?.liquidity?.usd ?? 0) ? listed : deepest;
      if (!p) continue;
      out.set(t.mint, { priceUsd: +p.priceUsd, mcapUsd: +(p.marketCap ?? p.fdv ?? 0), liqUsd: +(p.liquidity?.usd ?? 0), holders: null, pair: p.pairAddress });
    }
  }
  const key = env('BIRDEYE_API_KEY');
  if (key) {
    await Promise.all([...out.keys()].map(async (mint) => {
      try {
        const j = await fetchJson(`https://public-api.birdeye.so/defi/token_overview?address=${mint}`, { headers: { 'X-API-KEY': key, 'x-chain': 'solana' } });
        const h = j?.data?.holder;
        if (typeof h === 'number') out.get(mint)!.holders = h;
      } catch { /* holder data unavailable this minute */ }
    }));
  }
  return out;
}

/**
 * A token's listed pool can disappear (a pump.fun bonding curve graduating to PumpSwap,
 * a migrated pool). When it does, follow the token's deepest live pool.
 */
async function syncPairs(db: Db, tokens: { mint: string; pair_address: string }[], mk: Map<string, Mkt>) {
  for (const t of tokens) {
    const pair = mk.get(t.mint)?.pair;
    if (pair && pair !== t.pair_address) {
      await db.from('tokens').update({ pair_address: pair }).eq('mint', t.mint);
      t.pair_address = pair;
    }
  }
}

/** GeckoTerminal: latest trades for a pool, normalised to buy/sell of `mint`. */
async function poolTrades(pair: string, mint: string) {
  const j = await fetchJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pair}/trades`, { headers: { accept: 'application/json' } });
  return (j.data ?? []).map((d: any) => {
    const a = d.attributes;
    return {
      tx: a.tx_hash as string,
      wallet: a.tx_from_address as string,
      side: (a.to_token_address === mint ? 'buy' : 'sell') as 'buy' | 'sell',
      usd: +a.volume_in_usd,
      ts: new Date(a.block_timestamp).getTime(),
    };
  });
}

async function drand(round: number): Promise<string> {
  const j = await fetchJson(drandRoundUrl(round));
  return j.randomness as string;
}

// ------------------------------------------------------------------ helpers
type Db = SupabaseClient;
const feed = (db: Db, battle_id: string, kind: string, text: string, token?: string) =>
  db.from('battle_feed').insert({ battle_id, kind, text, token: token ?? null });

/** Only the allowed knobs (type, minimum, split) may differ from the standard rules. */
function rulesValid(r: BattleRules) {
  try {
    const rebuilt = makeRules({ type: r.type, minDurationMs: r.randomEnd.minDurationMs, split: r.rewardSplit });
    const s = r.rewardSplit;
    const splitOk = [s.winnerLiquidity, s.holderRewards, s.platform].every((x) => x >= 0 && x <= 1) && Math.abs(s.winnerLiquidity + s.holderRewards + s.platform - 1) < 1e-6;
    return splitOk && r.randomEnd.minDurationMs <= 3 * 3_600_000 && canonical(rebuilt) === canonical(r);
  } catch { return false; }
}

// ------------------------------------------------------------------ start
async function startBattles(db: Db, log: string[]) {
  const { data: due } = await db.from('battles').select('*, ta:tokens!battles_token_a_fkey(*), tb:tokens!battles_token_b_fkey(*)')
    .eq('status', 'scheduled').lte('scheduled_start', new Date().toISOString());
  if (!due?.length) return;
  const { data: live } = await db.from('battles').select('token_a, token_b').eq('status', 'live');
  const busy = new Set((live ?? []).flatMap((b) => [b.token_a, b.token_b]));
  const mk = await markets(due.flatMap((b) => [b.ta, b.tb]));
  await syncPairs(db, due.flatMap((b) => [b.ta, b.tb]), mk);
  for (const b of due) {
    if (!rulesValid(b.rules) || rulesHash(b.rules, b.token_a, b.token_b) !== b.rules_hash) {
      await db.from('battles').update({ status: 'cancelled' }).eq('id', b.id);
      log.push(`cancelled ${b.id}: rules failed validation`);
      continue;
    }
    if (busy.has(b.token_a) || busy.has(b.token_b)) {
      await db.from('battles').update({ scheduled_start: new Date(Date.now() + MIN).toISOString() }).eq('id', b.id);
      continue;
    }
    const A = mk.get(b.token_a), B = mk.get(b.token_b);
    if (!A || !B) { log.push(`postponed ${b.id}: no market data`); continue; }
    const now = new Date().toISOString();
    await db.from('battles').update({
      status: 'live', started_at: now, last_sample_at: now,
      start_price_a: A.priceUsd, start_price_b: B.priceUsd, start_holders_a: A.holders, start_holders_b: B.holders,
      start_liq_a: A.liqUsd, start_liq_b: B.liqUsd, start_mcap_a: A.mcapUsd, start_mcap_b: B.mcapUsd,
      state: { leader: null, a: { ...A, volumeUsd: 0, flaggedUsd: 0, buyers: 0, sellers: 0 }, b: { ...B, volumeUsd: 0, flaggedUsd: 0, buyers: 0, sellers: 0 }, traders: 0, holderMilestone: { a: 0, b: 0 } },
    }).eq('id', b.id);
    await feed(db, b.id, 'lead', `⚔️ Battle started. Rules locked · commitment ${b.rules_hash.slice(0, 10)}…`);
    busy.add(b.token_a); busy.add(b.token_b);
    log.push(`started #${b.number}`);
  }
}

// ------------------------------------------------------------------ live update
async function updateLive(db: Db, log: string[]) {
  const { data: battles } = await db.from('battles').select('*, ta:tokens!battles_token_a_fkey(*), tb:tokens!battles_token_b_fkey(*)').eq('status', 'live');
  if (!battles?.length) return;
  const mk = await markets(battles.flatMap((b) => [b.ta, b.tb]));
  await syncPairs(db, battles.flatMap((b) => [b.ta, b.tb]), mk);
  const now = Date.now();
  let tradeCalls = 0;

  for (const b of battles) {
    try {
      const A = mk.get(b.token_a), B = mk.get(b.token_b);
      if (!A || !B) { log.push(`#${b.number}: market data missing`); continue; }
      const started = new Date(b.started_at).getTime();
      const dt = now - new Date(b.last_sample_at ?? b.started_at).getTime();
      const twA = b.tw_acc_a + Math.log(A.priceUsd / b.start_price_a) * dt;
      const twB = b.tw_acc_b + Math.log(B.priceUsd / b.start_price_b) * dt;
      const twT = b.tw_time_ms + dt;

      // Trades (GeckoTerminal free tier ≈ 30 calls/min).
      const prevState = b.state ?? {};
      for (const [tok, side] of [[b.ta, 'a'], [b.tb, 'b']] as const) {
        if (tradeCalls >= 26) break;
        tradeCalls++;
        try {
          const rows = (await poolTrades(tok.pair_address, tok.mint)).filter((t: { ts: number }) => t.ts >= started);
          if (rows.length) {
            await db.from('battle_trades').upsert(rows.map((t: any) => ({ battle_id: b.id, token: tok.mint, tx: t.tx, wallet: t.wallet, side: t.side, usd: t.usd, ts: new Date(t.ts).toISOString() })), { onConflict: 'battle_id,tx,token', ignoreDuplicates: true });
            const lastSeen = prevState[`lastTradeTs_${side}`] ?? started;
            const tk = tok.symbol;
            for (const t of rows.filter((x: any) => x.ts > lastSeen && x.usd >= 250).slice(0, 5)) {
              await feed(db, b.id, t.usd >= 2000 ? 'whale' : 'trade', `${t.usd >= 2000 ? '🐋 ' : ''}Wallet ${t.wallet.slice(0, 4)}… ${t.side === 'buy' ? 'bought' : 'sold'} $${Math.round(t.usd).toLocaleString('en-US')} ${tk}`, tok.mint);
            }
            prevState[`lastTradeTs_${side}`] = Math.max(lastSeen, ...rows.map((x: any) => x.ts));
          }
        } catch (e) { log.push(`#${b.number} trades ${tok.symbol}: ${e}`); }
      }

      // Integrity + market-quality inputs from all battle trades.
      const { data: trades } = await db.from('battle_trades').select('token, wallet, side, usd, ts, flagged').eq('battle_id', b.id).limit(20000);
      const sideStats = async (tok: any) => {
        const list = (trades ?? []).filter((t) => t.token === tok.mint);
        const flaggedWallets = new Set(list.filter((t) => t.flagged).map((t) => t.wallet));
        const lite: TradeLite[] = list.map((t) => ({ wallet: t.wallet, side: t.side, usd: t.usd, ts: new Date(t.ts).getTime() }));
        for (const f of analyzeTrades(lite, flaggedWallets, tok.symbol)) {
          if (f.kind === 'community-surge') {
            const { data: recent } = await db.from('integrity_events').select('id').eq('battle_id', b.id).eq('token', tok.mint).eq('kind', 'community-surge').gte('ts', new Date(now - 15 * MIN).toISOString()).limit(1);
            if (recent?.length) continue;
          } else {
            await db.from('battle_trades').update({ flagged: true }).eq('battle_id', b.id).eq('token', tok.mint).in('wallet', f.wallets);
            f.wallets.forEach((w) => flaggedWallets.add(w));
            list.forEach((t) => { if (f.wallets.includes(t.wallet)) t.flagged = true; });
          }
          await db.from('integrity_events').insert({ battle_id: b.id, token: tok.mint, kind: f.kind, severity: f.severity, title: f.title, detail: f.detail, wallets: f.wallets.length, excluded_usd: f.excludedUsd });
          await feed(db, b.id, f.severity === 'alert' ? 'alert' : 'surge', f.severity === 'alert' ? `⚠️ ${f.title} — activity excluded` : `📣 ${f.title}`, tok.mint);
        }
        const volumeUsd = list.reduce((s, t) => s + t.usd, 0);
        const flaggedUsd = list.filter((t) => t.flagged).reduce((s, t) => s + t.usd, 0);
        const net = new Map<string, number>();
        for (const t of list) if (!t.flagged) net.set(t.wallet, (net.get(t.wallet) ?? 0) + (t.side === 'buy' ? t.usd : -t.usd));
        const pos = [...net.values()].filter((v) => v > 0).sort((x, y) => y - x);
        const totalPos = pos.reduce((s, v) => s + v, 0);
        const top10 = pos.slice(0, 10).reduce((s, v) => s + v, 0);
        return {
          volumeUsd, flaggedUsd,
          buyers: new Set(list.filter((t) => t.side === 'buy').map((t) => t.wallet)).size,
          sellers: new Set(list.filter((t) => t.side === 'sell').map((t) => t.wallet)).size,
          wallets: new Set(list.map((t) => t.wallet)),
          distribution: totalPos > 0 ? Math.max(0, Math.min(1, 1 - top10 / totalPos)) : 0.5,
          organicFlow: volumeUsd > 0 ? 1 - flaggedUsd / volumeUsd : 1,
          flaggedWallets: flaggedWallets.size,
        };
      };
      const sa = await sideStats(b.ta);
      const sb = await sideStats(b.tb);
      const inputs = (m: Mkt, s: typeof sa, startPrice: number, startHolders: number | null, startLiq: number, tw: number): ScoreInputs => ({
        twReturn: twT > 0 ? tw / twT : 0,
        currentReturn: m.priceUsd / startPrice - 1,
        holdersStart: startHolders,
        holdersNow: m.holders !== null && startHolders !== null ? Math.max(0, m.holders - s.flaggedWallets) : null,
        distribution: s.distribution,
        organicFlow: s.organicFlow,
        liquidityRetention: startLiq > 0 ? Math.min(1, m.liqUsd / startLiq) : 1,
      });
      const [scA, scB] = computeScores(b.rules, inputs(A, sa, b.start_price_a, b.start_holders_a, b.start_liq_a, twA), inputs(B, sb, b.start_price_b, b.start_holders_b, b.start_liq_b, twB));
      const leader = scA.total >= scB.total ? b.token_a : b.token_b;
      const strip = (s: typeof sa) => ({ volumeUsd: s.volumeUsd, flaggedUsd: s.flaggedUsd, buyers: s.buyers, sellers: s.sellers, flaggedWallets: s.flaggedWallets });
      const state = {
        ...prevState,
        leader,
        a: { ...A, ...strip(sa), score: scA },
        b: { ...B, ...strip(sb), score: scB },
        traders: new Set([...sa.wallets, ...sb.wallets]).size,
        leadChanges: (prevState.leadChanges ?? 0) + (prevState.leader && prevState.leader !== leader ? 1 : 0),
      };

      // Notable moments.
      if (prevState.leader && prevState.leader !== leader) {
        const t = leader === b.token_a ? b.ta : b.tb;
        await feed(db, b.id, 'lead', `⚡ $${t.symbol} takes the lead`, leader);
      }
      const pa = prevState.a?.score?.total, pb = prevState.b?.score?.total;
      if (pa !== undefined && Math.abs(Math.round(scA.total) - Math.round(pa)) >= 3) await feed(db, b.id, 'score', `📊 Battle Score changed: ${b.ta.symbol} ${Math.round(pa)} → ${Math.round(scA.total)}`, b.token_a);
      if (pb !== undefined && Math.abs(Math.round(scB.total) - Math.round(pb)) >= 3) await feed(db, b.id, 'score', `📊 Battle Score changed: ${b.tb.symbol} ${Math.round(pb)} → ${Math.round(scB.total)}`, b.token_b);
      const hm = prevState.holderMilestone ?? { a: 0, b: 0 };
      for (const [m, start, k, t] of [[A, b.start_holders_a, 'a', b.ta], [B, b.start_holders_b, 'b', b.tb]] as const) {
        if (m.holders === null || start === null) continue;
        const gained = Math.floor((m.holders - start) / 100) * 100;
        if (gained > 0 && gained > hm[k]) { hm[k] = gained; await feed(db, b.id, 'holders', `🎉 ${gained} new ${t.symbol} holders since the battle started`, t.mint); }
      }
      state.holderMilestone = hm;

      await db.from('battle_snapshots').insert({
        battle_id: b.id, t: new Date(now).toISOString(),
        price_a: A.priceUsd, price_b: B.priceUsd, mcap_a: A.mcapUsd, mcap_b: B.mcapUsd, liq_a: A.liqUsd, liq_b: B.liqUsd,
        holders_a: A.holders, holders_b: B.holders, score_a: scA.total, score_b: scB.total,
      });
      await db.from('battles').update({ tw_acc_a: twA, tw_acc_b: twB, tw_time_ms: twT, last_sample_at: new Date(now).toISOString(), state }).eq('id', b.id);

      await runEndChecks(db, b, started, now, { A, B, scA, scB, sa, sb }, log);
    } catch (e) {
      log.push(`#${b.number}: ${e}`);
    }
  }
}

// ------------------------------------------------------------------ random end
async function runEndChecks(db: Db, b: any, started: number, now: number, s: { A: Mkt; B: Mkt; scA: SideScore; scB: SideScore; sa: any; sb: any }, log: string[]) {
  const r: BattleRules = b.rules;
  const { minDurationMs, epochMs, hazardPerEpoch, maxDurationMs } = r.randomEnd;
  const { count } = await db.from('end_checks').select('*', { count: 'exact', head: true }).eq('battle_id', b.id);
  let k = (count ?? 0) + 1;
  while (true) {
    const at = minDurationMs + k * epochMs;
    if (started + at > now) return;
    if (at >= maxDurationMs) return finalize(db, b, maxDurationMs, null, true, s, log);
    const round = drandRoundAfter(started + at);
    if (drandRoundTime(round) > now) return; // beacon round not published yet
    const randomness = await drand(round);
    const value = endCheckValue(b.id, b.rules_hash, randomness);
    const check: EndCheck = { index: k, at, beaconRound: round, beaconRandomness: randomness, value, threshold: hazardPerEpoch, ended: value < hazardPerEpoch };
    const { error } = await db.from('end_checks').insert({ battle_id: b.id, idx: k, at_ms: at, round, randomness, value, threshold: hazardPerEpoch, ended: check.ended });
    if (error) { log.push(`#${b.number} end check ${k}: ${error.message}`); return; }
    if (check.ended) return finalize(db, b, at, check, false, s, log);
    k++;
  }
}

async function finalize(db: Db, b: any, at: number, check: EndCheck | null, hitCap: boolean, s: { A: Mkt; B: Mkt; scA: SideScore; scB: SideScore; sa: any; sb: any }, log: string[]) {
  const aWins = s.scA.total !== s.scB.total ? s.scA.total > s.scB.total : s.scA.inputs.twReturn >= s.scB.inputs.twReturn;
  const winner = aWins ? b.token_a : b.token_b;
  const final = {
    durationMs: at, scoreA: s.scA, scoreB: s.scB,
    marketCapA: s.A.mcapUsd, marketCapB: s.B.mcapUsd,
    returnA: s.A.priceUsd / b.start_price_a - 1, returnB: s.B.priceUsd / b.start_price_b - 1,
    holderGrowthA: s.scA.holderGrowthPct, holderGrowthB: s.scB.holderGrowthPct,
    holdersA: s.A.holders, holdersB: s.B.holders,
    integrityA: s.sa.volumeUsd > 0 ? Math.round(100 * (1 - s.sa.flaggedUsd / s.sa.volumeUsd)) : 100,
    integrityB: s.sb.volumeUsd > 0 ? Math.round(100 * (1 - s.sb.flaggedUsd / s.sb.volumeUsd)) : 100,
    endCheck: check, hitCap,
  };
  const endedAt = new Date(new Date(b.started_at).getTime() + at).toISOString();
  await db.from('battles').update({ status: 'ended', ended_at: endedAt, winner, final }).eq('id', b.id);
  const w = winner === b.token_a ? b.ta : b.tb;
  await feed(db, b.id, 'lead', `🏆 BATTLE OVER — $${w.symbol} wins`, winner);
  log.push(`ended #${b.number}: ${w.symbol} wins`);
  if (b.tournament_id) await advanceTournament(db, b, winner);
}

// ------------------------------------------------------------------ tournaments
async function createMatchBattle(db: Db, t: any, round: number, slot: number, a: string, bb: string, start: number) {
  const rules = t.rules as BattleRules;
  const { data } = await db.from('battles').insert({
    token_a: a, token_b: bb, status: 'scheduled', rules, rules_hash: rulesHash(rules, a, bb), created_by: 'tournament',
    scheduled_start: new Date(start).toISOString(), tournament_id: t.id, match_round: round, match_slot: slot,
  }).select('id').single();
  await db.from('tournament_matches').update({ battle_id: data!.id }).eq('tournament_id', t.id).eq('round', round).eq('slot', slot);
}

async function startTournaments(db: Db, log: string[]) {
  const { data: due } = await db.from('tournaments').select('*').eq('status', 'upcoming').lte('scheduled_start', new Date().toISOString());
  for (const t of due ?? []) {
    await db.from('tournaments').update({ status: 'live', started_at: new Date().toISOString() }).eq('id', t.id);
    const { data: ms } = await db.from('tournament_matches').select('*').eq('tournament_id', t.id).eq('round', 0).order('slot');
    for (const m of ms ?? []) await createMatchBattle(db, t, 0, m.slot, m.token_a, m.token_b, Date.now() + (2 + m.slot * 2) * MIN);
    log.push(`tournament ${t.slug} started`);
  }
}

async function advanceTournament(db: Db, b: any, winner: string) {
  const { data: t } = await db.from('tournaments').select('*').eq('id', b.tournament_id).single();
  if (!t) return;
  await db.from('tournament_matches').update({ winner }).eq('tournament_id', t.id).eq('round', b.match_round).eq('slot', b.match_slot);
  const rounds = Math.log2(t.size);
  if (b.match_round === rounds - 1) {
    await db.from('tournaments').update({ status: 'completed', ended_at: new Date().toISOString(), champion: winner }).eq('id', t.id);
    return;
  }
  const nr = b.match_round + 1, ns = Math.floor(b.match_slot / 2);
  await db.from('tournament_matches').update(b.match_slot % 2 === 0 ? { token_a: winner } : { token_b: winner }).eq('tournament_id', t.id).eq('round', nr).eq('slot', ns);
  const { data: m } = await db.from('tournament_matches').select('*').eq('tournament_id', t.id).eq('round', nr).eq('slot', ns).single();
  if (m?.token_a && m?.token_b && !m.battle_id) await createMatchBattle(db, t, nr, ns, m.token_a, m.token_b, Date.now() + 4 * MIN);
}

/** Admin: create a bracket of listed tokens (seeding order = array order). */
async function createTournament(db: Db, body: any) {
  const tokens: string[] = body.tokens;
  if (![4, 8].includes(tokens.length)) throw new Error('tokens must have 4 or 8 mints');
  const rules = makeRules({ type: body.type ?? 'classic' });
  const { data: t, error } = await db.from('tournaments').insert({
    slug: body.slug, name: body.name, tagline: body.tagline ?? null, hue: body.hue ?? 45, size: tokens.length,
    prize_note: body.prize_note ?? null, rules, scheduled_start: body.start ?? new Date(Date.now() + 10 * MIN).toISOString(),
  }).select('*').single();
  if (error) throw error;
  const rows: Record<string, unknown>[] = [];
  for (let r = 0; r < Math.log2(tokens.length); r++) {
    const count = tokens.length / 2 ** (r + 1);
    for (let s = 0; s < count; s++) rows.push({ tournament_id: t.id, round: r, slot: s, token_a: r === 0 ? tokens[s * 2] : null, token_b: r === 0 ? tokens[s * 2 + 1] : null });
  }
  await db.from('tournament_matches').insert(rows);
  return t;
}

// ------------------------------------------------------------------ swap verification
async function verifySwaps(db: Db, log: string[]) {
  const rpc = env('SOLANA_RPC_URL');
  if (!rpc) return;
  const fee = env('FEE_ACCOUNT');
  const { data: swaps } = await db.from('battle_swaps').select('*').eq('verified', false).gte('created_at', new Date(Date.now() - 60 * MIN).toISOString()).limit(25);
  for (const s of swaps ?? []) {
    try {
      const j = await fetchJson(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [s.tx, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }] }) });
      const tx = j.result;
      if (!tx) continue;
      const keys: string[] = tx.transaction.message.accountKeys ?? [];
      if (tx.meta?.err || keys[0] !== s.wallet) { await db.from('battle_swaps').delete().eq('tx', s.tx); continue; }
      let feeSol = 0;
      const idx = fee ? keys.indexOf(fee) : -1;
      if (idx >= 0) {
        const pre = tx.meta.preTokenBalances?.find((x: any) => x.accountIndex === idx)?.uiTokenAmount?.uiAmount ?? 0;
        const post = tx.meta.postTokenBalances?.find((x: any) => x.accountIndex === idx)?.uiTokenAmount?.uiAmount ?? 0;
        feeSol = Math.max(0, post - pre);
      }
      await db.from('battle_swaps').update({ verified: true, fee_sol: feeSol }).eq('tx', s.tx);
    } catch (e) { log.push(`verify ${s.tx.slice(0, 8)}: ${e}`); }
  }
}

// ------------------------------------------------------------------ entry
Deno.serve(async (req) => {
  if (req.headers.get('Authorization') !== `Bearer ${env('KEEPER_SECRET')}` || !env('KEEPER_SECRET')) {
    return new Response('unauthorized', { status: 401 });
  }
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));
  if (body.action === 'create_tournament') {
    try { return Response.json({ ok: true, tournament: await createTournament(db, body) }); }
    catch (e) { return Response.json({ ok: false, error: String(e) }, { status: 400 }); }
  }
  const log: string[] = [];
  const step = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { log.push(`${name}: ${e}`); } };
  await step('tournaments', () => startTournaments(db, log));
  await step('start', () => startBattles(db, log));
  await step('live', () => updateLive(db, log));
  await step('swaps', () => verifySwaps(db, log));
  return Response.json({ ok: true, log });
});
