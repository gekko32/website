// Nachtrag Stufe 4 (K100): Angebots-E-Mail ansehen (GET, Vorschlag) und senden (POST). Nur Admins.
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../../lib/auth';
import { angebotMailVorschlag, sendeAngebotsMail } from '../../../../../lib/billing-angebot-mail';
import { holeAngebot } from '../../../../../lib/billing-angebot';
import { protokolliere } from '../../../../../lib/akte-protokoll';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function pruefe(request: Request) {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return { fehler: json(401, { error: 'Nicht angemeldet' }) };
  if (!isAdmin(session)) return { fehler: json(403, { error: 'Kein Zugriff' }) };
  return { session };
}

export const GET: APIRoute = async ({ request, params }) => {
  const p = await pruefe(request);
  if (p.fehler) return p.fehler;
  const v = await angebotMailVorschlag(process.env.BRAND || 'mentolder', params.id ?? '');
  return v ? json(200, v) : json(404, { error: 'Angebot nicht gefunden oder noch Entwurf.' });
};

export const POST: APIRoute = async ({ request, params }) => {
  const p = await pruefe(request);
  if (p.fehler) return p.fehler;
  const brand = process.env.BRAND || 'mentolder';
  const body = await request.json().catch(() => ({})) as { an?: string; betreff?: string; text?: string };
  const r = await sendeAngebotsMail(brand, params.id ?? '', { an: body.an ?? '', betreff: body.betreff ?? '', text: body.text ?? '' });
  if (!r.ok) return json(r.status, { error: r.fehler });
  const a = await holeAngebot(brand, params.id ?? '');
  await protokolliere(brand, p.session.email, { bereich: 'angebot', aktion: 'Angebot per E-Mail gesendet', klientId: a?.klientId, objekt: r.nummer ?? null,
    nachher: { an: body.an, betreff: body.betreff } });
  return json(200, { ok: true });
};
