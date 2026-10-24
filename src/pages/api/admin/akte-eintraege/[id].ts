// Nachtrag Stufe 4 (K104): abgelegte Datei herunterladen – nur Admins, immer als Download.
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../lib/auth';
import { holeDatei } from '../../../../lib/akte-dokumente';

export const GET: APIRoute = async ({ request, params }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });
  const d = await holeDatei(process.env.BRAND || 'mentolder', params.id ?? '');
  if (!d) return new Response('Datei nicht gefunden', { status: 404 });
  const ascii = d.name.replace(/[^\x20-\x7e]/g, '_');
  return new Response(new Uint8Array(d.inhalt), {
    headers: {
      'Content-Type': d.mime,
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(d.name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
};
