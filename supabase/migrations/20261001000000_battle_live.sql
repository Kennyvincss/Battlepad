-- =====================================================================
-- BATTLE — live schema (Supabase / Postgres)
--
-- Writes from browsers go through RLS-checked tables or SECURITY DEFINER
-- RPCs. Battle state (snapshots, scores, end checks, results) is written
-- only by the battle-keeper edge function using the service role.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- identity
-- Wallet address of the signed-in user (Supabase Web3 / Sign in with Solana).
create or replace function public.current_wallet() returns text
language sql stable as $$
  select nullif(regexp_replace(coalesce(
    auth.jwt() -> 'user_metadata' -> 'custom_claims' ->> 'address',
    auth.jwt() -> 'user_metadata' ->> 'address',
    auth.jwt() -> 'user_metadata' ->> 'wallet_address',
    ''
  ), '^solana:', ''), '')
$$;

create table public.profiles (
  wallet      text primary key,
  handle      text unique check (handle ~ '^[a-z0-9_]{3,20}$'),
  avatar      text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- tokens
create table public.tokens (
  mint          text primary key,
  symbol        text not null,
  name          text not null,
  logo_url      text,
  pair_address  text not null,
  dex_id        text,
  hue           int  not null default 200,
  description   text,
  socials       jsonb not null default '{}'::jsonb,
  listed_by     text not null,
  listed_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------- tournaments
create table public.tournaments (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  name            text not null,
  tagline         text,
  hue             int not null default 45,
  size            int not null check (size in (4, 8)),
  status          text not null default 'upcoming' check (status in ('upcoming','live','completed')),
  prize_note      text,
  rules           jsonb not null,
  scheduled_start timestamptz not null,
  started_at      timestamptz,
  ended_at        timestamptz,
  champion        text references public.tokens(mint),
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------- battles
create table public.battles (
  id                uuid primary key default gen_random_uuid(),
  number            bigserial unique,
  token_a           text not null references public.tokens(mint),
  token_b           text not null references public.tokens(mint),
  status            text not null default 'pending' check (status in ('pending','scheduled','live','ended','declined','cancelled')),
  rules             jsonb not null,
  rules_hash        text not null,
  created_by        text not null,
  challenge_message text,
  scheduled_start   timestamptz not null,
  started_at        timestamptz,
  ended_at          timestamptz,
  winner            text references public.tokens(mint),
  tournament_id     uuid references public.tournaments(id),
  match_round       int,
  match_slot        int,
  -- start snapshot
  start_price_a     double precision, start_price_b     double precision,
  start_holders_a   int,              start_holders_b   int,
  start_liq_a       double precision, start_liq_b       double precision,
  start_mcap_a      double precision, start_mcap_b      double precision,
  -- running state (keeper)
  tw_acc_a          double precision not null default 0,
  tw_acc_b          double precision not null default 0,
  tw_time_ms        double precision not null default 0,
  last_sample_at    timestamptz,
  state             jsonb not null default '{}'::jsonb,   -- latest market + score per side
  final             jsonb,
  created_at        timestamptz not null default now(),
  check (token_a <> token_b)
);
create index on public.battles (status);
create index on public.battles (tournament_id);

create table public.tournament_matches (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round         int not null,
  slot          int not null,
  token_a       text references public.tokens(mint),
  token_b       text references public.tokens(mint),
  battle_id     uuid references public.battles(id),
  winner        text references public.tokens(mint),
  primary key (tournament_id, round, slot)
);

create table public.battle_snapshots (
  battle_id  uuid not null references public.battles(id) on delete cascade,
  t          timestamptz not null,
  price_a    double precision, price_b double precision,
  mcap_a     double precision, mcap_b  double precision,
  liq_a      double precision, liq_b   double precision,
  holders_a  int,              holders_b int,
  score_a    double precision, score_b double precision,
  primary key (battle_id, t)
);

create table public.battle_trades (
  battle_id  uuid not null references public.battles(id) on delete cascade,
  token      text not null,
  tx         text not null,
  wallet     text not null,
  side       text not null check (side in ('buy','sell')),
  usd        double precision not null,
  ts         timestamptz not null,
  flagged    boolean not null default false,
  primary key (battle_id, tx, token)
);
create index on public.battle_trades (battle_id, ts desc);
create index on public.battle_trades (wallet);

create table public.end_checks (
  battle_id   uuid not null references public.battles(id) on delete cascade,
  idx         int not null,
  at_ms       bigint not null,
  round       bigint not null,
  randomness  text not null,
  value       double precision not null,
  threshold   double precision not null,
  ended       boolean not null,
  primary key (battle_id, idx)
);

create table public.battle_feed (
  id         bigserial primary key,
  battle_id  uuid not null references public.battles(id) on delete cascade,
  ts         timestamptz not null default now(),
  kind       text not null,
  token      text,
  text       text not null
);
create index on public.battle_feed (battle_id, id desc);

create table public.integrity_events (
  id            bigserial primary key,
  battle_id     uuid not null references public.battles(id) on delete cascade,
  token         text not null,
  ts            timestamptz not null default now(),
  kind          text not null,
  severity      text not null,
  title         text not null,
  detail        text not null,
  wallets       int not null default 0,
  excluded_usd  double precision not null default 0
);

-- Swaps made through the BATTLE app (Jupiter). `verified` is set by the keeper
-- after confirming the transaction on-chain. Treasury figures use verified swaps only.
create table public.battle_swaps (
  tx          text primary key,
  battle_id   uuid references public.battles(id),
  wallet      text not null,
  token       text not null,
  side        text not null check (side in ('buy','sell')),
  sol_amount  double precision not null,
  fee_sol     double precision not null default 0,
  verified    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.chat_messages (
  id          bigserial primary key,
  battle_id   uuid not null references public.battles(id) on delete cascade,
  wallet      text not null default public.current_wallet(),
  text        text not null check (char_length(text) between 1 and 280),
  army        text,
  deleted     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index on public.chat_messages (battle_id, id desc);

create table public.chat_reports (
  message_id  bigint not null references public.chat_messages(id) on delete cascade,
  reporter    text not null default public.current_wallet(),
  created_at  timestamptz not null default now(),
  primary key (message_id, reporter)
);

-- ---------------------------------------------------------------- RLS
alter table public.profiles          enable row level security;
alter table public.tokens            enable row level security;
alter table public.tournaments       enable row level security;
alter table public.tournament_matches enable row level security;
alter table public.battles           enable row level security;
alter table public.battle_snapshots  enable row level security;
alter table public.battle_trades     enable row level security;
alter table public.end_checks        enable row level security;
alter table public.battle_feed       enable row level security;
alter table public.integrity_events  enable row level security;
alter table public.battle_swaps      enable row level security;
alter table public.chat_messages     enable row level security;
alter table public.chat_reports      enable row level security;

-- Everything is publicly readable (transparency is a product rule) …
create policy "public read" on public.profiles          for select using (true);
create policy "public read" on public.tokens            for select using (true);
create policy "public read" on public.tournaments       for select using (true);
create policy "public read" on public.tournament_matches for select using (true);
create policy "public read" on public.battles           for select using (true);
create policy "public read" on public.battle_snapshots  for select using (true);
create policy "public read" on public.battle_trades     for select using (true);
create policy "public read" on public.end_checks        for select using (true);
create policy "public read" on public.battle_feed       for select using (true);
create policy "public read" on public.integrity_events  for select using (true);
create policy "public read" on public.battle_swaps      for select using (true);
create policy "public read" on public.chat_messages     for select using (true);

-- … but only signed-in wallets write, and only as themselves.
create policy "own profile" on public.profiles for insert with check (wallet = public.current_wallet());
create policy "own profile update" on public.profiles for update using (wallet = public.current_wallet());
create policy "post chat" on public.chat_messages for insert
  with check (public.current_wallet() is not null and wallet = public.current_wallet() and deleted = false);
create policy "delete own chat" on public.chat_messages for update
  using (wallet = public.current_wallet()) with check (wallet = public.current_wallet());
create policy "report chat" on public.chat_reports for insert with check (reporter = public.current_wallet());
create policy "own reports" on public.chat_reports for select using (reporter = public.current_wallet());
create policy "record own swap" on public.battle_swaps for insert
  with check (wallet = public.current_wallet() and verified = false);

-- ---------------------------------------------------------------- RPCs
-- Challenge another listed token with one of yours. Rules are hashed by the
-- client with the shared rules code; the keeper re-hashes and cancels battles
-- whose hash doesn't match before they can start.
create or replace function public.create_challenge(
  p_from text, p_to text, p_rules jsonb, p_rules_hash text, p_message text, p_start timestamptz
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; w text := public.current_wallet();
begin
  if w is null then raise exception 'Sign in with your wallet first'; end if;
  if not exists (select 1 from tokens where mint = p_from and listed_by = w) then
    raise exception 'You can only challenge with a token you listed';
  end if;
  if not exists (select 1 from tokens where mint = p_to) then raise exception 'Opponent is not listed'; end if;
  if p_start < now() + interval '5 minutes' then raise exception 'Start must be at least 5 minutes away'; end if;
  insert into battles (token_a, token_b, status, rules, rules_hash, created_by, challenge_message, scheduled_start)
  values (p_from, p_to, 'pending', p_rules, p_rules_hash, w, left(p_message, 140), p_start)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.respond_challenge(p_battle uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare w text := public.current_wallet(); b battles;
begin
  select * into b from battles where id = p_battle for update;
  if b is null or b.status <> 'pending' then raise exception 'Challenge is not pending'; end if;
  if not exists (select 1 from tokens where mint = b.token_b and listed_by = w) then
    raise exception 'Only the opponent token''s lister can respond';
  end if;
  update battles set status = case when p_accept then 'scheduled' else 'declined' end,
    scheduled_start = greatest(scheduled_start, now() + interval '5 minutes')
  where id = p_battle;
end $$;

grant execute on function public.create_challenge, public.respond_challenge, public.current_wallet to authenticated, anon;

-- ---------------------------------------------------------------- views
create or replace view public.trader_stats as
select wallet,
       count(distinct battle_id)                                   as battles,
       count(*)                                                    as trades,
       sum(usd)                                                    as volume_usd,
       count(distinct battle_id) filter (where exists (
         select 1 from battles b where b.id = battle_trades.battle_id and b.winner = battle_trades.token and battle_trades.side = 'buy'
       ))                                                          as winning_sides
from public.battle_trades where not flagged
group by wallet;

-- ---------------------------------------------------------------- realtime
alter publication supabase_realtime add table
  public.battles, public.battle_snapshots, public.battle_feed, public.end_checks,
  public.integrity_events, public.chat_messages, public.tournaments, public.tournament_matches, public.tokens;

-- ---------------------------------------------------------------- keeper schedule
-- Runs the battle-keeper edge function every minute. Store two secrets in
-- Vault first (see README):  project_url, keeper_secret
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('battle-keeper', '* * * * *', $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/battle-keeper',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'keeper_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
$$);
