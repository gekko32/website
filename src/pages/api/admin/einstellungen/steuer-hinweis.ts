import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../lib/auth';
import { bestaetigeSteuerHinweis } from '../../../../lib/tax-monitor';
import { protokolliere } from '../../../../lib/akte-protokoll';

// K141 (Handtest 29.10.2026): Hinweis auf eine automatische Steuer-Umstellung bestätigen.
export const POST: APIRoute = async ({ request, redirect }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });
  const brand = process.env.BRAND || 'mentolder';
  await bestaetigeSteuerHinweis(brand);
  await protokolliere(brand, session.email, { bereich: 'einstellungen', aktion: 'Hinweis Steuer-Umstellung bestätigt' }).catch(() => {});
  const zurueck = new URL(request.headers.get('referer') ?? '/admin', 'http://x').pathname;
  return redirect(zurueck.startsWith('/admin') ? zurueck : '/admin', 303);
};
