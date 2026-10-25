// Nachtrag Stufe 4 (K100, 24.10.2026): Angebots-E-Mail wie Rechnungs-E-Mail. Das Angebot wird erst
// nummeriert und gesperrt, dann sieht Gerald Empfänger, Absender, Betreff, Text und Anhang und kann sie für
// diese eine Mail ändern. Ein verschicktes Angebot lässt sich jederzeit (erneut) per E-Mail senden.
import { pool } from './website-db';
import { sendEmailMitGrund, absenderAnzeige } from './email';
import { holeAngebot } from './billing-angebot';
import { angebotsMail, erzeugeAngebotsPdf } from './billing-angebot-pdf';
import { hatEchteEmail } from './billing-versand';
import type { MailVorschlag, MailErgebnis } from './billing-mail';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Die Vorlage kann „{{gross_amount}} €“ schreiben, der Betrag bringt sein € schon mit.
const ohneDoppelEuro = (t: string) => t.replace(/€\s*€/g, '€');

export async function angebotMailVorschlag(brand: string, id: string): Promise<MailVorschlag | null> {
  const a = await holeAngebot(brand, id);
  // Prüfung D1: nur die aktuelle, noch unbeantwortete Fassung.
  if (!a || a.status !== 'verschickt' || !a.empfaenger) return null;
  const [m, von] = await Promise.all([angebotsMail(brand, a, a.empfaenger), absenderAnzeige()]);
  return {
    an: hatEchteEmail(a.empfaenger.email) ? a.empfaenger.email : '',
    von, betreff: ohneDoppelEuro(m.betreff), text: ohneDoppelEuro(m.text), anhaenge: [`${a.number}.pdf`], nummer: a.number,
  };
}

/** Sendet das nummerierte Angebot (gespeichertes PDF) mit Geralds Text. */
export async function sendeAngebotsMail(
  brand: string, id: string, m: { an: string; betreff: string; text: string },
): Promise<MailErgebnis & { nummer?: string }> {
  const an = (m.an ?? '').trim();
  if (!EMAIL_RE.test(an) || !hatEchteEmail(an)) return { ok: false, status: 400, fehler: 'Bitte eine gültige E-Mail-Adresse als Empfänger eintragen.' };
  if (!(m.betreff ?? '').trim()) return { ok: false, status: 400, fehler: 'Bitte einen Betreff eintragen.' };
  if (!(m.text ?? '').trim()) return { ok: false, status: 400, fehler: 'Bitte einen Text eintragen.' };
  const a = await holeAngebot(brand, id);
  if (!a) return { ok: false, status: 404, fehler: 'Angebot nicht gefunden.' };
  if (a.status === 'entwurf' || !a.empfaenger) return { ok: false, status: 409, fehler: 'Das Angebot ist noch ein Entwurf. Bitte zuerst nummerieren.' };
  if (a.status !== 'verschickt') return { ok: false, status: 409, fehler: 'Diese Fassung ist ersetzt oder schon beantwortet und wird nicht mehr verschickt.' };
  let pdf: Buffer | null = (await pool.query('SELECT pdf FROM billing_quotes WHERE id = $1', [id])).rows[0]?.pdf ?? null;
  if (!pdf) {
    pdf = await erzeugeAngebotsPdf(brand, a, a.positionen, a.empfaenger);
    await pool.query('UPDATE billing_quotes SET pdf = $2 WHERE id = $1 AND pdf IS NULL', [id, pdf]);
  }
  const gesendet = await sendEmailMitGrund({
    to: an, subject: m.betreff.trim(), text: m.text, attachments: [{ filename: `${a.number}.pdf`, content: pdf }],
  });
  if (!gesendet.ok) {
    return { ok: false, status: 502, fehler: `${gesendet.grund} Das Angebot ${a.number} bleibt nummeriert – bitte später erneut senden oder das PDF selbst verschicken. (Server: ${gesendet.detail})` };
  }
  // Prüfung D3: der erste Versand bleibt maßgeblich (Antwortdatum, Versandweg); weitere stehen im Protokoll.
  await pool.query(`UPDATE billing_quotes SET versandweg = COALESCE(versandweg, 'email'), versendet_am = COALESCE(versendet_am, now()) WHERE id = $1`, [id]);
  return { ok: true, nummer: a.number };
}
