// PUT /api/admin/klienten/:id — Stammdaten einer Klientenakte ändern (Stufe 2).
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../lib/auth';
import { updateKlient, type KlientEingabe } from '../../../../lib/klientenakte';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const PUT: APIRoute = async ({ request, params }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session || !isAdmin(session)) return json(401, { error: 'Unauthorized' });
  if (!params.id) return json(400, { error: 'Id fehlt.' });
  let body: KlientEingabe;
  try { body = await request.json(); } catch { return json(400, { error: 'Ungültige Anfrage.' }); }
  const r = await updateKlient(params.id, body);
  if (!r.ok) return json(r.error === 'Akte nicht gefunden.' ? 404 : 400, r);
  return json(200, { ok: true });
};
