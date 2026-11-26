create table if not exists public.video_links (
  id text primary key check (char_length(id) between 1 and 64),
  category text not null check (category in ('vlog', 'dancee')),
  url text not null check (char_length(url) between 1 and 2048),
  name text not null default '' check (char_length(name) <= 120),
  date date not null,
  cover text not null default '' check (char_length(cover) <= 2800000),
  sort_order integer not null default 0,
  created_by_uid text,
  updated_by_uid text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

revoke all on table public.video_links from anon, authenticated;
grant select, insert, update on table public.video_links to service_role;
alter table public.video_links enable row level security;

-- The built-in rows are seeded exactly once per ID. A deleted row keeps its ID
-- and deleted_at value, so re-running this file never resurrects it.
insert into public.video_links (id, category, url, name, date, cover, sort_order)
values
  ('builtin-vlog-1', 'vlog', 'https://www.bilibili.com/video/BV1v97U6GEH6/', 'Nono''s Vlog.1', '2026-06-06', 'assets/video/nono-vlog-1.jpg', 1),
  ('builtin-vlog-2', 'vlog', 'https://www.bilibili.com/video/BV1L4pY6VEpe/', '《下一个是谁》Reaction · 第四季第一期', '2026-10-10', 'assets/video/reaction-episode-1.jpg', 2)
on conflict (id) do nothing;
