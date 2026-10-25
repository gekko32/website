// Rechnungswesen Stufe 4, T16: PDF eines Angebots – das beim Versand gespeicherte, bei
// Entwürfen eine Vorschau mit Entwurfskennung. Nur Admins (K69).
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../../lib/auth';
import { pool } from '../../../../../lib/website-db';
import { holeAngebot, angebotVorschau, initAngebotTabelle } from '../../../../../lib/billing-angebot';
import { erzeugeAngebotsPdf } from '../../../../../lib/billing-angebot-pdf';
import { angebotsDateiname } from '../../../../../lib/beleg-dateiname';

export const GET: APIRoute = async ({ request, params }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });
  const brand = process.env.BRAND || 'mentolder';
  await initAngebotTabelle();
  const a = await holeAngebot(brand, params.id ?? '');
  if (!a) return new Response('Nicht gefunden', { status: 404 });
  let pdf: Buffer | null = (await pool.query('SELECT pdf FROM billing_quotes WHERE id=$1', [a.id])).rows[0]?.pdf ?? null;
  let empfaenger = a.empfaenger;
  if (!pdf) {
    const v = await angebotVorschau(brand, a);
    if (!v.empfaenger) return new Response('Empfänger fehlt', { status: 422 });
    pdf = await erzeugeAngebotsPdf(brand, a, v.positionen, v.empfaenger);
    empfaenger = v.empfaenger; // Prüfung N5: Entwurf mit dem Empfänger der Vorschau
  }
  return new Response(new Uint8Array(pdf), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${await angebotsDateiname(a, empfaenger)}"` },
  });
};
