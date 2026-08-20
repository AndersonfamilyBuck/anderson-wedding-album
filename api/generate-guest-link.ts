// Vercel serverless function — runs server-side only, never bundled into the
// browser app. Generates a one-time sign-in link for a guest who has no
// email address of their own (elderly relatives, kids, etc.), so an admin
// can share it directly (by text, or by opening it on their device) instead
// of it being emailed anywhere.
//
// SECURITY: this function requires the caller to be a signed-in admin. It
// verifies the caller's own Supabase access token and checks their
// allowed_guests.is_admin flag using the service role key (server-side only)
// before it will generate a link for anyone. Never expose
// SUPABASE_SERVICE_ROLE_KEY to client-side code — it must only be set as a
// Vercel environment variable used here.

import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'nodejs' };

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL as string;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
  const siteUrl = process.env.SITE_URL || 'https://theandersonfamily.me';

  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_URL.' });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const callerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!callerToken) {
    res.status(401).json({ error: 'Missing sign-in token.' });
    return;
  }

  const { email } = (req.body || {}) as { email?: string };
  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'Missing guest email.' });
    return;
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Verify the caller is who their token says they are.
  const { data: callerData, error: callerError } = await admin.auth.getUser(callerToken);
  if (callerError || !callerData?.user?.email) {
    res.status(401).json({ error: 'Could not verify your sign-in.' });
    return;
  }
  const callerEmail = callerData.user.email;

  // Confirm the caller is a real admin on the guest list (bypassing RLS via
  // the service role, since this check itself must not depend on the
  // caller's own row-level permissions).
  const { data: callerGuest, error: guestLookupError } = await admin
    .from('allowed_guests')
    .select('is_admin, is_disabled')
    .eq('email', callerEmail)
    .maybeSingle();

  if (guestLookupError || !callerGuest?.is_admin || callerGuest?.is_disabled) {
    res.status(403).json({ error: 'Only admins can generate sign-in links.' });
    return;
  }

  // Generate the one-time link. If this email has no auth user yet, Supabase
  // creates one automatically as part of issuing a magic link.
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: siteUrl },
  });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const link = (data as any)?.properties?.action_link || (data as any)?.action_link;
  if (!link) {
    res.status(500).json({ error: 'Supabase did not return a link.' });
    return;
  }

  res.status(200).json({ link });
}
