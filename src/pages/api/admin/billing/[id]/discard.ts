import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../../lib/auth';
import { initBillingTables } from '../../../../../lib/website-db';
import { verwirfEntwurf } from '../../../../../lib/billing-entwurf';
import { protokolliere } from '../../../../../lib/akte-protokoll';
import { pool } from '../../../../../lib/website-db';

export const POST: APIRoute = async ({ request, params , locals }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session || !isAdmin(session)) return new Response('Unauthorized', { status: 401 });
  try {
    await initBillingTables();
    const brand = process.env.BRAND || 'mentolder';
    // Stufe 3 T10a: Posten des Entwurfs werden dabei wieder offen (K24).
    // Handtest 23.10.2026: ehrlich melden, wenn es nichts zu verwerfen gab (z. B. schon festgeschrieben).
    const kopf = (await pool.query(`SELECT klient_id::text AS klient_id, number, gross_amount::float AS betrag FROM billing_invoices WHERE id=$1 AND brand=$2`, [params.id, brand])).rows[0];
    if (!(await verwirfEntwurf(brand, params.id as string))) {
      return new Response(JSON.stringify({ error: 'Kein Entwurf mehr – die Rechnung ist schon festgeschrieben (oder wurde bereits verworfen). Festgeschriebene Rechnungen lassen sich nur stornieren.' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
    await protokolliere(brand, session.email, { bereich: 'rechnung', aktion: 'Rechnungsentwurf verworfen', klientId: kopf?.klient_id, objekt: kopf?.number, vorher: { betrag: kopf?.betrag } });
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    locals.requestLogger.error({ err }, '[billing/discard]');
    return new Response('Internal Server Error', { status: 500 });
  }
};
