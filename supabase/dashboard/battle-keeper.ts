// supabase/functions/battle-keeper/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";

// supabase/functions/_shared/sha256.ts
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var encoder = new TextEncoder();
function sha256(input) {
  const msg = encoder.encode(input);
  const bitLen = msg.length * 8;
  const padded = new Uint8Array(msg.length + 9 + 63 >> 6 << 6);
  padded.set(msg);
  padded[msg.length] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLen >>> 0);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 4294967296));
  const H = new Uint32Array([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]);
  const W = new Uint32Array(64);
  const rotr = (x, n) => x >>> n | x << 32 - n;
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ W[i - 15] >>> 3;
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ W[i - 2] >>> 10;
      W[i] = W[i - 16] + s0 + W[i - 7] + s1 >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = e & f ^ ~e & g;
      const t1 = h + S1 + ch + K[i] + W[i] >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const t2 = S0 + maj >>> 0;
      h = g;
      g = f;
      f = e;
      e = d + t1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 >>> 0;
    }
    H[0] += a;
    H[1] += b;
    H[2] += c;
    H[3] += d;
    H[4] += e;
    H[5] += f;
    H[6] += g;
    H[7] += h;
  }
  let out = "";
  for (let i = 0; i < 8; i++) out += H[i].toString(16).padStart(8, "0");
  return out;
}
function hexToUnit(hex) {
  return parseInt(hex.slice(0, 13), 16) / 2 ** 52;
}

// supabase/functions/_shared/rules.ts
var MINUTE = 6e4;
var HOUR = 60 * MINUTE;
function hazardFor(epochMs, meanAfterMinMs) {
  return 1 - Math.exp(-epochMs / meanAfterMinMs);
}
var DAY = 24 * HOUR;
var BATTLE_TYPES = {
  classic: { label: "Classic", blurb: "Balanced finish: the final stretch lasts about 10% of the battle on average.", meanAfterMin: 45 * MINUTE, epochMs: MINUTE, share: 0.1 },
  blitz: { label: "Blitz", blurb: "Sharp finish: the final stretch is short (about 5% of the battle).", meanAfterMin: 20 * MINUTE, epochMs: 3e4, share: 0.05 },
  marathon: { label: "Marathon", blurb: "Long finish: the final stretch lasts about 20% of the battle.", meanAfterMin: 90 * MINUTE, epochMs: 2 * MINUTE, share: 0.2 }
};
var DURATIONS = [
  { ms: HOUR, label: "1 hour" },
  { ms: 3 * HOUR, label: "3 hours" },
  { ms: 6 * HOUR, label: "6 hours" },
  { ms: 12 * HOUR, label: "12 hours" },
  { ms: DAY, label: "1 day" },
  { ms: 3 * DAY, label: "3 days" },
  { ms: 7 * DAY, label: "1 week" },
  { ms: 14 * DAY, label: "2 weeks" },
  { ms: 30 * DAY, label: "1 month" },
  { ms: 90 * DAY, label: "3 months" },
  { ms: 180 * DAY, label: "6 months" },
  { ms: 365 * DAY, label: "1 year" }
];
function epochFor(type, minDurationMs) {
  if (minDurationMs <= DAY) return BATTLE_TYPES[type].epochMs;
  if (minDurationMs <= 7 * DAY) return 5 * MINUTE;
  if (minDurationMs <= 31 * DAY) return 15 * MINUTE;
  return HOUR;
}
function sampleEveryMs(rules) {
  return rules.randomEnd.minDurationMs <= DAY ? MINUTE : rules.randomEnd.epochMs;
}
var DEFAULT_SPLIT = { winnerLiquidity: 0.5, holderRewards: 0.25, platform: 0.25 };
var DRAND_QUICKNET = {
  chainHash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  genesisTime: 1692803367,
  periodSec: 3,
  url: "https://api.drand.sh"
};
function makeRules(opts = {}) {
  const type = opts.type ?? "classic";
  const t = BATTLE_TYPES[type];
  const minDurationMs = Math.max(HOUR, opts.minDurationMs ?? HOUR);
  const epochMs = epochFor(type, minDurationMs);
  const meanAfterMin = Math.max(t.meanAfterMin, minDurationMs * t.share);
  const long = minDurationMs > DAY;
  return {
    version: "battle-rules/2.0",
    type,
    randomEnd: {
      minDurationMs,
      epochMs,
      hazardPerEpoch: hazardFor(epochMs, meanAfterMin),
      maxDurationMs: minDurationMs <= 3 * HOUR ? 6 * HOUR : minDurationMs + 4 * meanAfterMin,
      beacon: `drand quicknet ${DRAND_QUICKNET.chainHash.slice(0, 12)}\u2026 (3s rounds)`
    },
    weights: { performance: 0.6, holderGrowth: 0.2, marketQuality: 0.2 },
    perfSteepness: 4,
    holderSteepness: 6,
    rewardSplit: opts.split ?? DEFAULT_SPLIT,
    dataSources: {
      prices: "DexScreener \u2014 highest-liquidity pool, sampled every minute",
      trades: long ? "GeckoTerminal \u2014 pool trades (latest 300 per poll, every few minutes); market quality uses the last 7 days of trades" : "GeckoTerminal \u2014 pool trades (latest 300 per minute)",
      holders: "Birdeye token overview; if unavailable for either token, Holder Growth is neutral (50/50)",
      randomness: "drand quicknet public beacon"
    },
    integrity: { excludeFlagged: true, excludeClusterWallets: true }
  };
}
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
function rulesHash(rules, tokenA, tokenB) {
  return sha256(canonical({ rules, tokenA, tokenB }));
}

// supabase/functions/_shared/score.ts
function softmaxPair(k, x, y) {
  const m = Math.max(k * x, k * y);
  const ex = Math.exp(k * x - m);
  const ey = Math.exp(k * y - m);
  return [100 * ex / (ex + ey), 100 * ey / (ex + ey)];
}
var growth = (i) => i.holdersStart && i.holdersNow !== null && i.holdersStart > 0 ? i.holdersNow / i.holdersStart - 1 : null;
function computeScores(rules, a, b) {
  const [pa, pb] = softmaxPair(rules.perfSteepness, a.twReturn, b.twReturn);
  const ga = growth(a);
  const gb = growth(b);
  const [ha, hb] = ga !== null && gb !== null ? softmaxPair(rules.holderSteepness, ga, gb) : [50, 50];
  const q = (i) => 100 * (i.distribution + i.organicFlow + i.liquidityRetention) / 3;
  const w = rules.weights;
  const mk = (p, h, i, g) => ({
    total: w.performance * p + w.holderGrowth * h + w.marketQuality * q(i),
    performance: p,
    holderGrowth: h,
    marketQuality: q(i),
    holderGrowthPct: g,
    inputs: i
  });
  return [mk(pa, ha, a, ga), mk(pb, hb, b, gb)];
}

// supabase/functions/_shared/randomEnd.ts
function endCheckValue(battleId, rulesHash2, randomness) {
  return hexToUnit(sha256(`${battleId}|${rulesHash2}|${randomness}`));
}
function drandRoundAfter(tMs) {
  const s = tMs / 1e3 - DRAND_QUICKNET.genesisTime;
  return Math.max(1, Math.ceil(s / DRAND_QUICKNET.periodSec) + 1);
}
function drandRoundTime(round) {
  return (DRAND_QUICKNET.genesisTime + (round - 1) * DRAND_QUICKNET.periodSec) * 1e3;
}
function drandRoundUrl(round) {
  return `${DRAND_QUICKNET.url}/${DRAND_QUICKNET.chainHash}/public/${round}`;
}

// supabase/functions/_shared/integrity.ts
var WASH_WINDOW = 10 * 6e4;
var SYNC_WINDOW = 6e4;
function analyzeTrades(trades, alreadyFlagged, ticker) {
  const out = [];
  const byWallet = /* @__PURE__ */ new Map();
  for (const t of trades) {
    const l = byWallet.get(t.wallet) ?? [];
    l.push(t);
    byWallet.set(t.wallet, l);
  }
  const wash = [];
  let washUsd = 0;
  for (const [w, list] of byWallet) {
    if (alreadyFlagged.has(w) || list.length < 4) continue;
    list.sort((x, y) => x.ts - y.ts);
    for (let i = 0; i < list.length; i++) {
      const win = list.filter((t) => t.ts >= list[i].ts && t.ts <= list[i].ts + WASH_WINDOW);
      const buys = win.filter((t) => t.side === "buy");
      const sells = win.filter((t) => t.side === "sell");
      if (buys.length >= 2 && sells.length >= 2) {
        const b = buys.reduce((s2, t) => s2 + t.usd, 0);
        const s = sells.reduce((x, t) => x + t.usd, 0);
        if (Math.abs(b - s) < 0.1 * (b + s)) {
          wash.push(w);
          washUsd += b + s;
          break;
        }
      }
    }
  }
  if (wash.length) {
    out.push({
      kind: "wash-trading",
      severity: "alert",
      wallets: wash,
      excludedUsd: washUsd,
      title: `Wash trading on $${ticker}`,
      detail: `${wash.length} wallet(s) bought and sold matching amounts within 10 minutes with no real position change. Their volume and holdings are excluded from Holder Growth and Market Quality.`
    });
  }
  const sorted = [...trades].filter((t) => !alreadyFlagged.has(t.wallet) && !wash.includes(t.wallet)).sort((x, y) => x.ts - y.ts);
  const synced = /* @__PURE__ */ new Set();
  let syncUsd = 0;
  for (let i = 0; i < sorted.length; i++) {
    const base = sorted[i];
    const group = sorted.filter((t) => t.ts >= base.ts && t.ts <= base.ts + SYNC_WINDOW && t.side === base.side && Math.abs(t.usd - base.usd) <= base.usd * 0.02);
    const wallets = new Set(group.map((t) => t.wallet));
    if (wallets.size >= 6) {
      for (const t of group) if (!synced.has(t.wallet)) {
        synced.add(t.wallet);
        syncUsd += t.usd;
      }
    }
  }
  if (synced.size) {
    out.push({
      kind: "synchronized-trading",
      severity: "alert",
      wallets: [...synced],
      excludedUsd: syncUsd,
      title: `Abnormal synchronized trading on $${ticker}`,
      detail: `${synced.size} wallets traded near-identical sizes within 60 seconds, a pattern consistent with one operator. Excluded from Holder Growth and Market Quality per the published rules.`
    });
  }
  const recent = trades.filter((t) => t.side === "buy" && t.ts >= Date.now() - 5 * 6e4);
  const buyers = new Set(recent.map((t) => t.wallet));
  if (buyers.size >= 25) {
    out.push({
      kind: "community-surge",
      severity: "info",
      wallets: [],
      excludedUsd: 0,
      title: `$${ticker} community surge \u2014 legitimate`,
      detail: `${buyers.size} distinct wallets bought in the last 5 minutes with varied sizes. Collective support is allowed and counted normally.`
    });
  }
  return out;
}

// supabase/functions/battle-keeper/index.ts
var MIN = 6e4;
var env = (k) => Deno.env.get(k) ?? "";
async function fetchJson(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function markets(tokens) {
  const out = /* @__PURE__ */ new Map();
  for (let i = 0; i < tokens.length; i += 30) {
    const chunk = tokens.slice(i, i + 30);
    const pairs = await fetchJson(`https://api.dexscreener.com/tokens/v1/solana/${chunk.map((t) => t.mint).join(",")}`);
    for (const t of chunk) {
      const own = pairs.filter((p2) => p2.baseToken?.address === t.mint);
      const deepest = own.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      const listed = own.find((x) => x.pairAddress === t.pair_address);
      const p = listed && (listed.liquidity?.usd ?? 0) * 2 >= (deepest?.liquidity?.usd ?? 0) ? listed : deepest;
      if (!p) continue;
      out.set(t.mint, { priceUsd: +p.priceUsd, mcapUsd: +(p.marketCap ?? p.fdv ?? 0), liqUsd: +(p.liquidity?.usd ?? 0), holders: null, pair: p.pairAddress });
    }
  }
  const key = env("BIRDEYE_API_KEY");
  if (key) {
    await Promise.all([...out.keys()].map(async (mint) => {
      try {
        const j = await fetchJson(`https://public-api.birdeye.so/defi/token_overview?address=${mint}`, { headers: { "X-API-KEY": key, "x-chain": "solana" } });
        const h = j?.data?.holder;
        if (typeof h === "number") out.get(mint).holders = h;
      } catch {
      }
    }));
  }
  return out;
}
async function syncPairs(db, tokens, mk) {
  for (const t of tokens) {
    const pair = mk.get(t.mint)?.pair;
    if (pair && pair !== t.pair_address) {
      await db.from("tokens").update({ pair_address: pair }).eq("mint", t.mint);
      t.pair_address = pair;
    }
  }
}
var gtBlocked = false;
async function gtJson(url) {
  if (gtBlocked) throw new Error("skipped: GeckoTerminal rate limit");
  try {
    return await fetchJson(url, { headers: { accept: "application/json" } });
  } catch (e) {
    if (String(e).includes("429")) gtBlocked = true;
    throw e;
  }
}
async function poolTrades(pair, mint) {
  const j = await gtJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pair}/trades`);
  return (j.data ?? []).map((d) => {
    const a = d.attributes;
    return {
      tx: a.tx_hash,
      wallet: a.tx_from_address,
      side: a.to_token_address === mint ? "buy" : "sell",
      usd: +a.volume_in_usd,
      ts: new Date(a.block_timestamp).getTime()
    };
  });
}
async function drand(round) {
  const j = await fetchJson(drandRoundUrl(round));
  return j.randomness;
}
var feed = (db, battle_id, kind, text, token) => db.from("battle_feed").insert({ battle_id, kind, text, token: token ?? null });
function rulesValid(r) {
  try {
    const rebuilt = makeRules({ type: r.type, minDurationMs: r.randomEnd.minDurationMs, split: r.rewardSplit });
    const s = r.rewardSplit;
    const splitOk = [s.winnerLiquidity, s.holderRewards, s.platform].every((x) => x >= 0 && x <= 1) && Math.abs(s.winnerLiquidity + s.holderRewards + s.platform - 1) < 1e-6;
    return splitOk && DURATIONS.some((d) => d.ms === r.randomEnd.minDurationMs) && canonical(rebuilt) === canonical(r);
  } catch {
    return false;
  }
}
async function startBattles(db, log) {
  const { data: due } = await db.from("battles").select("*, ta:tokens!battles_token_a_fkey(*), tb:tokens!battles_token_b_fkey(*)").eq("status", "scheduled").lte("scheduled_start", (/* @__PURE__ */ new Date()).toISOString());
  if (!due?.length) return;
  const { data: live } = await db.from("battles").select("token_a, token_b").eq("status", "live");
  const busy = new Set((live ?? []).flatMap((b) => [b.token_a, b.token_b]));
  const mk = await markets(due.flatMap((b) => [b.ta, b.tb]));
  await syncPairs(db, due.flatMap((b) => [b.ta, b.tb]), mk);
  for (const b of due) {
    if (!rulesValid(b.rules) || rulesHash(b.rules, b.token_a, b.token_b) !== b.rules_hash) {
      await db.from("battles").update({ status: "cancelled" }).eq("id", b.id);
      log.push(`cancelled ${b.id}: rules failed validation`);
      continue;
    }
    if (busy.has(b.token_a) || busy.has(b.token_b)) {
      await db.from("battles").update({ scheduled_start: new Date(Date.now() + MIN).toISOString() }).eq("id", b.id);
      continue;
    }
    const A = mk.get(b.token_a), B = mk.get(b.token_b);
    if (!A || !B) {
      log.push(`postponed ${b.id}: no market data`);
      continue;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await db.from("battles").update({
      status: "live",
      started_at: now,
      last_sample_at: now,
      start_price_a: A.priceUsd,
      start_price_b: B.priceUsd,
      start_holders_a: A.holders,
      start_holders_b: B.holders,
      start_liq_a: A.liqUsd,
      start_liq_b: B.liqUsd,
      start_mcap_a: A.mcapUsd,
      start_mcap_b: B.mcapUsd,
      state: { leader: null, a: { ...A, volumeUsd: 0, flaggedUsd: 0, buyers: 0, sellers: 0 }, b: { ...B, volumeUsd: 0, flaggedUsd: 0, buyers: 0, sellers: 0 }, traders: 0, holderMilestone: { a: 0, b: 0 } }
    }).eq("id", b.id);
    await feed(db, b.id, "lead", `\u2694\uFE0F Battle started. Rules locked \xB7 commitment ${b.rules_hash.slice(0, 10)}\u2026`);
    busy.add(b.token_a);
    busy.add(b.token_b);
    log.push(`started #${b.number}`);
  }
}
async function updateLive(db, log) {
  const { data: battles } = await db.from("battles").select("*, ta:tokens!battles_token_a_fkey(*), tb:tokens!battles_token_b_fkey(*)").eq("status", "live");
  if (!battles?.length) return;
  const mk = await markets(battles.flatMap((b) => [b.ta, b.tb]));
  await syncPairs(db, battles.flatMap((b) => [b.ta, b.tb]), mk);
  const now = Date.now();
  const pollIds = new Set(battles.filter((b) => now - (b.state?.lastTradesPoll ?? 0) >= (b.rules.randomEnd.minDurationMs > DAY ? 5 * MIN : 0)).sort((x, y) => (x.state?.lastTradesPoll ?? 0) - (y.state?.lastTradesPoll ?? 0)).slice(0, 6).map((b) => b.id));
  for (const b of battles) {
    try {
      const A = mk.get(b.token_a), B = mk.get(b.token_b);
      if (!A || !B) {
        log.push(`#${b.number}: market data missing`);
        continue;
      }
      const started = new Date(b.started_at).getTime();
      const dt = now - new Date(b.last_sample_at ?? b.started_at).getTime();
      const twA = b.tw_acc_a + Math.log(A.priceUsd / b.start_price_a) * dt;
      const twB = b.tw_acc_b + Math.log(B.priceUsd / b.start_price_b) * dt;
      const twT = b.tw_time_ms + dt;
      const prevState = b.state ?? {};
      if (pollIds.has(b.id)) prevState.lastTradesPoll = now;
      for (const [tok, side] of [[b.ta, "a"], [b.tb, "b"]]) {
        if (!pollIds.has(b.id)) break;
        try {
          const rows = (await poolTrades(tok.pair_address, tok.mint)).filter((t) => t.ts >= started);
          if (rows.length) {
            await db.from("battle_trades").upsert(rows.map((t) => ({ battle_id: b.id, token: tok.mint, tx: t.tx, wallet: t.wallet, side: t.side, usd: t.usd, ts: new Date(t.ts).toISOString() })), { onConflict: "battle_id,tx,token", ignoreDuplicates: true });
            const lastSeen = prevState[`lastTradeTs_${side}`] ?? started;
            const tk = tok.symbol;
            for (const t of rows.filter((x) => x.ts > lastSeen && x.usd >= 250).slice(0, 5)) {
              await feed(db, b.id, t.usd >= 2e3 ? "whale" : "trade", `${t.usd >= 2e3 ? "\u{1F40B} " : ""}Wallet ${t.wallet.slice(0, 4)}\u2026 ${t.side === "buy" ? "bought" : "sold"} $${Math.round(t.usd).toLocaleString("en-US")} ${tk}`, tok.mint);
            }
            prevState[`lastTradeTs_${side}`] = Math.max(lastSeen, ...rows.map((x) => x.ts));
          }
        } catch (e) {
          if (!String(e).includes("skipped")) log.push(`#${b.number} trades ${tok.symbol}: ${e}`);
        }
      }
      const since = b.rules.randomEnd.minDurationMs > DAY ? Math.max(started, now - 7 * DAY) : started;
      const { data: trades } = await db.from("battle_trades").select("token, wallet, side, usd, ts, flagged").eq("battle_id", b.id).gte("ts", new Date(since).toISOString()).order("ts", { ascending: false }).limit(2e4);
      const sideStats = async (tok) => {
        const list = (trades ?? []).filter((t) => t.token === tok.mint);
        const flaggedWallets = new Set(list.filter((t) => t.flagged).map((t) => t.wallet));
        const lite = list.map((t) => ({ wallet: t.wallet, side: t.side, usd: t.usd, ts: new Date(t.ts).getTime() }));
        for (const f of analyzeTrades(lite, flaggedWallets, tok.symbol)) {
          if (f.kind === "community-surge") {
            const { data: recent } = await db.from("integrity_events").select("id").eq("battle_id", b.id).eq("token", tok.mint).eq("kind", "community-surge").gte("ts", new Date(now - 15 * MIN).toISOString()).limit(1);
            if (recent?.length) continue;
          } else {
            await db.from("battle_trades").update({ flagged: true }).eq("battle_id", b.id).eq("token", tok.mint).in("wallet", f.wallets);
            f.wallets.forEach((w) => flaggedWallets.add(w));
            list.forEach((t) => {
              if (f.wallets.includes(t.wallet)) t.flagged = true;
            });
          }
          await db.from("integrity_events").insert({ battle_id: b.id, token: tok.mint, kind: f.kind, severity: f.severity, title: f.title, detail: f.detail, wallets: f.wallets.length, excluded_usd: f.excludedUsd });
          await feed(db, b.id, f.severity === "alert" ? "alert" : "surge", f.severity === "alert" ? `\u26A0\uFE0F ${f.title} \u2014 activity excluded` : `\u{1F4E3} ${f.title}`, tok.mint);
        }
        const volumeUsd = list.reduce((s, t) => s + t.usd, 0);
        const flaggedUsd = list.filter((t) => t.flagged).reduce((s, t) => s + t.usd, 0);
        const net = /* @__PURE__ */ new Map();
        for (const t of list) if (!t.flagged) net.set(t.wallet, (net.get(t.wallet) ?? 0) + (t.side === "buy" ? t.usd : -t.usd));
        const pos = [...net.values()].filter((v) => v > 0).sort((x, y) => y - x);
        const totalPos = pos.reduce((s, v) => s + v, 0);
        const top10 = pos.slice(0, 10).reduce((s, v) => s + v, 0);
        return {
          volumeUsd,
          flaggedUsd,
          buyers: new Set(list.filter((t) => t.side === "buy").map((t) => t.wallet)).size,
          sellers: new Set(list.filter((t) => t.side === "sell").map((t) => t.wallet)).size,
          wallets: new Set(list.map((t) => t.wallet)),
          distribution: totalPos > 0 ? Math.max(0, Math.min(1, 1 - top10 / totalPos)) : 0.5,
          organicFlow: volumeUsd > 0 ? 1 - flaggedUsd / volumeUsd : 1,
          flaggedWallets: flaggedWallets.size
        };
      };
      const sa = await sideStats(b.ta);
      const sb = await sideStats(b.tb);
      const inputs = (m, s, startPrice, startHolders, startLiq, tw) => ({
        twReturn: twT > 0 ? tw / twT : 0,
        currentReturn: m.priceUsd / startPrice - 1,
        holdersStart: startHolders,
        holdersNow: m.holders !== null && startHolders !== null ? Math.max(0, m.holders - s.flaggedWallets) : null,
        distribution: s.distribution,
        organicFlow: s.organicFlow,
        liquidityRetention: startLiq > 0 ? Math.min(1, m.liqUsd / startLiq) : 1
      });
      const [scA, scB] = computeScores(b.rules, inputs(A, sa, b.start_price_a, b.start_holders_a, b.start_liq_a, twA), inputs(B, sb, b.start_price_b, b.start_holders_b, b.start_liq_b, twB));
      const leader = scA.total >= scB.total ? b.token_a : b.token_b;
      const strip = (s) => ({ volumeUsd: s.volumeUsd, flaggedUsd: s.flaggedUsd, buyers: s.buyers, sellers: s.sellers, flaggedWallets: s.flaggedWallets });
      const state = {
        ...prevState,
        leader,
        a: { ...A, ...strip(sa), score: scA },
        b: { ...B, ...strip(sb), score: scB },
        traders: (/* @__PURE__ */ new Set([...sa.wallets, ...sb.wallets])).size,
        leadChanges: (prevState.leadChanges ?? 0) + (prevState.leader && prevState.leader !== leader ? 1 : 0)
      };
      if (prevState.leader && prevState.leader !== leader) {
        const t = leader === b.token_a ? b.ta : b.tb;
        await feed(db, b.id, "lead", `\u26A1 $${t.symbol} takes the lead`, leader);
      }
      const pa = prevState.a?.score?.total, pb = prevState.b?.score?.total;
      if (pa !== void 0 && Math.abs(Math.round(scA.total) - Math.round(pa)) >= 3) await feed(db, b.id, "score", `\u{1F4CA} Battle Score changed: ${b.ta.symbol} ${Math.round(pa)} \u2192 ${Math.round(scA.total)}`, b.token_a);
      if (pb !== void 0 && Math.abs(Math.round(scB.total) - Math.round(pb)) >= 3) await feed(db, b.id, "score", `\u{1F4CA} Battle Score changed: ${b.tb.symbol} ${Math.round(pb)} \u2192 ${Math.round(scB.total)}`, b.token_b);
      const hm = prevState.holderMilestone ?? { a: 0, b: 0 };
      for (const [m, start, k, t] of [[A, b.start_holders_a, "a", b.ta], [B, b.start_holders_b, "b", b.tb]]) {
        if (m.holders === null || start === null) continue;
        const gained = Math.floor((m.holders - start) / 100) * 100;
        if (gained > 0 && gained > hm[k]) {
          hm[k] = gained;
          await feed(db, b.id, "holders", `\u{1F389} ${gained} new ${t.symbol} holders since the battle started`, t.mint);
        }
      }
      state.holderMilestone = hm;
      if (now - (prevState.lastSnapAt ?? 0) >= sampleEveryMs(b.rules) - 5e3) {
        state.lastSnapAt = now;
        await db.from("battle_snapshots").insert({
          battle_id: b.id,
          t: new Date(now).toISOString(),
          price_a: A.priceUsd,
          price_b: B.priceUsd,
          mcap_a: A.mcapUsd,
          mcap_b: B.mcapUsd,
          liq_a: A.liqUsd,
          liq_b: B.liqUsd,
          holders_a: A.holders,
          holders_b: B.holders,
          score_a: scA.total,
          score_b: scB.total
        });
      }
      await db.from("battles").update({ tw_acc_a: twA, tw_acc_b: twB, tw_time_ms: twT, last_sample_at: new Date(now).toISOString(), state }).eq("id", b.id);
      await runEndChecks(db, b, started, now, { A, B, scA, scB, sa, sb }, log);
    } catch (e) {
      log.push(`#${b.number}: ${e}`);
    }
  }
}
async function runEndChecks(db, b, started, now, s, log) {
  const r = b.rules;
  const { minDurationMs, epochMs, hazardPerEpoch, maxDurationMs } = r.randomEnd;
  const { count } = await db.from("end_checks").select("*", { count: "exact", head: true }).eq("battle_id", b.id);
  let k = (count ?? 0) + 1;
  while (true) {
    const at = minDurationMs + k * epochMs;
    if (started + at > now) return;
    if (at >= maxDurationMs) return finalize(db, b, maxDurationMs, null, true, s, log);
    const round = drandRoundAfter(started + at);
    if (drandRoundTime(round) > now) return;
    const randomness = await drand(round);
    const value = endCheckValue(b.id, b.rules_hash, randomness);
    const check = { index: k, at, beaconRound: round, beaconRandomness: randomness, value, threshold: hazardPerEpoch, ended: value < hazardPerEpoch };
    const { error } = await db.from("end_checks").insert({ battle_id: b.id, idx: k, at_ms: at, round, randomness, value, threshold: hazardPerEpoch, ended: check.ended });
    if (error) {
      log.push(`#${b.number} end check ${k}: ${error.message}`);
      return;
    }
    if (check.ended) return finalize(db, b, at, check, false, s, log);
    k++;
  }
}
async function finalize(db, b, at, check, hitCap, s, log) {
  const aWins = s.scA.total !== s.scB.total ? s.scA.total > s.scB.total : s.scA.inputs.twReturn >= s.scB.inputs.twReturn;
  const winner = aWins ? b.token_a : b.token_b;
  const final = {
    durationMs: at,
    scoreA: s.scA,
    scoreB: s.scB,
    marketCapA: s.A.mcapUsd,
    marketCapB: s.B.mcapUsd,
    returnA: s.A.priceUsd / b.start_price_a - 1,
    returnB: s.B.priceUsd / b.start_price_b - 1,
    holderGrowthA: s.scA.holderGrowthPct,
    holderGrowthB: s.scB.holderGrowthPct,
    holdersA: s.A.holders,
    holdersB: s.B.holders,
    integrityA: s.sa.volumeUsd > 0 ? Math.round(100 * (1 - s.sa.flaggedUsd / s.sa.volumeUsd)) : 100,
    integrityB: s.sb.volumeUsd > 0 ? Math.round(100 * (1 - s.sb.flaggedUsd / s.sb.volumeUsd)) : 100,
    endCheck: check,
    hitCap
  };
  const endedAt = new Date(new Date(b.started_at).getTime() + at).toISOString();
  await db.from("battles").update({ status: "ended", ended_at: endedAt, winner, final }).eq("id", b.id);
  const w = winner === b.token_a ? b.ta : b.tb;
  await feed(db, b.id, "lead", `\u{1F3C6} BATTLE OVER \u2014 $${w.symbol} wins`, winner);
  log.push(`ended #${b.number}: ${w.symbol} wins`);
  if (b.tournament_id) await advanceTournament(db, b, winner);
}
var SOL_MINT = "So11111111111111111111111111111111111111112";
var minLiquidity = () => Number(env("MIN_LIQUIDITY_USD") ?? 1e4);
var hueOf = (mint) => {
  let h = 0;
  for (const c of mint) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};
async function discoverPumpCoins(db, log) {
  const min = minLiquidity();
  const found = /* @__PURE__ */ new Map();
  for (const dex of ["pump-fun", "pumpswap"]) {
    for (const page of [1, 2]) {
      try {
        const j = await gtJson(`https://api.geckoterminal.com/api/v2/networks/solana/dexes/${dex}/pools?page=${page}&sort=h24_volume_usd_desc`);
        for (const p of j.data ?? []) {
          const mint = String(p.relationships?.base_token?.data?.id ?? "").replace(/^solana_/, "");
          const reserve = +(p.attributes?.reserve_in_usd ?? 0);
          if (mint && mint !== SOL_MINT && reserve >= min) found.set(mint, Math.max(reserve, found.get(mint) ?? 0));
        }
      } catch (e) {
        if (!String(e).includes("skipped")) log.push(`discover ${dex} p${page}: ${e}`);
      }
    }
  }
  let added = 0;
  if (found.size) {
    const { data: existing } = await db.from("tokens").select("mint").in("mint", [...found.keys()]);
    const have = new Set((existing ?? []).map((r) => r.mint));
    const fresh = [...found.keys()].filter((m) => !have.has(m)).slice(0, 60);
    for (let i = 0; i < fresh.length; i += 30) {
      const chunk = fresh.slice(i, i + 30);
      try {
        const pairs = await fetchJson(`https://api.dexscreener.com/tokens/v1/solana/${chunk.join(",")}`);
        const rows = chunk.flatMap((mint) => {
          const p = pairs.filter((x) => x.baseToken?.address === mint).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
          if (!p || Math.max(p.liquidity?.usd ?? 0, found.get(mint) ?? 0) < min) return [];
          const soc = Object.fromEntries((p.info?.socials ?? []).map((x) => [x.type === "twitter" ? "x" : x.type, x.url]));
          return [{
            mint,
            symbol: String(p.baseToken.symbol ?? "").slice(0, 20),
            name: String(p.baseToken.name ?? "").slice(0, 60),
            logo_url: p.info?.imageUrl ?? null,
            pair_address: p.pairAddress,
            dex_id: p.dexId,
            hue: hueOf(mint),
            description: null,
            socials: { website: p.info?.websites?.[0]?.url, ...soc },
            listed_by: "auto:pump.fun"
          }];
        });
        if (rows.length) {
          const { error } = await db.from("tokens").upsert(rows, { onConflict: "mint", ignoreDuplicates: true });
          if (error) log.push(`discover insert: ${error.message}`);
          else added += rows.length;
        }
      } catch (e) {
        log.push(`discover metadata: ${e}`);
      }
    }
  }
  let removed = 0;
  const { data: autos } = await db.from("tokens").select("mint").eq("listed_by", "auto:pump.fun").lt("listed_at", new Date(Date.now() - DAY).toISOString()).limit(60);
  if (autos?.length) {
    const mints = autos.map((r) => r.mint);
    const { data: used } = await db.from("battles").select("token_a, token_b").or(`token_a.in.(${mints.join(",")}),token_b.in.(${mints.join(",")})`);
    const busy = new Set((used ?? []).flatMap((b) => [b.token_a, b.token_b]));
    const idle = mints.filter((m) => !busy.has(m));
    for (let i = 0; i < idle.length; i += 30) {
      try {
        const chunk = idle.slice(i, i + 30);
        const pairs = await fetchJson(`https://api.dexscreener.com/tokens/v1/solana/${chunk.join(",")}`);
        const drained = chunk.filter((m) => Math.max(0, ...pairs.filter((x) => x.baseToken?.address === m).map((x) => x.liquidity?.usd ?? 0)) < min / 2);
        if (drained.length) {
          await db.from("tokens").delete().in("mint", drained);
          removed += drained.length;
        }
      } catch (e) {
        log.push(`prune: ${e}`);
      }
    }
  }
  if (added || removed) log.push(`pump.fun: listed ${added}, removed ${removed}`);
}
async function createMatchBattle(db, t, round, slot, a, bb, start) {
  const rules = t.rules;
  const { data } = await db.from("battles").insert({
    token_a: a,
    token_b: bb,
    status: "scheduled",
    rules,
    rules_hash: rulesHash(rules, a, bb),
    created_by: "tournament",
    scheduled_start: new Date(start).toISOString(),
    tournament_id: t.id,
    match_round: round,
    match_slot: slot
  }).select("id").single();
  await db.from("tournament_matches").update({ battle_id: data.id }).eq("tournament_id", t.id).eq("round", round).eq("slot", slot);
}
async function startTournaments(db, log) {
  const { data: due } = await db.from("tournaments").select("*").eq("status", "upcoming").lte("scheduled_start", (/* @__PURE__ */ new Date()).toISOString());
  for (const t of due ?? []) {
    await db.from("tournaments").update({ status: "live", started_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", t.id);
    const { data: ms } = await db.from("tournament_matches").select("*").eq("tournament_id", t.id).eq("round", 0).order("slot");
    for (const m of ms ?? []) await createMatchBattle(db, t, 0, m.slot, m.token_a, m.token_b, Date.now() + (2 + m.slot * 2) * MIN);
    log.push(`tournament ${t.slug} started`);
  }
}
async function advanceTournament(db, b, winner) {
  const { data: t } = await db.from("tournaments").select("*").eq("id", b.tournament_id).single();
  if (!t) return;
  await db.from("tournament_matches").update({ winner }).eq("tournament_id", t.id).eq("round", b.match_round).eq("slot", b.match_slot);
  const rounds = Math.log2(t.size);
  if (b.match_round === rounds - 1) {
    await db.from("tournaments").update({ status: "completed", ended_at: (/* @__PURE__ */ new Date()).toISOString(), champion: winner }).eq("id", t.id);
    return;
  }
  const nr = b.match_round + 1, ns = Math.floor(b.match_slot / 2);
  await db.from("tournament_matches").update(b.match_slot % 2 === 0 ? { token_a: winner } : { token_b: winner }).eq("tournament_id", t.id).eq("round", nr).eq("slot", ns);
  const { data: m } = await db.from("tournament_matches").select("*").eq("tournament_id", t.id).eq("round", nr).eq("slot", ns).single();
  if (m?.token_a && m?.token_b && !m.battle_id) await createMatchBattle(db, t, nr, ns, m.token_a, m.token_b, Date.now() + 4 * MIN);
}
async function createTournament(db, body) {
  const tokens = body.tokens;
  if (![4, 8].includes(tokens.length)) throw new Error("tokens must have 4 or 8 mints");
  const rules = makeRules({ type: body.type ?? "classic" });
  const { data: t, error } = await db.from("tournaments").insert({
    slug: body.slug,
    name: body.name,
    tagline: body.tagline ?? null,
    hue: body.hue ?? 45,
    size: tokens.length,
    prize_note: body.prize_note ?? null,
    rules,
    scheduled_start: body.start ?? new Date(Date.now() + 10 * MIN).toISOString()
  }).select("*").single();
  if (error) throw error;
  const rows = [];
  for (let r = 0; r < Math.log2(tokens.length); r++) {
    const count = tokens.length / 2 ** (r + 1);
    for (let s = 0; s < count; s++) rows.push({ tournament_id: t.id, round: r, slot: s, token_a: r === 0 ? tokens[s * 2] : null, token_b: r === 0 ? tokens[s * 2 + 1] : null });
  }
  await db.from("tournament_matches").insert(rows);
  return t;
}
async function verifySwaps(db, log) {
  const rpc = env("SOLANA_RPC_URL");
  if (!rpc) return;
  const fee = env("FEE_ACCOUNT");
  const { data: swaps } = await db.from("battle_swaps").select("*").eq("verified", false).gte("created_at", new Date(Date.now() - 60 * MIN).toISOString()).limit(25);
  for (const s of swaps ?? []) {
    try {
      const j = await fetchJson(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [s.tx, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }] }) });
      const tx = j.result;
      if (!tx) continue;
      const keys = tx.transaction.message.accountKeys ?? [];
      if (tx.meta?.err || keys[0] !== s.wallet) {
        await db.from("battle_swaps").delete().eq("tx", s.tx);
        continue;
      }
      let feeSol = 0;
      const idx = fee ? keys.indexOf(fee) : -1;
      if (idx >= 0) {
        const pre = tx.meta.preTokenBalances?.find((x) => x.accountIndex === idx)?.uiTokenAmount?.uiAmount ?? 0;
        const post = tx.meta.postTokenBalances?.find((x) => x.accountIndex === idx)?.uiTokenAmount?.uiAmount ?? 0;
        feeSol = Math.max(0, post - pre);
      }
      await db.from("battle_swaps").update({ verified: true, fee_sol: feeSol }).eq("tx", s.tx);
    } catch (e) {
      log.push(`verify ${s.tx.slice(0, 8)}: ${e}`);
    }
  }
}
Deno.serve(async (req) => {
  if (req.headers.get("Authorization") !== `Bearer ${env("KEEPER_SECRET")}` || !env("KEEPER_SECRET")) {
    return new Response("unauthorized", { status: 401 });
  }
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));
  if (body.action === "create_tournament") {
    try {
      return Response.json({ ok: true, tournament: await createTournament(db, body) });
    } catch (e) {
      return Response.json({ ok: false, error: String(e) }, { status: 400 });
    }
  }
  const log = [];
  gtBlocked = false;
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      log.push(`${name}: ${e}`);
    }
  };
  await step("tournaments", () => startTournaments(db, log));
  await step("start", () => startBattles(db, log));
  await step("live", () => updateLive(db, log));
  await step("swaps", () => verifySwaps(db, log));
  if ((/* @__PURE__ */ new Date()).getUTCMinutes() % 10 === 0 || body.action === "discover") await step("discover", () => discoverPumpCoins(db, log));
  return Response.json({ ok: true, log });
});
