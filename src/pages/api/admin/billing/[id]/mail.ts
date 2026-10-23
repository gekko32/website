// Handtest 23.10.2026: Rechnungs-E-Mail vorbereiten (GET) und senden (POST) – nur festgeschriebene
// Rechnungen, nur Admins (K69).
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../../lib/auth';
import { rechnungsMailVorschlag, sendeRechnungsMail } from '../../../../../lib/billing-mail';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function zugang(request: Request): Promise<Response | { email?: string }> {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });
  return { email: session.email };
}

export const GET: APIRoute = async ({ request, params }) => {
  const z = await zugang(request);
  if (z instanceof Response) return z;
  const v = await rechnungsMailVorschlag(process.env.BRAND || 'mentolder', params.id ?? '');
  return v ? json(200, v) : json(404, { error: 'Rechnung nicht gefunden oder noch Entwurf.' });
};

export const POST: APIRoute = async ({ request, params }) => {
  const z = await zugang(request);
  if (z instanceof Response) return z;
  const body = await request.json().catch(() => ({})) as { an?: string; betreff?: string; text?: string };
  const r = await sendeRechnungsMail(process.env.BRAND || 'mentolder', params.id ?? '',
    { an: body.an ?? '', betreff: body.betreff ?? '', text: body.text ?? '' }, z.email);
  return r.ok ? json(200, { ok: true }) : json(r.status, { error: r.fehler });
};
