/**
 * Integrity heuristics run by the keeper over a battle's ingested trades.
 * Community buying is never flagged on its own: flags need machine-like
 * patterns (round trips by the same wallet, or many wallets trading identical
 * sizes within seconds). Every flag is logged publicly with its reason.
 */
export interface TradeLite { wallet: string; side: 'buy' | 'sell'; usd: number; ts: number }

export interface IntegrityFinding {
  kind: 'wash-trading' | 'synchronized-trading' | 'community-surge';
  severity: 'alert' | 'info';
  wallets: string[];
  excludedUsd: number;
  title: string;
  detail: string;
}

const WASH_WINDOW = 10 * 60_000;
const SYNC_WINDOW = 60_000;

export function analyzeTrades(trades: TradeLite[], alreadyFlagged: Set<string>, ticker: string): IntegrityFinding[] {
  const out: IntegrityFinding[] = [];
  const byWallet = new Map<string, TradeLite[]>();
  for (const t of trades) {
    const l = byWallet.get(t.wallet) ?? [];
    l.push(t);
    byWallet.set(t.wallet, l);
  }

  // Wash trading: ≥2 buys and ≥2 sells inside 10 minutes with net change < 10% of gross.
  const wash: string[] = [];
  let washUsd = 0;
  for (const [w, list] of byWallet) {
    if (alreadyFlagged.has(w) || list.length < 4) continue;
    list.sort((x, y) => x.ts - y.ts);
    for (let i = 0; i < list.length; i++) {
      const win = list.filter((t) => t.ts >= list[i].ts && t.ts <= list[i].ts + WASH_WINDOW);
      const buys = win.filter((t) => t.side === 'buy');
      const sells = win.filter((t) => t.side === 'sell');
      if (buys.length >= 2 && sells.length >= 2) {
        const b = buys.reduce((s, t) => s + t.usd, 0);
        const s = sells.reduce((x, t) => x + t.usd, 0);
        if (Math.abs(b - s) < 0.1 * (b + s)) { wash.push(w); washUsd += b + s; break; }
      }
    }
  }
  if (wash.length) {
    out.push({
      kind: 'wash-trading', severity: 'alert', wallets: wash, excludedUsd: washUsd,
      title: `Wash trading on $${ticker}`,
      detail: `${wash.length} wallet(s) bought and sold matching amounts within 10 minutes with no real position change. Their volume and holdings are excluded from Holder Growth and Market Quality.`,
    });
  }

  // Synchronized trading: ≥6 fresh wallets, same side, sizes within ±2%, inside 60s.
  const sorted = [...trades].filter((t) => !alreadyFlagged.has(t.wallet) && !wash.includes(t.wallet)).sort((x, y) => x.ts - y.ts);
  const synced = new Set<string>();
  let syncUsd = 0;
  for (let i = 0; i < sorted.length; i++) {
    const base = sorted[i];
    const group = sorted.filter((t) => t.ts >= base.ts && t.ts <= base.ts + SYNC_WINDOW && t.side === base.side && Math.abs(t.usd - base.usd) <= base.usd * 0.02);
    const wallets = new Set(group.map((t) => t.wallet));
    if (wallets.size >= 6) {
      for (const t of group) if (!synced.has(t.wallet)) { synced.add(t.wallet); syncUsd += t.usd; }
    }
  }
  if (synced.size) {
    out.push({
      kind: 'synchronized-trading', severity: 'alert', wallets: [...synced], excludedUsd: syncUsd,
      title: `Abnormal synchronized trading on $${ticker}`,
      detail: `${synced.size} wallets traded near-identical sizes within 60 seconds, a pattern consistent with one operator. Excluded from Holder Growth and Market Quality per the published rules.`,
    });
  }

  // Community surge (legitimate): ≥25 distinct buyers within 5 minutes, varied sizes.
  const recent = trades.filter((t) => t.side === 'buy' && t.ts >= Date.now() - 5 * 60_000);
  const buyers = new Set(recent.map((t) => t.wallet));
  if (buyers.size >= 25) {
    out.push({
      kind: 'community-surge', severity: 'info', wallets: [], excludedUsd: 0,
      title: `$${ticker} community surge — legitimate`,
      detail: `${buyers.size} distinct wallets bought in the last 5 minutes with varied sizes. Collective support is allowed and counted normally.`,
    });
  }
  return out;
}
