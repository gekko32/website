import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../../lib/auth';
import { createCreditNote, generateCreditNotePdf } from '../../../../../lib/invoice-storno';
import { pool } from '../../../../../lib/website-db';
import { protokolliere } from '../../../../../lib/akte-protokoll';

// K153 (Handtest 30.10.2026, H26): Storno aus dem Admin – Meldungen auf Deutsch, Eintrag im Änderungsprotokoll.
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const FEHLER_TEXT: Record<string, string> = {
  'invoice cannot be cancelled': 'Entwürfe und schon stornierte Rechnungen lassen sich nicht stornieren.',
  'credit note cannot be cancelled again': 'Eine Gutschrift lässt sich nicht stornieren.',
};

export const POST: APIRoute = async ({ request, params }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });

  const body = await request.json().catch(() => ({})) as { reason?: string };
  const reason = body.reason?.trim();
  if (!reason) return json(400, { error: 'Bitte eine Begründung für das Storno eintragen.' });

  let credit: Awaited<ReturnType<typeof createCreditNote>>;
  try {
    credit = await createCreditNote(params.id!, reason.slice(0, 500), { userId: session.sub, email: session.email });
  } catch (err) {
    const m = (err as Error).message;
    return json(409, { error: FEHLER_TEXT[m] ?? `Storno nicht möglich: ${m}` });
  }
  if (!credit) return json(404, { error: 'Rechnung nicht gefunden.' });
  // Prüfung E2: Ab hier ist das Storno gebucht – Protokoll zuerst, ein PDF-Fehler darf nicht „nicht storniert“ melden.
  const orig = (await pool.query(`SELECT number, klient_id::text AS klient_id FROM billing_invoices WHERE id = $1`, [params.id])).rows[0];
  await protokolliere(credit.brand, session.email, {
    bereich: 'rechnung', aktion: 'Rechnung storniert', klientId: orig?.klient_id ?? null, objekt: orig?.number ?? null,
    beschreibung: `Gutschrift ${credit.number}: ${reason.slice(0, 300)}`,
  }).catch(() => {});
  const pdfOk = await generateCreditNotePdf(credit.id).then(() => true).catch(() => false);
  return json(200, { ok: true, credit, ...(pdfOk ? {} : { hinweis: 'Gutschrift angelegt, aber das PDF konnte nicht erzeugt werden.' }) });
};
