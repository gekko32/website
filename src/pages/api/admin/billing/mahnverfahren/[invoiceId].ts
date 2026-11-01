// N33 (Gerald 01.11.2026): Mahnverfahren einer Rechnung beenden (POST {art, grund}) oder wieder aufnehmen
// (POST {aktion: 'aufnehmen'}). Nur Admins.
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../../lib/auth';
import { beendeMahnverfahren, nimmMahnverfahrenAuf } from '../../../../../lib/mahn-vorgang';

export const POST: APIRoute = async ({ request, params }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });
  const brand = process.env.BRAND || 'mentolder';
  const body = await request.json().catch(() => ({})) as { aktion?: string; art?: string; grund?: string };
  const fehlschlag = { ok: false as const, status: 500, fehler: 'Hat nicht geklappt – es wurde nichts geändert. Bitte noch einmal versuchen.' };
  const r = body.aktion === 'aufnehmen'
    ? await nimmMahnverfahrenAuf(brand, params.invoiceId ?? '', session.email).catch(() => fehlschlag)
    : await beendeMahnverfahren(brand, params.invoiceId ?? '', { art: String(body.art ?? ''), grund: String(body.grund ?? '') }, session.email)
      .catch(() => fehlschlag);
  return new Response(JSON.stringify(r.ok ? { ok: true } : { error: r.fehler }), {
    status: r.ok ? 200 : r.status, headers: { 'Content-Type': 'application/json' },
  });
};
