# BATTLE — 1v1 token battles on Solana

Two listed Solana tokens battle while people trade the real tokens. It's not a prediction market: trades are real swaps through Jupiter, and the battle is a competitive layer on top of the live markets. Battles last at least an hour, then end at a random, verifiable moment decided by the public drand beacon. There is no countdown.

## How it works

```
Browser (Vite + React, deployed on Vercel)
  ├─ Supabase  — battles, scores, trades, chat, tournaments (Postgres + Realtime + Sign in with Solana)
  ├─ DexScreener — live prices, market caps, liquidity (polled every 20s)
  ├─ GeckoTerminal — candles for charts
  ├─ Jupiter — swap quotes and transactions, signed by the user's wallet
  └─ Solana RPC — wallet balances, transaction confirmation

Supabase Edge Function `battle-keeper` (pg_cron, every minute)
  ├─ starts scheduled battles (validates the rules hash first)
  ├─ samples both markets (DexScreener) and holders (Birdeye, optional)
  ├─ ingests pool trades (GeckoTerminal) and runs integrity checks
  ├─ computes the Battle Score (time-weighted, shared code with the browser)
  ├─ runs random-end checks against drand quicknet rounds
  └─ finalizes results, advances tournament brackets, verifies app swaps on-chain
```

Scoring, rules hashing, random-end checks and integrity heuristics live in `supabase/functions/_shared/`. The keeper and the browser import the exact same files, so anyone can recompute a result.

## Setup

### 1. Supabase
1. Create a project at supabase.com.
2. **Auth → Providers → Web3 Wallet → Solana: enable.** Add your site URL (e.g. `https://your-app.vercel.app`) under **Auth → URL Configuration**.
3. Apply the schema: `supabase link --project-ref <ref>` then `supabase db push`. Alternatively, paste `supabase/migrations/20261001000000_battle_live.sql` into the SQL editor.
4. Store the keeper's schedule secrets in Vault (SQL editor):
   ```sql
   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
   select vault.create_secret('<a long random string>', 'keeper_secret');
   ```
5. Deploy the functions and set their secrets:
   ```bash
   supabase functions deploy battle-keeper --no-verify-jwt
   supabase functions deploy list-token
   supabase functions deploy launch-token
   supabase secrets set KEEPER_SECRET='<same long random string>' \
     BIRDEYE_API_KEY='<optional, enables holder counts>' \
     SOLANA_RPC_URL='<mainnet RPC, enables swap verification>' \
     FEE_ACCOUNT='<same as VITE_FEE_ACCOUNT, optional>' \
     MIN_LIQUIDITY_USD=10000 \
     LAUNCH_FEE_WALLET='<SOL address that receives launch fees>' \
     LAUNCH_FEE_USD=3
   ```
   Token launches stay off until `LAUNCH_FEE_WALLET` is set. Also run `supabase/migrations/20261002000000_launches.sql`.
   Without `BIRDEYE_API_KEY`, Holder Growth is neutral (50/50) for every battle, as the published rules state.

### 2. Vercel
Set the variables from `.env.example` under **Project → Settings → Environment Variables**, then redeploy. The build is `npm run build`, output `dist` (see `vercel.json`).

### 3. First battles
- **Launch a new token:** **Launch → Create new token**. The creator uploads an image, sets name and ticker, and adds an optional dev buy. They approve one transaction, which creates the token on pump.fun's bonding curve and pays the BATTLE launch fee (`LAUNCH_FEE_USD`, in SOL) to `LAUNCH_FEE_WALLET`. The fee is in the same transaction, so a failed launch is never charged. The token is listed straight away, and the creator wallet is its lister.
- **List tokens:** connect a wallet → **List token** → paste a mint. The token needs a DEX pool with at least $10K liquidity. The listing wallet can send and accept challenges for that token.
- **Challenge:** **⚔️ Challenge** → pick your token and an opponent → rules → send. The opponent's lister accepts from their notifications.
- **Tournaments (admin):** call the keeper with your secret. The `tokens` array takes 4 or 8 listed mints, in seeding order:
  ```bash
  curl -X POST https://<ref>.supabase.co/functions/v1/battle-keeper \
    -H "Authorization: Bearer $KEEPER_SECRET" -H 'content-type: application/json' \
    -d '{"action":"create_tournament","slug":"runner-of-the-day-1","name":"Runner of the Day","tokens":["MINT1","MINT2","MINT3","MINT4"],"start":"2026-10-02T18:00:00Z"}'
  ```

## What's live and what isn't yet

| Feature | Status |
|---|---|
| Prices, market caps, liquidity, charts | Live (DexScreener, GeckoTerminal) |
| Trading | Real swaps via Jupiter, signed in the user's wallet |
| Battle Score, random end, integrity | Live, computed every minute by the keeper |
| Chat, watchers | Live (Supabase Realtime), Sign in with Solana required to post |
| Treasury | Funded by the optional Jupiter platform fee on swaps made through the app. Every swap is verified on-chain. **Payouts are manual until a battle contract exists.** |
| Creating brand-new tokens | Live: pump.fun bonding curve via PumpPortal, with the flat BATTLE launch fee paid in the same transaction and verified on-chain before listing. |

### Known limits
- GeckoTerminal's free API allows about 30 calls a minute, so trades are indexed for about 13 live battles per minute. A paid data provider removes this limit.
- Trades are read from each token's main pool. When that pool is drained (for example, a pump.fun token graduating to PumpSwap), the keeper switches to the deepest live pool.
- Launched tokens skip the $10K liquidity minimum that applies to listing existing tokens. Brand-new tokens have thin pools, so their battles are easier to move.
- Holder counts need a Birdeye API key.

## Develop

```bash
npm install
cp .env.example .env.local   # fill in
npm run dev
npm run build                # typecheck + production build
```
