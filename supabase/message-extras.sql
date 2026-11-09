-- Add reactions + edit timestamps to an existing Aura Chat project.
-- Paste this into Supabase → SQL Editor → New query and click Run.
-- Safe to run more than once.

alter table public.aura_messages
  add column if not exists reactions jsonb not null default '{}'::jsonb,
  add column if not exists edited_at bigint;
