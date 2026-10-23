import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../../lib/auth';
import { initBillingTables } from '../../../../../lib/website-db';
import { verwirfEntwurf } from '../../../../../lib/billing-entwurf';

export const POST: APIRoute = async ({ request, params , locals }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session || !isAdmin(session)) return new Response('Unauthorized', { status: 401 });
  try {
    await initBillingTables();
    const brand = process.env.BRAND || 'mentolder';
    // Stufe 3 T10a: Posten des Entwurfs werden dabei wieder offen (K24).
    // Handtest 23.10.2026: ehrlich melden, wenn es nichts zu verwerfen gab (z. B. schon festgeschrieben).
    if (!(await verwirfEntwurf(brand, params.id as string))) {
      return new Response(JSON.stringify({ error: 'Kein Entwurf mehr – die Rechnung ist schon festgeschrieben (oder wurde bereits verworfen). Festgeschriebene Rechnungen lassen sich nur stornieren.' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    locals.requestLogger.error({ err }, '[billing/discard]');
    return new Response('Internal Server Error', { status: 500 });
  }
};
