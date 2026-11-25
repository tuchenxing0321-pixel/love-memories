create extension if not exists pgcrypto;

create table if not exists public.memory_profiles (
  uid text primary key,
  nickname text not null default '我',
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memory_spaces (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 80),
  partner_name text not null check (char_length(partner_name) between 1 and 80),
  anniversary date,
  owner_uid text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memory_members (
  space_id uuid not null references public.memory_spaces(id) on delete cascade,
  uid text not null,
  role text not null check (role in ('owner', 'editor')),
  joined_at timestamptz not null default now(),
  primary key (space_id, uid),
  unique (uid)
);

create table if not exists public.memory_items (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.memory_spaces(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  start_date date not null,
  end_date date,
  place text,
  story text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_uid text not null,
  deleted_at timestamptz,
  check (end_date is null or end_date >= start_date)
);

create index if not exists memory_items_space_date_idx
  on public.memory_items (space_id, start_date desc);

create table if not exists public.memory_media (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memory_items(id) on delete cascade,
  space_id uuid not null references public.memory_spaces(id) on delete cascade,
  kind text not null check (kind in ('image', 'video', 'external_video')),
  filename text not null,
  object_key text,
  external_url text,
  mime_type text,
  size_bytes bigint,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (kind = 'external_video' and external_url like 'https://%' and object_key is null)
    or
    (kind in ('image', 'video') and object_key like 'spaces/' || space_id::text || '/%' and external_url is null)
  )
);

create index if not exists memory_media_memory_idx on public.memory_media (memory_id);

create table if not exists public.memory_invitations (
  token uuid primary key,
  space_id uuid not null references public.memory_spaces(id) on delete cascade,
  created_by_uid text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_by_uid text
);

create table if not exists public.memory_revisions (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memory_items(id) on delete cascade,
  space_id uuid not null references public.memory_spaces(id) on delete cascade,
  actor_uid text not null,
  event_type text not null check (event_type in ('create', 'update', 'soft_delete', 'restore')),
  before_data jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.accept_memory_invitation(p_token uuid, p_uid text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  invitation memory_invitations%rowtype;
  member_count integer;
begin
  select * into invitation from memory_invitations where token = p_token for update;
  if not found or invitation.used_at is not null then
    return jsonb_build_object('ok', false, 'error', '邀请链接无效或已被使用');
  end if;
  if exists (select 1 from memory_members where uid = p_uid) then
    return jsonb_build_object('ok', false, 'error', '该账号已属于其他空间');
  end if;
  perform 1 from memory_spaces where id = invitation.space_id for update;
  select count(*) into member_count from memory_members where space_id = invitation.space_id;
  if member_count >= 2 then
    return jsonb_build_object('ok', false, 'error', '该空间已满');
  end if;
  insert into memory_members(space_id, uid, role) values (invitation.space_id, p_uid, 'editor');
  update memory_invitations set used_at = now(), used_by_uid = p_uid where token = p_token;
  return jsonb_build_object('ok', true, 'spaceId', invitation.space_id);
end;
$$;

alter table public.memory_profiles enable row level security;
alter table public.memory_spaces enable row level security;
alter table public.memory_members enable row level security;
alter table public.memory_items enable row level security;
alter table public.memory_media enable row level security;
alter table public.memory_invitations enable row level security;
alter table public.memory_revisions enable row level security;
