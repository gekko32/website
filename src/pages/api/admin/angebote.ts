// Rechnungswesen Stufe 4, T16/T17: Angebote anlegen, verwerfen, verschicken, neue Fassung,
// Antwort vermerken (K47–K55). Nur Admins (K69).
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../lib/auth';
import { getKlient } from '../../../lib/klientenakte';
import {
  erstelleAngebotsentwurf, holeAngebot, neueFassung, pruefeGueltigBis, verwirfAngebot, versendeAngebot, angebotVorschau,
} from '../../../lib/billing-angebot';
import { erzeugeAngebotsPdf, angebotsMail } from '../../../lib/billing-angebot-pdf';
import { pruefeVersandweg } from '../../../lib/billing-versand';
import { sendEmail } from '../../../lib/email';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });
  const brand = process.env.BRAND || 'mentolder';

  // Versand kommt als JSON aus der Prüfseite, alles andere als Formular.
  if ((request.headers.get('content-type') ?? '').includes('application/json')) {
    const body = await request.json().catch(() => ({})) as { aktion?: string; id?: string; versand?: unknown; gueltigBis?: string };
    if (body.aktion !== 'versenden' || !body.id) return json(400, { error: 'Unbekannte Aktion' });
    const a = await holeAngebot(brand, body.id);
    if (!a) return json(404, { error: 'Angebot nicht gefunden' });
    const vorschau = await angebotVorschau(brand, a);
    const versand = pruefeVersandweg(body.versand, vorschau.empfaenger?.email);
    if (versand.fehler) return json(422, { error: versand.fehler });
    const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    const g = pruefeGueltigBis(body.gueltigBis ?? a.gueltigBis, heute);
    if (!g.wert) return json(422, { error: g.fehler });
    const r = await versendeAngebot(brand, a.id, {
      weg: versand.weg, gueltigBis: g.wert,
      dokument: (fertig) => erzeugeAngebotsPdf(brand, fertig, fertig.positionen, fertig.empfaenger!),
    });
    if (!r.ok) return json(422, { error: r.fehler });
    const pdfUrl = `/api/admin/angebote/${a.id}/pdf`;
    if (versand.weg === 'post') return json(200, { ok: true, number: r.angebot.number, versand: 'post', pdfUrl });
    const mail = await angebotsMail(brand, r.angebot, r.angebot.empfaenger!);
    const ok = await sendEmail({
      to: r.angebot.empfaenger!.email, subject: mail.betreff, text: mail.text,
      attachments: r.pdf ? [{ filename: `${r.angebot.number}.pdf`, content: r.pdf }] : [],
    });
    if (!ok) {
      locals.requestLogger.error({ number: r.angebot.number }, '[angebote] E-Mail-Versand fehlgeschlagen');
      return json(502, { error: `Angebot ${r.angebot.number} ist nummeriert, aber die E-Mail ging nicht hinaus. Bitte das PDF herunterladen und selbst senden.`, pdfUrl });
    }
    return json(200, { ok: true, number: r.angebot.number, versand: 'email' });
  }

  const form = await request.formData();
  const text = (k: string) => String(form.get(k) ?? '');
  const aktion = text('aktion');
  const uuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

  if (aktion === 'erstellen') {
    const klient = await getKlient(text('klientId'));
    if (!klient || !uuid(text('auftragId'))) return new Response('Nicht gefunden', { status: 404 });
    const r = await erstelleAngebotsentwurf(brand, klient, text('auftragId'));
    if (!r.ok) return redirect(`/admin/klienten/${klient.id}?auftragFehler=${encodeURIComponent(r.fehler)}#auftraege`, 303);
    return redirect(`/admin/angebote/${r.id}`, 303);
  }

  const id = text('id');
  const a = id ? await holeAngebot(brand, id) : null;
  if (!a) return new Response('Angebot nicht gefunden', { status: 404 });

  if (aktion === 'verwerfen') {
    const ok = await verwirfAngebot(brand, a.id);
    return redirect(ok ? `/admin/klienten/${a.klientId}?gespeichert=1#auftraege` : `/admin/angebote/${a.id}?fehler=${encodeURIComponent('Nur Entwürfe lassen sich verwerfen.')}`, 303);
  }
  if (aktion === 'neue_fassung') {
    const r = await neueFassung(brand, a.id);
    return redirect(r.ok ? `/admin/angebote/${r.id}` : `/admin/angebote/${a.id}?fehler=${encodeURIComponent(r.fehler)}`, 303);
  }
  return new Response('Unbekannte Aktion', { status: 400 });
};
