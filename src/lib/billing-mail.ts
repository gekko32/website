// Handtest 23.10.2026: Rechnungs-E-Mail getrennt vom Festschreiben. Vor dem Versand sieht Gerald
// Empfänger, Absender, Betreff, Text und Anhänge und kann sie für diese eine Mail ändern. Eine
// festgeschriebene Rechnung lässt sich jederzeit (auch erneut, auch nach „Post“) per E-Mail senden;
// an der Rechnung selbst ändert das nichts.
import { pool } from './website-db';
import { sendEmailMitGrund, absenderAnzeige } from './email';
import { ladeRechnungstexte } from './billing-rechnungstexte';
import { ladeAbsender } from './billing-absender';
import { empfaengerDerRechnung, kaeuferName } from './billing-empfaenger';
import { hatEchteEmail } from './billing-versand';
import { logBillingEvent } from './billing-audit';
import { rechnungsDateiname } from './beleg-dateiname';
import { getKlient, rechnungsempfaenger } from './klientenakte';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface MailVorschlag {
  an: string; von: string; betreff: string; text: string; anhaenge: string[]; nummer: string;
  /** K151: woher der Vorschlag „An“ stammt – aktuelle Akte oder der beim Festschreiben gespeicherte Empfänger. */
  anQuelle?: 'akte' | 'beleg' | null;
}

/**
 * K151 (Handtest 30.10.2026, H24): Die E-Mail-Adresse steht nicht auf dem Beleg, sie ist nur der Versandweg –
 * deshalb zuerst die aktuelle Adresse aus der Akte (Rechnungs-E-Mail, sonst E-Mail des Klienten), sonst die
 * beim Festschreiben gespeicherte. Anschrift und Name auf dem Beleg bleiben unberührt (GoBD).
 */
export async function vorschlagEmpfaenger(
  klientId: string | null | undefined, gespeichert: string | null | undefined,
): Promise<{ an: string; anQuelle: 'akte' | 'beleg' | null }> {
  const klient = klientId ? await getKlient(klientId).catch(() => null) : null;
  const ausAkte = klient ? rechnungsempfaenger(klient).email : null;
  if (ausAkte && hatEchteEmail(ausAkte)) return { an: ausAkte, anQuelle: 'akte' };
  if (gespeichert && hatEchteEmail(gespeichert)) return { an: gespeichert, anQuelle: 'beleg' };
  return { an: '', anQuelle: null };
}

// Handtest 23.10.2026: Die Vorlage schreibt „{{gross_amount}} €“, der Betrag bringt sein € schon mit → kein „€ €“.
const ersetze = (t: string, vars: Record<string, string>) =>
  t.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '').replace(/€\s*€/g, '€');
const datumDe = (d: unknown) => {
  const s = d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d ?? '').slice(0, 10);
  return s.split('-').reverse().join('.');
};

/** Vorschlag aus Einstellungen → Rechnungstexte, mit den Daten der festgeschriebenen Rechnung. */
export async function rechnungsMailVorschlag(brand: string, invoiceId: string): Promise<MailVorschlag | null> {
  const r = (await pool.query(
    `SELECT number, status, gross_amount, due_date, payment_reference, leitweg_id, klient_id::text AS klient_id FROM billing_invoices WHERE id = $1 AND brand = $2`,
    [invoiceId, brand])).rows[0];
  if (!r || r.status === 'draft') return null;
  const [texte, absender, empfaenger, von] = await Promise.all([ladeRechnungstexte(brand), ladeAbsender(brand), empfaengerDerRechnung(invoiceId), absenderAnzeige()]);
  const vars = {
    number: r.number as string,
    gross_amount: Number(r.gross_amount).toFixed(2).replace('.', ',') + ' €',
    due_date: datumDe(r.due_date),
    payment_reference: (r.payment_reference as string | null) ?? (r.number as string),
    customer_name: empfaenger ? (empfaenger.company ? empfaenger.name : kaeuferName(empfaenger)) : '',
    seller_name: absender.name,
  };
  const empf = await vorschlagEmpfaenger(r.klient_id as string | null, empfaenger?.email);
  return {
    an: empf.an, anQuelle: empf.anQuelle,
    von,
    betreff: ersetze(texte.invoice_email_subject || 'Rechnung {{number}}', vars),
    text: ersetze(texte.invoice_email_body, vars),
    anhaenge: anhangNamen((await rechnungsDateiname(invoiceId)) ?? `${r.number}.pdf`, Boolean(r.leitweg_id)),
    nummer: r.number as string,
  };
}

/** Prüfung N8: XRechnung heißt wie die PDF, nur mit .xml – ein Name, eine Abfrage. */
const anhangNamen = (pdf: string, mitXml: boolean) => [pdf, ...(mitXml ? [pdf.replace(/\.pdf$/, '.xml')] : [])];

export type MailErgebnis = { ok: true } | { ok: false; status: number; fehler: string };

/** Sendet die festgeschriebene Rechnung (gespeichertes PDF, ggf. XRechnung) mit Geralds Text. */
export async function sendeRechnungsMail(
  brand: string, invoiceId: string, m: { an: string; betreff: string; text: string }, wer?: string,
): Promise<MailErgebnis> {
  const an = (m.an ?? '').trim();
  if (!EMAIL_RE.test(an) || !hatEchteEmail(an)) return { ok: false, status: 400, fehler: 'Bitte eine gültige E-Mail-Adresse als Empfänger eintragen.' };
  if (!(m.betreff ?? '').trim()) return { ok: false, status: 400, fehler: 'Bitte einen Betreff eintragen.' };
  if (!(m.text ?? '').trim()) return { ok: false, status: 400, fehler: 'Bitte einen Text eintragen.' };
  const r = (await pool.query(`SELECT number, status, leitweg_id FROM billing_invoices WHERE id = $1 AND brand = $2`, [invoiceId, brand])).rows[0];
  if (!r) return { ok: false, status: 404, fehler: 'Rechnung nicht gefunden.' };
  if (r.status === 'draft') return { ok: false, status: 409, fehler: 'Die Rechnung ist noch ein Entwurf. Bitte zuerst festschreiben.' };
  const docs = (await pool.query(
    `SELECT format, content FROM billing_invoice_documents WHERE invoice_id = $1 AND format IN ('pdf','xrechnung')`, [invoiceId])).rows;
  const pdf = docs.find((d: { format: string }) => d.format === 'pdf')?.content as Buffer | undefined;
  if (!pdf) return { ok: false, status: 409, fehler: 'Zu dieser Rechnung ist kein PDF gespeichert.' };
  const xr = docs.find((d: { format: string }) => d.format === 'xrechnung')?.content as Buffer | undefined;
  const [pdfName, xmlName] = anhangNamen((await rechnungsDateiname(invoiceId)) ?? `${r.number}.pdf`, true);
  const gesendet = await sendEmailMitGrund({
    to: an, subject: m.betreff.trim(), text: m.text,
    attachments: [
      { filename: pdfName, content: pdf },
      ...(r.leitweg_id && xr ? [{ filename: xmlName, content: xr }] : []),
    ],
  });
  if (!gesendet.ok) {
    return { ok: false, status: 502, fehler: `${gesendet.grund} Die Rechnung ${r.number} bleibt festgeschrieben – bitte später erneut senden oder das PDF selbst verschicken. (Server: ${gesendet.detail})` };
  }
  await pool.query('UPDATE billing_invoices SET versandweg = $2, versendet_am = now() WHERE id = $1', [invoiceId, 'email']);
  await logBillingEvent({ invoiceId, action: 'versand', actor: { email: wer }, metadata: { weg: 'email', an } }).catch(() => {});
  return { ok: true };
}
