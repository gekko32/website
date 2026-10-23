// Prüfung Stufe 4 (B3, K60): Mahnung als PDF zum Drucken – nur Admins (K69).
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../../../lib/auth';
import { mahnungsPdf } from '../../../../../../lib/invoice-dunning';

export const GET: APIRoute = async ({ request, params }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });
  const r = await mahnungsPdf(process.env.BRAND || 'mentolder', params.id ?? '');
  if (!r) return new Response('Nicht gefunden', { status: 404 });
  return new Response(new Uint8Array(r.pdf), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${r.dateiname}"` },
  });
};
