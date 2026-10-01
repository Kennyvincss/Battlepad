import type { Quote, TradeSide } from '../data/types';
import { SOL_MINT, config, treasuryEnabled } from './config';
import { mintDecimals } from './rpc';

const API = 'https://lite-api.jup.ag/swap/v1';

/** Real Jupiter quote. Buy = SOL → token (amount in SOL), sell = token → SOL (amount in tokens). */
export async function getQuote(tokenId: string, side: TradeSide, amount: number, slippage: number): Promise<Quote> {
  const tokenDecimals = await mintDecimals(tokenId);
  const [inputMint, outputMint, inDec, outDec] = side === 'buy' ? [SOL_MINT, tokenId, 9, tokenDecimals] : [tokenId, SOL_MINT, tokenDecimals, 9];
  const raw = Math.floor(amount * 10 ** inDec);
  const params = new URLSearchParams({ inputMint, outputMint, amount: String(raw), slippageBps: String(Math.round(slippage * 10_000)) });
  if (treasuryEnabled()) params.set('platformFeeBps', String(config.feeBps));
  const r = await fetch(`${API}/quote?${params}`);
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error ?? `Jupiter quote failed (${r.status})`);
  return {
    side, tokenId, inputAmount: amount,
    outputAmount: +j.outAmount / 10 ** outDec,
    minReceived: +j.otherAmountThreshold / 10 ** outDec,
    priceImpact: Math.abs(+j.priceImpactPct || 0),
    feeBps: treasuryEnabled() ? config.feeBps : 0,
    route: (j.routePlan ?? []).map((s: any) => s.swapInfo?.label).filter(Boolean).join(' → ') || 'Jupiter',
    raw: j,
  };
}

/** Build the swap transaction for the user to sign (base64 VersionedTransaction). */
export async function buildSwap(quote: Quote, userPublicKey: string): Promise<string> {
  const body: Record<string, unknown> = {
    quoteResponse: quote.raw, userPublicKey, wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true, prioritizationFeeLamports: 'auto',
  };
  if (treasuryEnabled()) body.feeAccount = config.feeAccount;
  const r = await fetch(`${API}/swap`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok || !j.swapTransaction) throw new Error(j.error ?? `Jupiter swap build failed (${r.status})`);
  return j.swapTransaction as string;
}
