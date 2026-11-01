// K164/K165 (Handtest 01.11.2026): Mahnung per E-Mail – Vorschlag (GET) und Senden (POST). Nur Admins.
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../../../lib/auth';
import { mahnMailVorschlag, sendeMahnungPerMail } from '../../../../../../lib/mahnung-versand';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ request, params }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });
  const v = await mahnMailVorschlag(process.env.BRAND || 'mentolder', params.id ?? '');
  return v ? json(200, v) : json(404, { error: 'Mahnung nicht gefunden.' });
};

export const POST: APIRoute = async ({ request, params }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });
  const body = await request.json().catch(() => ({})) as { an?: string; betreff?: string; text?: string };
  const r = await sendeMahnungPerMail(process.env.BRAND || 'mentolder', params.id ?? '',
    { an: body.an ?? '', betreff: body.betreff ?? '', text: body.text ?? '' }, session.email);
  return r.ok ? json(200, { ok: true }) : json(r.status, { error: r.fehler });
};
