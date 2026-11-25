create extension if not exists pgcrypto;

create table if not exists public.shared_memory_items (
  id uuid primary key,
  kind text not null check (kind in ('event', 'photo')),
  title text not null check (char_length(title) between 1 and 60),
  date date not null,
  event_type text not null default 'minor' check (event_type in ('minor', 'major')),
  place text not null default '' check (char_length(place) <= 80),
  story text not null default '' check (char_length(story) <= 1200),
  sort_order integer not null default 0,
  created_by_uid text not null,
  updated_by_uid text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists shared_memory_items_date_idx
  on public.shared_memory_items (date asc, sort_order asc, created_at asc);

create table if not exists public.shared_memory_photos (
  id uuid primary key,
  memory_id uuid not null references public.shared_memory_items(id) on delete cascade,
  object_key text not null unique check (object_key like 'shared-memories/%'),
  file_id text unique check (file_id is null or char_length(file_id) between 1 and 512),
  filename text not null check (char_length(filename) between 1 and 180),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  size_bytes bigint not null check (size_bytes between 1 and 2097152),
  caption text not null default '' check (char_length(caption) <= 120),
  uploaded_at date not null,
  sort_order integer not null default 0,
  created_by_uid text not null,
  created_at timestamptz not null default now(),
  upload_state text not null default 'active' check (upload_state in ('pending', 'active', 'cleanup')),
  deleted_at timestamptz,
  storage_deleted_at timestamptz,
  delete_error text
);

create index if not exists shared_memory_photos_memory_idx
  on public.shared_memory_photos (memory_id, sort_order asc, created_at asc);

alter table public.shared_memory_photos
  add column if not exists upload_state text not null default 'active';
alter table public.shared_memory_photos
  drop constraint if exists shared_memory_photos_file_id_check;
alter table public.shared_memory_photos
  alter column file_id drop not null;
alter table public.shared_memory_photos
  add constraint shared_memory_photos_file_id_check
  check (file_id is null or char_length(file_id) between 1 and 512);
alter table public.shared_memory_photos
  drop constraint if exists shared_memory_photos_upload_state_check;
alter table public.shared_memory_photos
  add constraint shared_memory_photos_upload_state_check
  check (upload_state in ('pending', 'active', 'cleanup'));

create table if not exists public.memory_write_rate_limits (
  actor_uid text primary key,
  window_started_at timestamptz not null default now(),
  write_count integer not null default 0 check (write_count >= 0)
);

create or replace function public.consume_memory_write_quota(
  p_actor_uid text,
  p_limit integer default 20,
  p_window_seconds integer default 60
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_limit memory_write_rate_limits%rowtype;
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
    from memory_write_rate_limits
    where actor_uid = p_actor_uid
    for update;

  if not found then
    insert into memory_write_rate_limits(actor_uid, write_count) values (p_actor_uid, 1);
    return true;
  end if;
  if current_limit.window_started_at <= now() - p_window_seconds * interval '1 second' then
    update memory_write_rate_limits
      set window_started_at = now(), write_count = 1
      where actor_uid = p_actor_uid;
    return true;
  end if;
  if current_limit.write_count >= p_limit then return false; end if;

  update memory_write_rate_limits
    set write_count = write_count + 1
    where actor_uid = p_actor_uid;
  return true;
end;
$$;

revoke all on table public.shared_memory_items from anon, authenticated;
revoke all on table public.shared_memory_photos from anon, authenticated;
revoke all on table public.memory_write_rate_limits from anon, authenticated;
revoke all on function public.consume_memory_write_quota(text, integer, integer) from public;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.shared_memory_items to service_role;
grant select, insert, update, delete on table public.shared_memory_photos to service_role;
grant select, insert, update on table public.memory_write_rate_limits to service_role;
grant execute on function public.consume_memory_write_quota(text, integer, integer) to service_role;

alter table public.shared_memory_items enable row level security;
alter table public.shared_memory_photos enable row level security;
alter table public.memory_write_rate_limits enable row level security;
