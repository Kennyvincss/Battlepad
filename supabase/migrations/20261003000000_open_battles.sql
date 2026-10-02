-- Open battles: anyone signed in can start a battle between any two listed coins.
-- There is no challenge / accept step any more: a new battle is scheduled straight
-- away and the keeper starts it on its next run (or at the chosen start time).
-- Also records token amounts on swaps made through BATTLE so the app can show PnL.

-- Challenges that were waiting for an accept go ahead as normal battles.
update public.battles
set status = 'scheduled', scheduled_start = greatest(scheduled_start, now())
where status = 'pending';

create or replace function public.create_battle(
  p_a text, p_b text, p_rules jsonb, p_rules_hash text, p_start timestamptz
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; w text := public.current_wallet();
begin
  if w is null then raise exception 'Sign in with your wallet first'; end if;
  if p_a = p_b then raise exception 'Pick two different coins'; end if;
  if not exists (select 1 from tokens where mint = p_a) or not exists (select 1 from tokens where mint = p_b) then
    raise exception 'Both coins must be listed on BATTLE';
  end if;
  if exists (
    select 1 from battles
    where status in ('pending', 'scheduled', 'live')
      and (token_a in (p_a, p_b) or token_b in (p_a, p_b))
  ) then
    raise exception 'One of these coins is already in a battle. Pick another coin or join that battle.';
  end if;
  if (select count(*) from battles where created_by = w and status in ('scheduled', 'live')) >= 5 then
    raise exception 'You already have 5 active battles. Wait for one to finish.';
  end if;
  if p_start > now() + interval '30 days' then raise exception 'Start time must be within the next 30 days'; end if;
  insert into battles (token_a, token_b, status, rules, rules_hash, created_by, scheduled_start)
  values (p_a, p_b, 'scheduled', p_rules, p_rules_hash, w, greatest(p_start, now()))
  returning id into v_id;
  return v_id;
end $$;

grant execute on function public.create_battle to authenticated;

-- Swaps made through BATTLE: keep the token amount too (buys and sells), for PnL.
alter table public.battle_swaps add column if not exists token_amount double precision;
create index if not exists battle_swaps_wallet_idx on public.battle_swaps (wallet, token);
