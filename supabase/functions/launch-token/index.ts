// Launch a brand-new token on pump.fun from BATTLE, then list it for battles.
//
//   1. prepare (multipart form): uploads image + metadata to pump.fun IPFS and builds the
//      create (+ optional dev buy) transaction with PumpPortal. If LAUNCH_FEE_USD > 0, a SOL
//      transfer worth that amount is appended to the same transaction (atomic with the launch).
//      The client signs with the new mint keypair and the creator's wallet.
//   2. confirm (JSON {mint, signature}): verifies the landed transaction on-chain
//      (creator signed, mint signed, fee paid if any, no error) and lists the token.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//      LAUNCH_FEE_USD (default 0 = free launches),
//      LAUNCH_FEE_WALLET (required only when LAUNCH_FEE_USD > 0), SOLANA_RPC_URL (recommended)
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  AddressLookupTableAccount, Connection, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction,
} from 'npm:@solana/web3.js@1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_IMAGE = 4 * 1024 * 1024;

function walletOf(user: any): string | null {
  const m = user?.user_metadata ?? {};
  const raw = m.custom_claims?.address ?? m.address ?? m.wallet_address ?? null;
  return raw ? String(raw).replace(/^solana:/, '') : null;
}

function hueOf(mint: string) {
  let h = 0;
  for (const c of mint) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

const b64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
const url = (v: unknown) => (typeof v === 'string' && /^https?:\/\/\S+$/.test(v.trim()) ? v.trim().slice(0, 200) : '');

async function solUsd(): Promise<number> {
  const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`);
  const p = r.ok ? +(await r.json())?.[SOL_MINT]?.usdPrice : NaN;
  if (!(p > 0)) throw new Error('SOL price unavailable, try again in a minute.');
  return p;
}

/** Appends `ix` to a versioned transaction, keeping its address lookup tables. */
async function appendIx(tx: VersionedTransaction, ix: ReturnType<typeof SystemProgram.transfer>, conn: Connection) {
  const luts: AddressLookupTableAccount[] = [];
  for (const l of tx.message.addressTableLookups) {
    const acc = (await conn.getAddressLookupTable(l.accountKey)).value;
    if (!acc) throw new Error('Lookup table not found.');
    luts.push(acc);
  }
  const msg = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: luts });
  msg.instructions.push(ix);
  return new VersionedTransaction(msg.compileToV0Message(luts));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
  try {
    const sbUrl = Deno.env.get('SUPABASE_URL')!;
    const userClient = createClient(sbUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: { user } } = await userClient.auth.getUser();
    const wallet = walletOf(user);
    if (!wallet) return json({ error: 'Sign in with your wallet first.' }, 401);

    const feeUsd = Math.max(0, Number(Deno.env.get('LAUNCH_FEE_USD') ?? 0) || 0);
    const feeWallet = Deno.env.get('LAUNCH_FEE_WALLET');
    if (feeUsd > 0 && !feeWallet) return json({ error: 'Launch fee is set but LAUNCH_FEE_WALLET is missing.' }, 503);
    const conn = new Connection(Deno.env.get('SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com', 'confirmed');
    const db = createClient(sbUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

    // ------------------------------------------------------------ prepare
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const f = await req.formData();
      const name = String(f.get('name') ?? '').trim();
      const symbol = String(f.get('symbol') ?? '').trim().replace(/^\$/, '').toUpperCase();
      const description = String(f.get('description') ?? '').trim().slice(0, 280);
      const mint = String(f.get('mint') ?? '');
      const devBuy = Number(f.get('devBuySol') ?? 0);
      const file = f.get('file');
      const socials = { website: url(f.get('website')), x: url(f.get('x')), telegram: url(f.get('telegram')) };

      if (!name || name.length > 32) return json({ error: 'Name must be 1–32 characters.' }, 400);
      if (!/^[A-Z0-9]{1,10}$/.test(symbol)) return json({ error: 'Ticker must be 1–10 letters or numbers.' }, 400);
      if (!MINT_RE.test(mint)) return json({ error: 'Invalid mint address.' }, 400);
      if (!(devBuy >= 0 && devBuy <= 50)) return json({ error: 'Dev buy must be between 0 and 50 SOL.' }, 400);
      if (!(file instanceof File) || !file.type.startsWith('image/')) return json({ error: 'Add an image for your token.' }, 400);
      if (file.size > MAX_IMAGE) return json({ error: 'Image must be 4 MB or smaller.' }, 400);
      const { data: taken } = await db.from('tokens').select('mint').eq('mint', mint).maybeSingle();
      if (taken) return json({ error: 'Mint already in use.' }, 409);

      // 1. metadata → IPFS (pump.fun)
      const ipfs = new FormData();
      ipfs.append('file', file);
      ipfs.append('name', name);
      ipfs.append('symbol', symbol);
      ipfs.append('description', description);
      ipfs.append('twitter', socials.x);
      ipfs.append('telegram', socials.telegram);
      ipfs.append('website', socials.website);
      ipfs.append('showName', 'true');
      const ir = await fetch('https://pump.fun/api/ipfs', { method: 'POST', body: ipfs });
      if (!ir.ok) return json({ error: `Metadata upload failed (${ir.status}).` }, 502);
      const meta = await ir.json();
      if (!meta?.metadataUri) return json({ error: 'Metadata upload returned no URI.' }, 502);

      // 2. create (+ dev buy) transaction, signed later by creator + mint keypair
      const pr = await fetch('https://pumpportal.fun/api/trade-local', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          publicKey: wallet, action: 'create', mint,
          tokenMetadata: { name, symbol, uri: meta.metadataUri },
          denominatedInSol: 'true', amount: devBuy, slippage: 10, priorityFee: 0.0005, pool: 'pump',
        }),
      });
      if (!pr.ok) return json({ error: `Could not build launch transaction (${pr.status}): ${(await pr.text()).slice(0, 160)}` }, 502);
      const tx = VersionedTransaction.deserialize(new Uint8Array(await pr.arrayBuffer()));

      // 3. Optional BATTLE launch fee, in the same transaction (atomic with the launch)
      const feeLamports = feeUsd > 0 ? Math.ceil((feeUsd / (await solUsd())) * 1e9) : 0;
      const out = feeLamports > 0
        ? await appendIx(tx, SystemProgram.transfer({ fromPubkey: new PublicKey(wallet), toPubkey: new PublicKey(feeWallet!), lamports: feeLamports }), conn)
        : tx;
      const bytes = out.serialize();
      if (bytes.length > 1232) return json({ error: 'Launch transaction too large.' }, 500);

      const { error } = await db.from('launches').upsert({
        mint, wallet, name, symbol, image_url: meta.metadata?.image ?? null, metadata_uri: meta.metadataUri,
        description: description || null, socials, dev_buy_sol: devBuy, fee_lamports: feeLamports, fee_usd: feeUsd, status: 'pending',
      });
      if (error) return json({ error: error.message }, 400);
      return json({ tx: b64(bytes), feeLamports, feeSol: feeLamports / 1e9, feeUsd, image: meta.metadata?.image ?? null });
    }

    // ------------------------------------------------------------ confirm
    const { mint, signature } = await req.json();
    if (!MINT_RE.test(String(mint)) || typeof signature !== 'string') return json({ error: 'Bad request.' }, 400);
    const { data: l } = await db.from('launches').select('*').eq('mint', mint).eq('wallet', wallet).maybeSingle();
    if (!l) return json({ error: 'Launch not found.' }, 404);
    if (l.status === 'launched') {
      const { data: t } = await db.from('tokens').select('*').eq('mint', mint).maybeSingle();
      return json({ ok: true, token: t });
    }

    const tx = await conn.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!tx) return json({ error: 'Transaction not found yet.', retry: true }, 409);
    if (tx.meta?.err) return json({ error: 'The launch transaction failed on-chain.' }, 400);
    const m = tx.transaction.message;
    const statics = m.staticAccountKeys.map((k) => k.toBase58());
    const keys = [...statics, ...(tx.meta?.loadedAddresses?.writable ?? []).map(String), ...(tx.meta?.loadedAddresses?.readonly ?? []).map(String)];
    const signers = statics.slice(0, m.header.numRequiredSignatures);
    if (!signers.includes(wallet) || !signers.includes(mint)) return json({ error: 'Transaction was not signed by the creator and mint.' }, 400);
    if (!statics.includes(PUMP_PROGRAM.toBase58())) return json({ error: 'Not a pump.fun launch.' }, 400);
    if (Number(l.fee_lamports) > 0) {
      const fi = feeWallet ? keys.indexOf(feeWallet) : -1;
      const paid = fi >= 0 ? (tx.meta!.postBalances[fi] - tx.meta!.preBalances[fi]) : 0;
      if (paid < Number(l.fee_lamports)) return json({ error: 'Launch fee not found in the transaction.' }, 400);
    }

    const [curve] = PublicKey.findProgramAddressSync([new TextEncoder().encode('bonding-curve'), new PublicKey(mint).toBytes()], PUMP_PROGRAM);
    const row = {
      mint, symbol: l.symbol, name: l.name, logo_url: l.image_url, pair_address: curve.toBase58(), dex_id: 'pumpfun',
      hue: hueOf(mint), description: l.description, socials: l.socials, listed_by: wallet,
    };
    const { error } = await db.from('tokens').upsert(row, { onConflict: 'mint', ignoreDuplicates: true });
    if (error) return json({ error: error.message }, 400);
    await db.from('launches').update({ status: 'launched', signature, launched_at: new Date().toISOString() }).eq('mint', mint);
    return json({ ok: true, token: row });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
