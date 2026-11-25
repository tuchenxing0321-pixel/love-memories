create extension if not exists pgcrypto;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at
) values (
  'lens-photos', 'lens-photos', false, 2097152,
  array['image/jpeg','image/png','image/webp'], now(), now()
) on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  updated_at = now();

-- 照片始终由 lensApi 在服务端代理。只给 service_role 操作这一个
-- 私有桶的权限，不向 anon / authenticated 开放任何直连读写。
drop policy if exists lens_service_objects on storage.objects;
create policy lens_service_objects on storage.objects
  for all to service_role
  using (bucket_id = 'lens-photos')
  with check (bucket_id = 'lens-photos');

create table if not exists public.lens_photos (
  id uuid primary key,
  object_key text not null unique check (object_key like 'lens-photos/%'),
  file_id text not null unique check (char_length(file_id) between 1 and 512),
  filename text not null check (char_length(filename) between 1 and 180),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes between 1 and 2097152),
  note text not null default '' check (char_length(note) <= 160),
  owner_id text not null check (char_length(owner_id) = 64),
  owner_nickname text not null check (char_length(owner_nickname) between 1 and 24),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lens_photos_created_idx on public.lens_photos (created_at desc);
create index if not exists lens_photos_owner_idx on public.lens_photos (owner_id, created_at desc);

create table if not exists public.lens_rate_limits (
  actor_id text primary key,
  window_started_at timestamptz not null default now(),
  write_count integer not null default 0 check (write_count >= 0)
);

revoke all on table public.lens_photos from anon, authenticated;
revoke all on table public.lens_rate_limits from anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.lens_photos to service_role;
grant select, insert, update on table public.lens_rate_limits to service_role;
alter table public.lens_photos enable row level security;
alter table public.lens_rate_limits enable row level security;
