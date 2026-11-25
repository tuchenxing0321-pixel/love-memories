create extension if not exists pgcrypto;

create table if not exists public.important_dates (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 40),
  date date not null,
  note text not null default '' check (char_length(note) <= 120),
  created_by_uid text not null,
  updated_by_uid text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists important_dates_date_idx
  on public.important_dates (date asc, created_at asc);

create table if not exists public.date_write_rate_limits (
  actor_uid text primary key,
  window_started_at timestamptz not null default now(),
  write_count integer not null default 0 check (write_count >= 0)
);

create or replace function public.consume_date_write_quota(
  p_actor_uid text,
  p_limit integer default 12,
  p_window_seconds integer default 60
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_limit date_write_rate_limits%rowtype;
  caller_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '');
begin
  if caller_role <> 'service_role' then
    raise exception 'forbidden';
  end if;

  if coalesce(p_actor_uid, '') = '' or p_limit < 1 or p_window_seconds < 1 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_actor_uid)::bigint);
  select * into current_limit
    from date_write_rate_limits
    where actor_uid = p_actor_uid
    for update;

  if not found then
    insert into date_write_rate_limits(actor_uid, write_count) values (p_actor_uid, 1);
    return true;
  end if;

  if current_limit.window_started_at <= now() - p_window_seconds * interval '1 second' then
    update date_write_rate_limits
      set window_started_at = now(), write_count = 1
      where actor_uid = p_actor_uid;
    return true;
  end if;

  if current_limit.write_count >= p_limit then
    return false;
  end if;

  update date_write_rate_limits
    set write_count = write_count + 1
    where actor_uid = p_actor_uid;
  return true;
end;
$$;

revoke all on function public.consume_date_write_quota(text, integer, integer) from public;
revoke all on table public.important_dates from anon, authenticated;
revoke all on table public.date_write_rate_limits from anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.important_dates to service_role;
grant execute on function public.consume_date_write_quota(text, integer, integer) to service_role;

alter table public.important_dates enable row level security;
alter table public.date_write_rate_limits enable row level security;
