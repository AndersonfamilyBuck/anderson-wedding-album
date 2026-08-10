-- Run this once in the Supabase SQL editor. Safe to run even though
-- you've already run schema.sql and migration-001-admin.sql.

alter table allowed_guests add column if not exists is_disabled boolean not null default false;

-- Guests can still see their own allow-list row even if disabled --
-- that's how the app knows to show them a "your access was disabled" message
-- rather than a confusing error. No change needed there.

-- Admins can update guests (needed for the disable/enable toggle)
drop policy if exists "admins can update guests" on allowed_guests;
create policy "admins can update guests" on allowed_guests
  for update using (
    exists (select 1 from allowed_guests g where g.email = auth.jwt() ->> 'email' and g.is_admin = true)
  ) with check (
    exists (select 1 from allowed_guests g where g.email = auth.jwt() ->> 'email' and g.is_admin = true)
  );

-- Re-create the read/insert policies on photos so disabled guests lose access
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

-- Admins can delete any photo/video row
drop policy if exists "admins can delete photos" on photos;
create policy "admins can delete photos" on photos
  for delete using (
    exists (select 1 from allowed_guests g where g.email = auth.jwt() ->> 'email' and g.is_admin = true)
  );

-- Same disabled-check update for storage access, plus admin delete on files
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
