-- BATTLE token launches (pump.fun bonding curve via PumpPortal).
-- Each launch pays a flat USD fee in SOL to the BATTLE launch-fee wallet, inside the
-- same transaction that creates the token, so a failed launch is never charged.
-- Rows are written only by the launch-token edge function (service role).

create table if not exists public.launches (
  mint          text primary key,
  wallet        text not null,
  name          text not null,
  symbol        text not null,
  image_url     text,
  metadata_uri  text not null,
  description   text,
  socials       jsonb not null default '{}'::jsonb,
  dev_buy_sol   numeric not null default 0,
  fee_lamports  bigint not null,
  fee_usd       numeric not null,
  status        text not null default 'pending' check (status in ('pending','launched')),
  signature     text unique,
  created_at    timestamptz not null default now(),
  launched_at   timestamptz
);

create index if not exists launches_wallet_idx on public.launches (wallet);

alter table public.launches enable row level security;

drop policy if exists "launched tokens are public" on public.launches;
create policy "launched tokens are public" on public.launches
  for select using (status = 'launched');
