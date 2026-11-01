// N32 (Gerald 01.11.2026): unverschickte Mahnung verwerfen, mit Mahnpause bis zu einem Datum. Nur Admins.
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../../../lib/auth';
import { verwirfMahnung } from '../../../../../../lib/mahnung-versand';

export const POST: APIRoute = async ({ request, params }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });
  const body = await request.json().catch(() => ({})) as { bis?: string; grund?: string };
  const r = await verwirfMahnung(process.env.BRAND || 'mentolder', params.id ?? '',
    { bis: String(body.bis ?? ''), grund: String(body.grund ?? '') }, session.email)
    .catch(() => ({ ok: false as const, status: 500, fehler: 'Verwerfen hat nicht geklappt – es wurde nichts geändert. Bitte noch einmal versuchen.' }));
  return new Response(JSON.stringify(r.ok ? { ok: true } : { error: r.fehler }), {
    status: r.ok ? 200 : r.status, headers: { 'Content-Type': 'application/json' },
  });
};
