// POST /api/admin/klienten — Klient ohne Benutzerkonto anlegen (Klientenakte, Stufe 2).
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../lib/auth';
import { createKlient, type KlientEingabe } from '../../../../lib/klientenakte';
import { protokolliere } from '../../../../lib/akte-protokoll';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session || !isAdmin(session)) return json(401, { error: 'Unauthorized' });
  let body: KlientEingabe;
  try { body = await request.json(); } catch { return json(400, { error: 'Ungültige Anfrage.' }); }
  const r = await createKlient(body);
  if (!r.ok) return json(r.vorhandenId ? 409 : 400, r);
  // Änderungsprotokoll (K94).
  await protokolliere(process.env.BRAND || 'mentolder', session.email, {
    bereich: 'stammdaten', aktion: 'Klient angelegt', klientId: r.klient.id, objekt: r.klient.name,
    nachher: { kundennummer: r.klient.customer_number, email: r.klient.email?.endsWith('.invalid') ? 'keine' : r.klient.email, ort: r.klient.city },
  });
  return json(201, { ok: true, id: r.klient.id, customerNumber: r.klient.customer_number });
};
