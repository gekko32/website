// PUT /api/admin/klienten/:id — Stammdaten einer Klientenakte ändern (Stufe 2).
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../lib/auth';
import { getKlient, updateKlient, type KlientEingabe } from '../../../../lib/klientenakte';
import { protokolliere, unterschied } from '../../../../lib/akte-protokoll';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const PUT: APIRoute = async ({ request, params }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session || !isAdmin(session)) return json(401, { error: 'Unauthorized' });
  if (!params.id) return json(400, { error: 'Id fehlt.' });
  let body: KlientEingabe;
  try { body = await request.json(); } catch { return json(400, { error: 'Ungültige Anfrage.' }); }
  const vorher = await getKlient(params.id).catch(() => null);
  const r = await updateKlient(params.id, body);
  if (!r.ok) return json(r.error === 'Akte nicht gefunden.' ? 404 : 400, r);
  // Änderungsprotokoll (K94): nur die tatsächlich geänderten Felder, vorher → nachher.
  if (vorher) {
    const d = unterschied(vorher as unknown as Record<string, unknown>, r.klient as unknown as Record<string, unknown>,
      Object.keys(body).filter((k) => k !== 'id'));
    if (d) await protokolliere(process.env.BRAND || 'mentolder', session.email, {
      bereich: 'stammdaten', aktion: 'Stammdaten geändert', klientId: params.id, objekt: r.klient.name, vorher: d.vorher, nachher: d.nachher,
    });
  }
  return json(200, { ok: true });
};
