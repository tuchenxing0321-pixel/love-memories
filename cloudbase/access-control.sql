create table if not exists public.archive_members (
  uid text primary key check (char_length(uid) between 1 and 160),
  role text not null check (role in ('owner', 'editor')),
  display_name text not null default '' check (char_length(display_name) <= 40),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on table public.archive_members from anon, authenticated;
grant select, insert, update, delete on table public.archive_members to service_role;
alter table public.archive_members enable row level security;

-- 首次部署时，在 CloudBase 用户管理中复制主人账号的 UID，再执行：
-- insert into public.archive_members(uid, role, display_name)
-- values ('<OWNER_CLOUDBASE_UID>', 'owner', '主人');
