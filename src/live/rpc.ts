import { PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
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

const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

/** The owner's associated token account for `mint` (classic SPL Token program). */
export function associatedTokenAddress(owner: string, mint: string) {
  return PublicKey.findProgramAddressSync([new PublicKey(owner).toBytes(), TOKEN_PROGRAM.toBytes(), new PublicKey(mint).toBytes()], ATA_PROGRAM)[0].toBase58();
}

export async function accountExists(address: string) {
  const r = await rpc<{ value: unknown }>('getAccountInfo', [address, { encoding: 'base64', commitment: 'confirmed' }]);
  return r.value !== null;
}

/** Unsigned transaction creating the owner's token account for `mint` (no-op if it exists). */
export async function createAtaTx(owner: string, mint: string) {
  const o = new PublicKey(owner);
  const ix = new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: o, isSigner: true, isWritable: true },
      { pubkey: new PublicKey(associatedTokenAddress(owner, mint)), isSigner: false, isWritable: true },
      { pubkey: o, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(mint), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: Uint8Array.from([1]) as unknown as TransactionInstruction['data'], // CreateIdempotent
  });
  const { value } = await rpc<{ value: { blockhash: string } }>('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  return new VersionedTransaction(new TransactionMessage({ payerKey: o, recentBlockhash: value.blockhash, instructions: [ix] }).compileToV0Message());
}
