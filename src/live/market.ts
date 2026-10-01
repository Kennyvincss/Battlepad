import type { Market } from '../data/types';
import { SOL_MINT } from './config';

/** DexScreener: markets for up to 30 mints per request, using each token's listed pair. */
export async function fetchMarkets(tokens: { mint: string; pairAddress: string }[]): Promise<Map<string, Market>> {
  const out = new Map<string, Market>();
  for (let i = 0; i < tokens.length; i += 30) {
    const chunk = tokens.slice(i, i + 30);
    const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${chunk.map((t) => t.mint).join(',')}`);
    if (!r.ok) throw new Error(`DexScreener ${r.status}`);
    const pairs: any[] = await r.json();
    for (const t of chunk) {
      const own = pairs.filter((p) => p.baseToken?.address === t.mint);
      const p = own.find((x) => x.pairAddress === t.pairAddress) ?? own.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      if (!p) continue;
      out.set(t.mint, {
        tokenId: t.mint,
        priceUsd: +p.priceUsd,
        priceNative: +p.priceNative,
        mcapUsd: +(p.marketCap ?? p.fdv ?? 0),
        liquidityUsd: +(p.liquidity?.usd ?? 0),
        volume24Usd: +(p.volume?.h24 ?? 0),
        change24: p.priceChange?.h24 !== undefined ? +p.priceChange.h24 / 100 : null,
        buys24: +(p.txns?.h24?.buys ?? 0),
        sells24: +(p.txns?.h24?.sells ?? 0),
        pairUrl: p.url,
        updatedAt: Date.now(),
      });
    }
  }
  return out;
}

/** Look up a mint before listing (preview in the Launch page). */
export async function lookupToken(mint: string) {
  const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`);
  if (!r.ok) throw new Error(`DexScreener ${r.status}`);
  const pairs: any[] = await r.json();
  const p = pairs.filter((x) => x.baseToken?.address === mint).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  if (!p) return null;
  return {
    symbol: p.baseToken.symbol as string, name: p.baseToken.name as string, logoUrl: p.info?.imageUrl as string | undefined,
    priceUsd: +p.priceUsd, mcapUsd: +(p.marketCap ?? p.fdv ?? 0), liquidityUsd: +(p.liquidity?.usd ?? 0), dexId: p.dexId as string, pairAddress: p.pairAddress as string,
  };
}

export async function fetchSolPrice(): Promise<number | null> {
  try {
    const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`);
    const j = await r.json();
    return +j[SOL_MINT].usdPrice;
  } catch {
    return null;
  }
}

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
export type Timeframe = { tf: 'minute' | 'hour' | 'day'; aggregate: number };

/** GeckoTerminal OHLCV (USD) for `mint` in `pair`, oldest first. */
export async function fetchCandles(pair: string, mint: string, tf: Timeframe, limit = 1000): Promise<Candle[]> {
  const url = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pair}/ohlcv/${tf.tf}?aggregate=${tf.aggregate}&limit=${limit}&currency=usd&token=${mint}`;
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`GeckoTerminal ${r.status}`);
  const j = await r.json();
  const list: number[][] = j?.data?.attributes?.ohlcv_list ?? [];
  return list.map(([t, o, h, l, c, v]) => ({ t: t * 1000, o, h, l, c, v })).sort((a, b) => a.t - b.t);
}
