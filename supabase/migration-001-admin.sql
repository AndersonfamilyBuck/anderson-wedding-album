-- Run this once in the Supabase SQL editor to add admin support
-- to a database that already ran the original schema.sql.

alter table allowed_guests add column if not exists is_admin boolean not null default false;

-- Make yourself an admin -- replace the email below with the one
-- you added yourself as (or will sign in with):
update allowed_guests set is_admin = true where email = 'REPLACE-WITH-YOUR-EMAIL';

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

drop policy if exists "admins can remove guests" on allowed_guests;
create policy "admins can remove guests" on allowed_guests
  for delete using (
    exists (select 1 from allowed_guests g where g.email = auth.jwt() ->> 'email' and g.is_admin = true)
  );
