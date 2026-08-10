-- Run this entire file once in the Supabase SQL editor
-- (Project -> SQL Editor -> New query -> paste -> Run)
-- This is the full, current schema -- if you're setting up a brand new
-- Supabase project, this one file is all you need (you can skip the
-- migration-*.sql files, those are only for upgrading an older install).

create extension if not exists "pgcrypto";

-- ============================================================
-- 1. Guest allow-list
-- Only emails listed here can sign in and see/upload photos.
-- Add family members' emails here (one row each) after running
-- this script, using Table Editor -> allowed_guests -> Insert row,
-- or from the site's own "Manage guest list" admin panel.
-- ============================================================
create table if not exists allowed_guests (
  email text primary key,
  name text,
  is_admin boolean not null default false,
  is_disabled boolean not null default false
);

alter table allowed_guests add column if not exists is_admin boolean not null default false;
alter table allowed_guests add column if not exists is_disabled boolean not null default false;

-- Example row -- edit the email below to your own, then add the rest of
-- your family list either here or from the site's "Manage guest list" panel:
insert into allowed_guests (email, name, is_admin) values
  ('buck@example.com', 'Buck', true)
on conflict (email) do nothing;

-- ============================================================
-- 2. Photos / videos table
-- ============================================================
create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  uploader_email text not null,
  uploader_name text not null,
  media_type text not null check (media_type in ('photo','video')),
  description text default '',
  original_path text not null,
  preview_path text,
  created_at timestamptz not null default now()
);

alter table allowed_guests enable row level security;
alter table photos enable row level security;

-- Every guest can see their own row (used to detect "you're disabled" vs
-- "you're not on the list" and to show admin controls)
drop policy if exists "guests can check their own allow-list row" on allowed_guests;
create policy "guests can check their own allow-list row" on allowed_guests
  for select using (auth.jwt() ->> 'email' = email);

drop policy if exists "admins can view all guests" on allowed_guests;
create policy "admins can view all guests" on allowed_guests
  for select using (
    exists (select 1 from allowed_guests g where g.email = auth.jwt() ->> 'email' and g.is_admin = true)
  );

drop policy if exists "admins can add guests" on allowed_guests;
create policy "admins can add guests" on allowed_guests
  for insert with check (
    exists (select 1 from allowed_guests g where g.email = auth.jwt() ->> 'email' and g.is_admin = true)
  );

drop policy if exists "admins can update guests" on allowed_guests;
create policy "admins can update guests" on allowed_guests
  for update using (
    exists (select 1 from allowed_guests g where g.email = auth.jwt() ->> 'email' and g.is_admin = true)
  ) with check (
    exists (select 1 from allowed_guests g where g.email = auth.jwt() ->> 'email' and g.is_admin = true)
  );

drop policy if exists "admins can remove guests" on allowed_guests;
create policy "admins can remove guests" on allowed_guests
  for delete using (
    exists (select 1 from allowed_guests g where g.email = auth.jwt() ->> 'email' and g.is_admin = true)
  );

-- Photos: readable/insertable only by guests who are on the list AND not disabled
drop policy if exists "allowed guests can read photos" on photos;
create policy "allowed guests can read photos" on photos
  for select using (
    exists (select 1 from allowed_guests g where g.email = auth.jwt() ->> 'email' and g.is_disabled = false)
  );

drop policy if exists "allowed guests can insert photos" on photos;
create policy "allowed guests can insert photos" on photos
  for insert with check (
    exists (select 1 from allowed_guests g where g.email = auth.jwt() ->> 'email' and g.is_disabled = false)
    and uploader_email = auth.jwt() ->> 'email'
  );

drop policy if exists "admins can delete photos" on photos;
create policy "admins can delete photos" on photos
  for delete using (
    exists (select 1 from allowed_guests g where g.email = auth.jwt() ->> 'email' and g.is_admin = true)
  );

-- ============================================================
-- 3. Storage buckets (private -- accessed only via signed URLs)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('originals', 'originals', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('previews', 'previews', false)
on conflict (id) do nothing;

drop policy if exists "allowed guests can read originals" on storage.objects;
create policy "allowed guests can read originals" on storage.objects
  for select using (
    bucket_id = 'originals'
    and exists (select 1 from allowed_guests g where g.email = auth.jwt() ->> 'email' and g.is_disabled = false)
  );

drop policy if exists "allowed guests can upload originals" on storage.objects;
create policy "allowed guests can upload originals" on storage.objects
  for insert with check (
    bucket_id = 'originals'
    and exists (select 1 from allowed_guests g where g.email = auth.jwt() ->> 'email' and g.is_disabled = false)
  );

drop policy if exists "admins can delete originals" on storage.objects;
create policy "admins can delete originals" on storage.objects
  for delete using (
    bucket_id = 'originals'
    and exists (select 1 from allowed_guests g where g.email = auth.jwt() ->> 'email' and g.is_admin = true)
  );

drop policy if exists "allowed guests can read previews" on storage.objects;
create policy "allowed guests can read previews" on storage.objects
  for select using (
    bucket_id = 'previews'
    and exists (select 1 from allowed_guests g where g.email = auth.jwt() ->> 'email' and g.is_disabled = false)
  );

drop policy if exists "allowed guests can upload previews" on storage.objects;
create policy "allowed guests can upload previews" on storage.objects
  for insert with check (
    bucket_id = 'previews'
    and exists (select 1 from allowed_guests g where g.email = auth.jwt() ->> 'email' and g.is_disabled = false)
  );

drop policy if exists "admins can delete previews" on storage.objects;
create policy "admins can delete previews" on storage.objects
  for delete using (
    bucket_id = 'previews'
    and exists (select 1 from allowed_guests g where g.email = auth.jwt() ->> 'email' and g.is_admin = true)
  );
