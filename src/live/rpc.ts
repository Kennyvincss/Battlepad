import { config } from './config';

let id = 0;
export async function rpc<T = any>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(config.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message ?? 'RPC error');
  return j.result as T;
}

const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];

export async function solBalance(owner: string) {
  const r = await rpc<{ value: number }>('getBalance', [owner, { commitment: 'confirmed' }]);
  return r.value / 1e9;
}

export async function tokenBalances(owner: string) {
  const out: Record<string, { amount: number; decimals: number }> = {};
  for (const programId of TOKEN_PROGRAMS) {
    const r = await rpc<{ value: any[] }>('getTokenAccountsByOwner', [owner, { programId }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    for (const acc of r.value) {
      const info = acc.account.data.parsed.info;
      const prev = out[info.mint]?.amount ?? 0;
      out[info.mint] = { amount: prev + (info.tokenAmount.uiAmount ?? 0), decimals: info.tokenAmount.decimals };
    }
  }
  return out;
}

const decimalsCache = new Map<string, number>();
export async function mintDecimals(mint: string) {
  if (decimalsCache.has(mint)) return decimalsCache.get(mint)!;
  const r = await rpc<{ value: { decimals: number } }>('getTokenSupply', [mint]);
  decimalsCache.set(mint, r.value.decimals);
  return r.value.decimals;
}

/** Poll until the signature is confirmed (or fails / times out). */
export async function confirm(signature: string, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await rpc<{ value: ({ confirmationStatus?: string; err: unknown } | null)[] }>('getSignatureStatuses', [[signature], { searchTransactionHistory: false }]);
    const s = r.value[0];
    if (s?.err) throw new Error('Transaction failed on-chain.');
    if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return;
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error('Not confirmed within 60s. Check the transaction on Solscan.');
}
