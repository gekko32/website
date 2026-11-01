// K164 (Handtest 01.11.2026): Mahnung ohne E-Mail – Versand per Post vermerken. Nur Admins.
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../../../lib/auth';
import { vermerkeMahnungPerPost } from '../../../../../../lib/mahnung-versand';

export const POST: APIRoute = async ({ request, params }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });
  const r = await vermerkeMahnungPerPost(process.env.BRAND || 'mentolder', params.id ?? '', session.email);
  return new Response(JSON.stringify(r.ok ? { ok: true } : { error: r.fehler }), {
    status: r.ok ? 200 : r.status, headers: { 'Content-Type': 'application/json' },
  });
};
