# The Anderson Family Album — Deployment Guide

This is a real web app: email login, a permanent database, and full-resolution
photo/video storage. Nothing about it depends on this chat — once deployed it
runs on its own, permanently, at theandersonfamily.me.

Three services, all free to start:
- **Supabase** — database + file storage + email login
- **Vercel** — hosts the actual website
- **No-IP** — you already own the domain; we just point it at Vercel

Total time: 30–45 minutes if you're doing this for the first time.

---

## 1. Create the Supabase project

1. Go to https://supabase.com → sign up → **New project**.
2. Pick any name (e.g. "anderson-wedding") and a strong database password
   (save it somewhere, you likely won't need it again but keep it safe).
3. Wait ~2 minutes for the project to spin up.
4. In the left sidebar, go to **SQL Editor → New query**, paste in the
   entire contents of `supabase/schema.sql` from this project, and click **Run**.
   This creates the database table, the guest allow-list, and the two
   storage buckets (`originals` and `previews`) with proper security rules.
5. Go to **Table Editor → allowed_guests** and add a row for every family
   member who should be able to log in — just their email and name.
   (Delete the placeholder `buck@example.com` row first.)
   Anyone NOT on this list can request a login link but won't see or upload
   anything — the database blocks them automatically.
6. Go to **Project Settings → API**. Copy:
   - **Project URL** → this is `VITE_SUPABASE_URL`
   - **anon public key** → this is `VITE_SUPABASE_ANON_KEY`

### One setting to check: email link expiry / redirect
Go to **Authentication → URL Configuration** and set:
- **Site URL**: `https://theandersonfamily.me`
- **Redirect URLs**: add `https://theandersonfamily.me/*`

This makes sure the magic-link emails send people to your real domain once
it's live (steps 3–4 below). Until the domain is live, you can temporarily
use your Vercel preview URL here.

### A note on video size (important)
Supabase's free tier gives 1GB of file storage and 2GB/month of bandwidth,
with a 50MB per-file upload limit. Wedding videos from phones can easily
exceed that. If people will be uploading video, plan to upgrade to
Supabase's **Pro plan** (~$25/mo, raises the per-file limit to 5GB and gives
much more storage/bandwidth) — you can start on the free tier today and
upgrade later without losing any data.

---

## 2. Run it locally first (optional but recommended)

```bash
cd anderson-wedding-album
npm install
cp .env.example .env
# edit .env and paste in your real Supabase URL + anon key
npm run dev
```

Open the printed localhost URL, try signing in with an email you added to
`allowed_guests`, and confirm the magic link email arrives and logs you in.

---

## 3. Deploy to Vercel

1. Push this project to a GitHub repo (Vercel deploys from GitHub).
   - Easiest path: create a new repo on github.com, then from this folder:
     ```bash
     git init
     git add .
     git commit -m "Anderson wedding album"
     git branch -M main
     git remote add origin <your-repo-url>
     git push -u origin main
     ```
2. Go to https://vercel.com → sign up (GitHub login is easiest) →
   **Add New → Project** → import the repo you just pushed.
3. In the import screen, expand **Environment Variables** and add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   (same values from step 1.6 above)
4. Click **Deploy**. In about a minute you'll get a live URL like
   `anderson-wedding-album.vercel.app` — open it and confirm login/upload
   works there too.

---

## 4. Point theandersonfamily.me at it

1. In Vercel: open your project → **Settings → Domains** → add
   `theandersonfamily.me` (and optionally `www.theandersonfamily.me`).
   Vercel will show you exactly which DNS records to add — usually:
   - An **A record** for the root domain pointing to `76.76.21.21`
   - A **CNAME record** for `www` pointing to `cname.vercel-dns.com`
   (Vercel always shows the current values on screen — use whatever it
   displays, in case these change.)
2. Log in to your No-IP account → find the DNS management panel for
   theandersonfamily.me (since you registered the domain through them,
   there should be a "DNS Records" or "Manage Domain" section) → add the
   A and CNAME records exactly as Vercel showed you.
3. DNS changes can take anywhere from a few minutes to a few hours to
   propagate. Vercel's Domains page will show a green checkmark once it
   sees the domain correctly pointed.
4. Go back to Supabase → Authentication → URL Configuration and make sure
   the Site URL is set to `https://theandersonfamily.me` (step 1).

Once that checkmark turns green, theandersonfamily.me is your live,
permanent family album.

---

## How the features work

- **Email login** — no passwords. Someone enters their email, gets a
  magic link, clicks it, they're in. Only emails you've added to
  `allowed_guests` can actually see or upload anything.
- **Submitted by / sort & filter** — the dropdown filters the gallery to
  one person's uploads; the sort dropdown reorders by newest, oldest, or
  submitter name.
- **Metadata/description filter** — the search box matches against each
  upload's description and the uploader's name.
- **Video playback** — videos play inline when clicked, with a small
  thumbnail frame auto-captured for the gallery grid.
- **High-res / web-size download** — every photo gets both a full-original
  download and a compressed "web-size" one. Videos currently only offer the
  original (see the note on video transcoding below).

## Known limitation: no separate low-res video
Generating an actual compressed *video* file requires server-side video
processing (ffmpeg), which is a meaningfully bigger build than everything
else here. Right now videos upload and store at full original quality, and
that's the only version available to download or stream. If you want a true
low-res video option later (faster streaming for people on slow connections),
that's a good phase-2 addition — just let me know.

## Adding or removing family members later
Go to Supabase → Table Editor → `allowed_guests` → add or delete rows.
Changes take effect immediately, no redeploy needed. Or, if you're an
admin, use the "Manage guest list" panel right on the site itself — add,
remove, disable/enable, all from the app.

## Admin features
If you ran `migration-001-admin.sql` and `migration-002-disable-and-delete.sql`
(or you're starting fresh with the current `schema.sql`, which already
includes both), admins get an extra "Manage guest list" link at the top of
the site once signed in. From there you can:
- **Add** a new family email to the guest list
- **Disable** someone's access temporarily without deleting their history
  (they'll see a clear "your access was disabled" message if they try to
  sign in)
- **Remove** someone from the list entirely
- **Delete** any individual photo or video from the gallery (there's a
  Delete button on each photo card and in the full-size view) — this
  permanently removes both the file and its database record.
