-- ==========================================================================
--  Aura Chat — Supabase schema
--  Run this once in the Supabase dashboard → SQL Editor → New query.
--  The server talks to these tables with a secret/service-role key only.
--  RLS is enabled with no client policies, so publishable/anon keys can
--  never read or write app data directly.
-- ==========================================================================

-- --------------------------------------------------------------------------
--  Users / sessions (custom username + password auth, no Supabase Auth)
-- --------------------------------------------------------------------------
create table if not exists public.aura_users (
  id             text primary key,
  username       text not null,
  username_lower text not null unique,
  salt           text not null,
  password_hash  text not null,
  avatar_color   text not null default '#5865F2',
  created_at     bigint not null
);

create table if not exists public.aura_sessions (
  token      text primary key,
  user_id    text not null references public.aura_users(id) on delete cascade,
  created_at bigint not null
);

create index if not exists aura_sessions_user_idx
  on public.aura_sessions (user_id);

-- --------------------------------------------------------------------------
--  Rooms + membership
-- --------------------------------------------------------------------------
create table if not exists public.aura_rooms (
  id         text primary key,
  name       text not null,
  owner_id   text not null references public.aura_users(id) on delete cascade,
  otp        text not null unique check (otp ~ '^[0-9]{6}$'),
  created_at bigint not null
);

create table if not exists public.aura_room_members (
  room_id   text not null references public.aura_rooms(id) on delete cascade,
  user_id   text not null references public.aura_users(id) on delete cascade,
  joined_at bigint not null default 0,
  primary key (room_id, user_id)
);

create index if not exists aura_room_members_user_idx
  on public.aura_room_members (user_id);

-- --------------------------------------------------------------------------
--  Friend requests (a row becomes the friendship when accepted)
-- --------------------------------------------------------------------------
create table if not exists public.aura_friend_requests (
  id           text primary key,
  from_user_id text not null references public.aura_users(id) on delete cascade,
  to_user_id   text not null references public.aura_users(id) on delete cascade,
  status       text not null default 'pending'
                 check (status in ('pending', 'accepted')),
  created_at   bigint not null,
  accepted_at  bigint
);

create index if not exists aura_friend_requests_from_idx
  on public.aura_friend_requests (from_user_id, status);
create index if not exists aura_friend_requests_to_idx
  on public.aura_friend_requests (to_user_id, status);

-- One accepted friendship per user pair (direction-independent).
create unique index if not exists aura_friend_requests_pair_idx
  on public.aura_friend_requests (
    least(from_user_id, to_user_id),
    greatest(from_user_id, to_user_id)
  )
  where status = 'accepted';

-- --------------------------------------------------------------------------
--  Messages (DM channels are "dm:<id>:<id>", rooms are "room:<id>")
-- --------------------------------------------------------------------------
create table if not exists public.aura_messages (
  id           text primary key,
  channel_id   text not null,
  type         text not null default 'user' check (type in ('user', 'system')),
  user_id      text references public.aura_users(id) on delete set null,
  username     text,
  avatar_color text,
  text         text not null default '',
  attachment   jsonb,
  created_at   bigint not null
);

create index if not exists aura_messages_channel_idx
  on public.aura_messages (channel_id, created_at);

-- Added later for reactions + edited messages. `alter` keeps reruns safe.
alter table public.aura_messages
  add column if not exists reactions jsonb not null default '{}'::jsonb,
  add column if not exists edited_at bigint;

-- --------------------------------------------------------------------------
--  Lock the tables down: server-only access via a secret/service-role key.
-- --------------------------------------------------------------------------
alter table public.aura_users           enable row level security;
alter table public.aura_sessions        enable row level security;
alter table public.aura_rooms           enable row level security;
alter table public.aura_room_members    enable row level security;
alter table public.aura_friend_requests enable row level security;
alter table public.aura_messages        enable row level security;

revoke all on public.aura_users           from anon, authenticated;
revoke all on public.aura_sessions        from anon, authenticated;
revoke all on public.aura_rooms           from anon, authenticated;
revoke all on public.aura_room_members    from anon, authenticated;
revoke all on public.aura_friend_requests from anon, authenticated;
revoke all on public.aura_messages        from anon, authenticated;

-- Supabase's service_role bypasses RLS; make sure it still has privileges.
grant all on public.aura_users           to service_role;
grant all on public.aura_sessions        to service_role;
grant all on public.aura_rooms           to service_role;
grant all on public.aura_room_members    to service_role;
grant all on public.aura_friend_requests to service_role;
grant all on public.aura_messages        to service_role;

-- --------------------------------------------------------------------------
--  Public media bucket
--  Reads are public (so <img>/<video> URLs work); writes are server-only.
--  Wrapped in an exception handler so a Storage permission quirk can never
--  roll back the table creation above.
-- --------------------------------------------------------------------------
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('aura-uploads', 'aura-uploads', true)
  on conflict (id) do update set public = true;
exception when others then
  raise warning 'Could not create the aura-uploads bucket automatically: %', sqlerrm;
end $$;
