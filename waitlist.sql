-- waitlist.sql
-- Creates the email waitlist table for Moist sensor pre-orders.
-- Run this in the Supabase SQL editor at:
--   https://supabase.com/dashboard/project/<your-project>/sql

-- ── Table ─────────────────────────────────────────────────────
create table if not exists public.waitlist (
  id         uuid        primary key default gen_random_uuid(),
  email      text        not null unique,
  created_at timestamptz not null default now()
);

-- Index for fast email lookups / duplicate checks
create index if not exists waitlist_email_idx on public.waitlist (email);

-- ── Row Level Security ────────────────────────────────────────
alter table public.waitlist enable row level security;

-- Anyone (including unauthenticated visitors) can insert their email
create policy "Anyone can join the waitlist"
  on public.waitlist
  for insert
  to anon, authenticated
  with check (true);

-- Only authenticated users (admins) can read the waitlist
create policy "Authenticated users can read the waitlist"
  on public.waitlist
  for select
  to authenticated
  using (true);

-- Only authenticated users can delete entries (e.g. unsubscribe)
create policy "Authenticated users can delete waitlist entries"
  on public.waitlist
  for delete
  to authenticated
  using (true);
