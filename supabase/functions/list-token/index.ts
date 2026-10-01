// List an existing Solana SPL token on BATTLE so it can battle.
// The caller must be signed in (Sign in with Solana); they become the lister.
// Metadata and the main pool come from DexScreener, never from the client.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, MIN_LIQUIDITY_USD (default 10000)
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function walletOf(user: any): string | null {
  const m = user?.user_metadata ?? {};
  const raw = m.custom_claims?.address ?? m.address ?? m.wallet_address ?? null;
  return raw ? String(raw).replace(/^solana:/, '') : null;
}

/** Stable side colour from the mint. */
function hueOf(mint: string) {
  let h = 0;
  for (const c of mint) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const auth = req.headers.get('Authorization') ?? '';
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    const wallet = walletOf(user);
    if (!wallet) return json({ error: 'Sign in with your wallet first.' }, 401);

    const { mint, description, socials } = await req.json();
    if (typeof mint !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return json({ error: 'That is not a valid Solana mint address.' }, 400);

    const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: existing } = await db.from('tokens').select('mint').eq('mint', mint).maybeSingle();
    if (existing) return json({ error: 'This token is already listed.' }, 409);

    const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`);
    const pairs: any[] = r.ok ? await r.json() : [];
    const p = pairs.filter((x) => x.baseToken?.address === mint).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    if (!p) return json({ error: 'No trading pool found for this token on DexScreener.' }, 404);
    const minLiq = Number(Deno.env.get('MIN_LIQUIDITY_USD') ?? 10000);
    if ((p.liquidity?.usd ?? 0) < minLiq) return json({ error: `Pool liquidity is below the $${minLiq.toLocaleString('en-US')} listing minimum.` }, 400);

    const soc = Object.fromEntries((p.info?.socials ?? []).map((s: any) => [s.type === 'twitter' ? 'x' : s.type, s.url]));
    const row = {
      mint, symbol: p.baseToken.symbol, name: p.baseToken.name, logo_url: p.info?.imageUrl ?? null,
      pair_address: p.pairAddress, dex_id: p.dexId, hue: hueOf(mint),
      description: typeof description === 'string' ? description.slice(0, 280) : null,
      socials: { website: p.info?.websites?.[0]?.url, ...soc, ...(socials ?? {}) },
      listed_by: wallet,
    };
    const { error } = await db.from('tokens').insert(row);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, token: row });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
