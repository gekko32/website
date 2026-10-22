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
    await verwirfEntwurf(brand, params.id as string);
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    locals.requestLogger.error({ err }, '[billing/discard]');
    return new Response('Internal Server Error', { status: 500 });
  }
};
