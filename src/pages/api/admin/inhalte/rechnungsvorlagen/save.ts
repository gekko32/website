import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../../lib/auth';
import { setSiteSetting, getSiteSetting } from '../../../../../lib/website-db';
import { protokolliere, unterschied } from '../../../../../lib/akte-protokoll';

const ALLOWED_KEYS = [
  'invoice_intro_text',
  'invoice_kleinunternehmer_notice',
  'invoice_outro_text',
  'invoice_email_subject',
  'invoice_email_body',
] as const;

export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session || !isAdmin(session)) return new Response('Unauthorized', { status: 401 });
  const brand = process.env.BRAND || 'mentolder';
  const body = await request.json();
  // Änderungsprotokoll (Prüfung P2): dieselben Texte wie Einstellungen → Rechnungstexte.
  const vorher = Object.fromEntries(await Promise.all(ALLOWED_KEYS.map(async (k) => [k, (await getSiteSetting(brand, k)) ?? ''])));
  await Promise.all(
    ALLOWED_KEYS.map(k => body[k] !== undefined ? setSiteSetting(brand, k, String(body[k])) : Promise.resolve())
  );
  const nachher = Object.fromEntries(ALLOWED_KEYS.map((k) => [k, body[k] !== undefined ? String(body[k]) : vorher[k]]));
  const d = unterschied(vorher, nachher, [...ALLOWED_KEYS]);
  if (d) await protokolliere(brand, session.email, { bereich: 'einstellungen', aktion: 'Rechnungstexte geändert (Inhalte)', vorher: d.vorher, nachher: d.nachher });
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
