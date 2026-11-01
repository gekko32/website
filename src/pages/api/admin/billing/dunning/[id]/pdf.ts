// Prüfung Stufe 4 (B3, K60), K165 (01.11.2026): Mahnschreiben als PDF – mit Stufentext und Frist. Nur Admins (K69).
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../../../lib/auth';
import { mahnschreibenPdf } from '../../../../../../lib/mahnung-versand';

export const GET: APIRoute = async ({ request, params, url }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });
  const r = await mahnschreibenPdf(process.env.BRAND || 'mentolder', params.id ?? '');
  if (!r) return new Response('Nicht gefunden', { status: 404 });
  // ?ansehen=1 öffnet im Browser (Prüfseite), sonst Download zum Drucken.
  const art = url.searchParams.get('ansehen') === '1' ? 'inline' : 'attachment';
  return new Response(new Uint8Array(r.pdf), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${art}; filename="${r.dateiname}"`, 'Cache-Control': 'no-store' },
  });
};
