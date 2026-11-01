// K163–K165 (Handtest 01.11.2026, H41–H43): Mahnungen prüfen und richtig verschicken.
// Vorher ging per E-Mail nur eine Text-Tabelle raus (Betrag, Gebühr, Zinsen) – ohne Anschreiben, Frist
// und Anhang. Jetzt: Mahnschreiben je Stufe aus Einstellungen → Rechnungstexte (Ich-Form), feste Frist
// als Datum, Mail mit Mahnschreiben-PDF und Rechnung im Anhang; ohne E-Mail PDF und Vermerk „per Post“.
// Verschickt wird nur über die Prüfseite /admin/mahnungen/[id].
import { pool, initBillingTables } from './website-db';
import { getInvoice, getCustomerById } from './native-billing';
import { alsKunde, leseEmpfaenger } from './billing-empfaenger';
import { buildDunningPdf } from './invoice-dunning';
import { ladeRechnungstexte } from './billing-rechnungstexte';
import { ladeAbsender } from './billing-absender';
import { ladeMahnEinstellungen, fristDatum, stufenName } from './mahn-einstellungen';
import { vorschlagEmpfaenger, type MailErgebnis } from './billing-mail';
import { sendEmailMitGrund, absenderAnzeige } from './email';
import { hatEchteEmail } from './billing-versand';
import { logBillingEvent } from './billing-audit';
import { archiveBillingPdf } from './billing-archive';
import { mahnungsDateiname, rechnungsDateiname } from './beleg-dateiname';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const euro = (n: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
const datumDe = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('.') : '–');
const iso = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });

let spaltenBereit: Promise<void> | null = null;
/** Versandweg und Frist am Mahnungs-Datensatz festhalten (neu, 01.11.2026). */
function ensureSpalten(): Promise<void> {
  spaltenBereit ??= (async () => {
    await initBillingTables();
    await pool.query(`ALTER TABLE billing_invoice_dunnings ADD COLUMN IF NOT EXISTS versandweg TEXT;
      ALTER TABLE billing_invoice_dunnings ADD COLUMN IF NOT EXISTS frist DATE;
      ALTER TABLE billing_invoice_dunnings ADD COLUMN IF NOT EXISTS sperre_am TIMESTAMPTZ;`);
  })().catch((err) => { spaltenBereit = null; throw err; });
  return spaltenBereit;
}

export interface Mahnung {
  id: string; invoiceId: string; rechnungsnummer: string; stufe: number; stufenName: string;
  offen: number; gebuehr: number; zinsen: number; gesamt: number;
  /** G10 (Gerald 01.11.2026): Gebühren der früheren, verschickten Stufen werden aufaddiert. */
  fruehereGebuehren: number;
  /** G8: jetzt noch offener Betrag der Rechnung – weicht er ab, warnt die Prüfseite. */
  offenJetzt: number;
  rechnungsdatum: string; faellig: string; erzeugtAm: string;
  versendetAm: string | null; versandweg: string | null; frist: string | null; versendetVon: string | null;
  klientId: string | null; klientName: string; empfaengerName: string; empfaengerEmail: string | null;
  /** Prüfung G4: Anschrift wie auf der Rechnung (Kopie beim Festschreiben). */
  empfaengerAnschrift: string;
  rechnungStorniert: boolean;
  /** Inzwischen bezahlt – dann nicht mehr mahnen. */
  rechnungBezahlt: boolean;
}

const SPALTEN = `d.id, d.invoice_id, d.level, d.fee_amount, d.interest_amount, d.outstanding_at_generation,
  d.generated_at, d.sent_at, d.sent_by, d.versandweg, d.frist::text AS frist,
  i.number, i.issue_date::text AS issue_date, i.due_date::text AS due_date, i.status AS rechnung_status,
  i.klient_id::text AS klient_id,
  COALESCE(i.empfaenger->>'company', i.empfaenger->>'name', c.name) AS empfaenger_name,
  COALESCE(i.empfaenger->>'email', c.email) AS empfaenger_email,
  CONCAT_WS(', ', COALESCE(i.empfaenger->>'addressLine1', c.address_line1),
    NULLIF(CONCAT_WS(' ', COALESCE(i.empfaenger->>'postalCode', c.postal_code), COALESCE(i.empfaenger->>'city', c.city)), '')) AS empfaenger_anschrift,
  (SELECT k.name FROM customers k WHERE k.id = i.klient_id) AS klient_name,
  (SELECT COALESCE(SUM(p.fee_amount), 0) FROM billing_invoice_dunnings p
    WHERE p.invoice_id = d.invoice_id AND p.level < d.level AND p.sent_at IS NOT NULL) AS fruehere_gebuehren,
  (SELECT v.gross_amount - COALESCE(v.paid_amount, 0) FROM v_billing_invoices_with_state v WHERE v.id = d.invoice_id) AS offen_jetzt`;

function zeileZuMahnung(r: Record<string, unknown>): Mahnung {
  const offen = Number(r.outstanding_at_generation), gebuehr = Number(r.fee_amount), zinsen = Number(r.interest_amount);
  const fruehereGebuehren = Number(r.fruehere_gebuehren ?? 0);
  return {
    id: String(r.id), invoiceId: String(r.invoice_id), rechnungsnummer: String(r.number), stufe: Number(r.level),
    stufenName: stufenName(Number(r.level)), offen, gebuehr, zinsen, fruehereGebuehren,
    gesamt: Math.round((offen + gebuehr + fruehereGebuehren + zinsen) * 100) / 100,
    offenJetzt: r.offen_jetzt == null ? offen : Math.round(Number(r.offen_jetzt) * 100) / 100,
    rechnungsdatum: String(r.issue_date ?? ''), faellig: String(r.due_date ?? ''),
    erzeugtAm: r.generated_at ? new Date(r.generated_at as string).toISOString() : '',
    versendetAm: r.sent_at ? new Date(r.sent_at as string).toISOString() : null,
    versandweg: (r.versandweg as string | null) ?? (r.sent_at ? (String(r.sent_by ?? '').includes('(Post)') ? 'post' : 'email') : null),
    frist: (r.frist as string | null) ?? null, versendetVon: (r.sent_by as string | null) ?? null,
    klientId: (r.klient_id as string | null) ?? null, klientName: String(r.klient_name ?? r.empfaenger_name ?? ''),
    empfaengerName: String(r.empfaenger_name ?? ''), empfaengerEmail: (r.empfaenger_email as string | null) ?? null,
    empfaengerAnschrift: String(r.empfaenger_anschrift ?? ''),
    rechnungStorniert: r.rechnung_status === 'cancelled',
    rechnungBezahlt: r.rechnung_status === 'paid',
  };
}

/** K163: alle Mahnungen – zu versenden (älteste zuerst) und verschickt (neueste zuerst). */
export async function listeMahnungen(brand: string): Promise<{ offen: Mahnung[]; verschickt: Mahnung[] }> {
  await ensureSpalten();
  const { rows } = await pool.query(
    `SELECT ${SPALTEN} FROM billing_invoice_dunnings d
       JOIN billing_invoices i ON i.id = d.invoice_id JOIN billing_customers c ON c.id = i.customer_id
      WHERE d.brand = $1 ORDER BY d.generated_at`, [brand]);
  const alle = rows.map(zeileZuMahnung);
  return {
    offen: alle.filter((m) => !m.versendetAm && !m.rechnungStorniert && !m.rechnungBezahlt),
    verschickt: alle.filter((m) => m.versendetAm).reverse(),
  };
}

export async function holeMahnung(brand: string, id: string): Promise<Mahnung | null> {
  await ensureSpalten();
  const { rows } = await pool.query(
    `SELECT ${SPALTEN} FROM billing_invoice_dunnings d
       JOIN billing_invoices i ON i.id = d.invoice_id JOIN billing_customers c ON c.id = i.customer_id
      WHERE d.brand = $1 AND d.id = $2`, [brand, id]);
  return rows[0] ? zeileZuMahnung(rows[0]) : null;
}

/** Platzhalter für Stufentext, Betreff und Mail. Frist: gespeichert (verschickt) oder ab heute. */
async function platzhalter(brand: string, m: Mahnung): Promise<Record<string, string>> {
  const [einst, absender, vorige] = await Promise.all([
    ladeMahnEinstellungen(brand), ladeAbsender(brand),
    pool.query(`SELECT sent_at FROM billing_invoice_dunnings WHERE invoice_id = $1 AND level = $2 AND sent_at IS NOT NULL`, [m.invoiceId, m.stufe - 1]),
  ]);
  const v = vorige.rows[0];
  const frist = m.frist ?? fristDatum(einst, m.versendetAm ? new Date(m.versendetAm) : new Date());
  return {
    number: m.rechnungsnummer, issue_date: datumDe(m.rechnungsdatum), due_date: datumDe(m.faellig),
    gross_amount: euro(m.offen), offen: euro(m.offen), gebuehr: euro(m.gebuehr + m.fruehereGebuehren), gesamt: euro(m.gesamt),
    frist: datumDe(frist), frist_iso: frist,
    vorige_mahnung: v ? datumDe(iso(new Date(v.sent_at))) : '–',
    titel: m.stufenName, titel_klein: m.stufe === 1 ? 'eine Zahlungserinnerung' : m.stufe === 2 ? 'die 1. Mahnung' : 'die letzte Mahnung',
    customer_name: m.empfaengerName, seller_name: absender.name,
  };
}

const ersetze = (t: string, w: Record<string, string>) => t.replace(/\{\{(\w+)\}\}/g, (_, k: string) => w[k] ?? '');

/** K165: das Mahnschreiben als PDF (Stufentext aus den Einstellungen, feste Frist). */
export async function mahnschreibenPdf(brand: string, id: string): Promise<{ pdf: Buffer; dateiname: string } | null> {
  const m = await holeMahnung(brand, id);
  if (!m) return null;
  const r = (await pool.query(
    `SELECT i.customer_id, i.empfaenger, (SELECT c.customer_number FROM customers c WHERE c.id = i.klient_id) AS kundennummer
       FROM billing_invoices i WHERE i.id = $1`, [m.invoiceId])).rows[0];
  const invoice = await getInvoice(m.invoiceId);
  const rechnungskunde = r ? await getCustomerById(brand, r.customer_id as string) : null;
  if (!invoice || !rechnungskunde) return null;
  const kopie = leseEmpfaenger(r.empfaenger);
  const customer = kopie ? alsKunde(rechnungskunde, kopie) : rechnungskunde;
  const [texte, w] = await Promise.all([ladeRechnungstexte(brand), platzhalter(brand, m)]);
  const vorlage = m.stufe <= 1 ? texte.mahnung_text_1 : m.stufe === 2 ? texte.mahnung_text_2 : texte.mahnung_text_3;
  const datum = m.versendetAm ? new Date(m.versendetAm) : new Date();
  const pdf = await buildDunningPdf({
    brand, invoice, customer, kundennummer: r.kundennummer, level: m.stufe, outstanding: m.offen,
    feeAmount: m.gebuehr + m.fruehereGebuehren, interestAmount: m.zinsen, haupttext: ersetze(vorlage, w), frist: w.frist_iso, datum,
  });
  return {
    pdf,
    dateiname: mahnungsDateiname({
      stufe: m.stufe, datum, rechnungsnummer: m.rechnungsnummer, rechnungsdatum: m.rechnungsdatum,
      kundennummer: r.kundennummer, empfaenger: customer,
    }),
  };
}

export interface MahnMailVorschlag {
  an: string; anQuelle: 'akte' | 'beleg' | null; von: string; betreff: string; text: string; anhaenge: string[]; frist: string;
}

/** K164: Vorschlag für das Mail-Fenster der Prüfseite. */
export async function mahnMailVorschlag(brand: string, id: string): Promise<MahnMailVorschlag | null> {
  const m = await holeMahnung(brand, id);
  if (!m) return null;
  const [texte, w, empf, von, schreiben] = await Promise.all([
    ladeRechnungstexte(brand), platzhalter(brand, m), vorschlagEmpfaenger(m.klientId, m.empfaengerEmail),
    absenderAnzeige(), mahnschreibenPdf(brand, id),
  ]);
  const rechnungName = (await rechnungsDateiname(m.invoiceId).catch(() => null)) ?? `${m.rechnungsnummer}.pdf`;
  const hatRechnungPdf = (await pool.query(
    `SELECT 1 FROM billing_invoice_documents WHERE invoice_id = $1 AND format = 'pdf' LIMIT 1`, [m.invoiceId])).rows.length;
  return {
    an: empf.an, anQuelle: empf.anQuelle, von,
    betreff: ersetze(texte.mahnung_email_subject || '{{titel}} zur Rechnung {{number}}', w),
    text: ersetze(texte.mahnung_email_body, w),
    anhaenge: [schreiben?.dateiname ?? 'Mahnung.pdf', ...(hatRechnungPdf > 0 ? [rechnungName] : [])], frist: w.frist,
  };
}

async function vermerkeVersand(brand: string, m: Mahnung, weg: 'email' | 'post', wer: string | undefined, an?: string,
  schreiben?: { pdf: Buffer; dateiname: string } | null): Promise<boolean> {
  const einst = await ladeMahnEinstellungen(brand);
  const frist = fristDatum(einst, new Date());
  // Prüfung G11: nur vermerken, wenn die Mahnung noch nicht verschickt ist (zwei Tabs, Mail und Post zugleich).
  const vermerkt = await pool.query(
    `UPDATE billing_invoice_dunnings SET sent_at = now(), sent_by = $2, versandweg = $3, frist = $4, sperre_am = NULL
      WHERE id = $1 AND sent_at IS NULL`,
    [m.id, weg === 'post' ? `${wer ?? 'admin'} (Post)` : (wer ?? 'admin'), weg, frist]);
  if ((vermerkt.rowCount ?? 0) === 0) return false;
  // Prüfung G5: das tatsächlich verschickte Schreiben ablegen (Aufbewahrung), nicht das beim Mahnlauf erzeugte.
  const pfad = schreiben
    ? await archiveBillingPdf({ brand, invoiceNumber: m.rechnungsnummer, filename: schreiben.dateiname, content: schreiben.pdf }).catch(() => null)
    : null;
  if (pfad) await pool.query(`UPDATE billing_invoice_dunnings SET pdf_path = $2 WHERE id = $1`, [m.id, pfad]);
  // Prüfung G7: ein Eintrag (Rechnungsprotokoll; erscheint auch im Änderungsprotokoll).
  await logBillingEvent({ invoiceId: m.invoiceId, action: 'dunning_sent',
    reason: `${m.stufenName} per ${weg === 'post' ? 'Post' : 'E-Mail'}, Gesamt ${euro(m.gesamt)}, zahlbar bis ${datumDe(frist)}`,
    actor: { email: wer }, metadata: { dunningId: m.id, sentBy: wer, weg, an, frist } }).catch(() => {});
  return true;
}

/** Prüfung G9/G11/G12: Sperre gegen doppelten Versand (Mail und Post); verfällt nach 10 Minuten, falls ein Versand abbricht. */
async function sperre(id: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE billing_invoice_dunnings SET versandweg = 'sendet', sperre_am = now()
      WHERE id = $1 AND sent_at IS NULL
        AND (versandweg IS DISTINCT FROM 'sendet' OR sperre_am IS NULL OR sperre_am < now() - interval '10 minutes')`, [id]);
  return (r.rowCount ?? 0) > 0;
}

const entsperre = (id: string) =>
  pool.query(`UPDATE billing_invoice_dunnings SET versandweg = NULL, sperre_am = NULL WHERE id = $1 AND sent_at IS NULL`, [id]);

const GESPERRT = 'Diese Mahnung wird gerade verschickt oder ist schon verschickt. Bitte die Seite neu laden.';

/** K164/K165: per E-Mail mit Mahnschreiben und Rechnung im Anhang. */
export async function sendeMahnungPerMail(
  brand: string, id: string, mail: { an: string; betreff: string; text: string }, wer?: string,
): Promise<MailErgebnis> {
  const an = (mail.an ?? '').trim();
  if (!EMAIL_RE.test(an) || !hatEchteEmail(an)) return { ok: false, status: 400, fehler: 'Bitte eine gültige E-Mail-Adresse als Empfänger eintragen.' };
  if (!(mail.betreff ?? '').trim()) return { ok: false, status: 400, fehler: 'Bitte einen Betreff eintragen.' };
  if (!(mail.text ?? '').trim()) return { ok: false, status: 400, fehler: 'Bitte einen Text eintragen.' };
  const m = await holeMahnung(brand, id);
  if (!m) return { ok: false, status: 404, fehler: 'Mahnung nicht gefunden.' };
  if (m.versendetAm) return { ok: false, status: 409, fehler: 'Diese Mahnung ist schon verschickt.' };
  if (m.rechnungStorniert) return { ok: false, status: 409, fehler: 'Die Rechnung ist storniert – nicht mehr mahnen.' };
  if (m.rechnungBezahlt) return { ok: false, status: 409, fehler: 'Die Rechnung ist inzwischen bezahlt – nicht mehr mahnen.' };
  const schreiben = await mahnschreibenPdf(brand, id);
  if (!schreiben) return { ok: false, status: 500, fehler: 'Das Mahnschreiben konnte nicht erzeugt werden.' };
  const rechnungPdf = (await pool.query(
    `SELECT content FROM billing_invoice_documents WHERE invoice_id = $1 AND format = 'pdf' LIMIT 1`, [m.invoiceId])).rows[0]?.content as Buffer | undefined;
  // Prüfung G2: nicht still mit nur einem Anhang verschicken.
  if (!rechnungPdf) return { ok: false, status: 409, fehler: 'Zur Rechnung ist kein PDF gespeichert – bitte die Rechnung einmal öffnen und „PDF herunterladen“ prüfen oder per Post mahnen.' };
  // Prüfung G9: gegen Doppelklick sperren, bevor die Mail rausgeht.
  if (!(await sperre(id))) return { ok: false, status: 409, fehler: GESPERRT };
  const rechnungName = (await rechnungsDateiname(m.invoiceId).catch(() => null)) ?? `${m.rechnungsnummer}.pdf`;
  const gesendet = await sendEmailMitGrund({
    to: an, subject: mail.betreff.trim(), text: mail.text,
    attachments: [
      { filename: schreiben.dateiname, content: schreiben.pdf },
      { filename: rechnungName, content: rechnungPdf },
    ],
  });
  if (!gesendet.ok) {
    await entsperre(id);
    return { ok: false, status: 502, fehler: `${gesendet.grund} Die Mahnung ist nicht verschickt. (Server: ${gesendet.detail})` };
  }
  await vermerkeVersand(brand, m, 'email', wer, an, schreiben);
  return { ok: true };
}

/** Prüfung G14: nach einer Teilzahlung den offenen Betrag einer noch nicht verschickten Mahnung auf den Stand von jetzt setzen. */
export async function aktualisiereMahnBetrag(brand: string, id: string, wer?: string): Promise<MailErgebnis> {
  const m = await holeMahnung(brand, id);
  if (!m) return { ok: false, status: 404, fehler: 'Mahnung nicht gefunden.' };
  if (m.versendetAm) return { ok: false, status: 409, fehler: 'Diese Mahnung ist schon verschickt – der Betrag bleibt.' };
  if (m.offenJetzt <= 0) return { ok: false, status: 409, fehler: 'Die Rechnung ist inzwischen ganz bezahlt – nicht mehr mahnen.' };
  if (Math.abs(m.offenJetzt - m.offen) < 0.005) return { ok: true };
  const r = await pool.query(
    `UPDATE billing_invoice_dunnings SET outstanding_at_generation = $2 WHERE id = $1 AND brand = $3 AND sent_at IS NULL
        AND (versandweg IS DISTINCT FROM 'sendet' OR sperre_am < now() - interval '10 minutes')`,
    [id, m.offenJetzt, brand]);
  if ((r.rowCount ?? 0) === 0) return { ok: false, status: 409, fehler: GESPERRT };
  await logBillingEvent({ invoiceId: m.invoiceId, action: 'dunning_amount_updated',
    reason: `${m.stufenName}: offener Betrag nach Teilzahlung von ${euro(m.offen)} auf ${euro(m.offenJetzt)} gesetzt`,
    actor: { email: wer }, metadata: { dunningId: m.id, vorher: m.offen, nachher: m.offenJetzt } }).catch(() => {});
  return { ok: true };
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * N32 (Gerald 01.11.2026): unverschickte Mahnung verwerfen. Die Mahnung wird entfernt (sie ging nie raus; der ganze
 * Datensatz steht im Rechnungsprotokoll), die Rechnung bekommt ihren Status von vor dem Mahnlauf zurück und wird bis
 * `bis` nicht gemahnt. Danach legt der Mahnlauf dieselbe Stufe mit dem dann offenen Betrag neu an.
 */
export async function verwirfMahnung(
  brand: string, id: string, eingabe: { bis: string; grund: string }, wer?: string,
): Promise<MailErgebnis> {
  const bis = (eingabe.bis ?? '').trim();
  const grund = (eingabe.grund ?? '').trim();
  // Prüfung G19: streng prüfen – „2027-02-31“ läse JavaScript sonst als 03.03.
  if (!ISO_RE.test(bis) || Number.isNaN(new Date(`${bis}T00:00:00Z`).getTime())
    || !new Date(`${bis}T00:00:00Z`).toISOString().startsWith(bis)) return { ok: false, status: 400, fehler: 'Bitte ein Datum für die Mahnpause wählen.' };
  if (bis < iso(new Date())) return { ok: false, status: 400, fehler: 'Die Mahnpause darf nicht in der Vergangenheit enden.' };
  if (!grund) return { ok: false, status: 400, fehler: 'Bitte kurz den Grund eintragen (steht im Protokoll).' };
  const m = await holeMahnung(brand, id);
  if (!m) return { ok: false, status: 404, fehler: 'Mahnung nicht gefunden.' };
  if (m.versendetAm) return { ok: false, status: 409, fehler: 'Diese Mahnung ist schon verschickt und kann nicht mehr verworfen werden.' };
  // Statusrücksprung: so, wie die Rechnung vor dem Anlegen dieser Stufe stand.
  const vorher = (await pool.query(
    `SELECT from_status FROM billing_audit_log WHERE invoice_id = $1 AND action = 'dunning_generated' AND to_status = $2
      ORDER BY id DESC LIMIT 1`, [m.invoiceId, `dunning_${m.stufe}`])).rows[0]?.from_status as string | undefined;
  const zurueck = vorher ?? (m.stufe > 1 ? `dunning_${m.stufe - 1}` : 'open');
  // Prüfung G19: Löschen, Statusrücksprung, Pause und Protokoll ganz oder gar nicht.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const geloescht = await client.query(
      `DELETE FROM billing_invoice_dunnings WHERE id = $1 AND brand = $2 AND sent_at IS NULL
          AND (versandweg IS DISTINCT FROM 'sendet' OR sperre_am < now() - interval '10 minutes')
        RETURNING *`, [id, brand]);
    if (geloescht.rows.length === 0) { await client.query('ROLLBACK'); return { ok: false, status: 409, fehler: GESPERRT }; }
    await client.query(`UPDATE billing_invoices SET status = $2, updated_at = now() WHERE id = $1 AND status = $3`,
      [m.invoiceId, zurueck, `dunning_${m.stufe}`]);
    await client.query(
      `INSERT INTO billing_mahnpausen (invoice_id, bis, grund, gesetzt_von) VALUES ($1, $2, $3, $4)
       ON CONFLICT (invoice_id) DO UPDATE SET bis = EXCLUDED.bis, grund = EXCLUDED.grund, gesetzt_von = EXCLUDED.gesetzt_von, gesetzt_am = now()`,
      [m.invoiceId, bis, grund, wer ?? 'admin']);
    await client.query(
      `INSERT INTO billing_audit_log (invoice_id, action, actor_email, from_status, to_status, reason, metadata)
       VALUES ($1, 'dunning_discarded', $2, $3, $4, $5, $6)`,
      [m.invoiceId, wer ?? null, `dunning_${m.stufe}`, zurueck, `${m.stufenName} verworfen, Mahnpause bis ${datumDe(bis)}: ${grund}`,
        JSON.stringify({ mahnung: geloescht.rows[0], pauseBis: bis, grund })]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { ok: true };
}

export interface Mahnpause { invoiceId: string; rechnungsnummer: string; klientName: string; bis: string; grund: string }

/** N32: laufende Mahnpausen (für die Seite Mahnungen). */
export async function listeMahnpausen(brand: string): Promise<Mahnpause[]> {
  await ensureSpalten();
  const { rows } = await pool.query(
    `SELECT p.invoice_id, p.bis::text AS bis, p.grund, i.number,
            COALESCE((SELECT k.name FROM customers k WHERE k.id = i.klient_id), i.empfaenger->>'name', '') AS klient_name
       FROM billing_mahnpausen p JOIN billing_invoices i ON i.id = p.invoice_id
      WHERE i.brand = $1 AND p.bis >= $2::date AND i.status NOT IN ('paid','cancelled')
      ORDER BY p.bis`, [brand, iso(new Date())]);
  return rows.map((r) => ({ invoiceId: String(r.invoice_id), rechnungsnummer: String(r.number), klientName: String(r.klient_name ?? ''),
    bis: String(r.bis), grund: String(r.grund ?? '') }));
}

/** K164: ohne E-Mail – Versand per Post vermerken; das PDF lädt die Seite zum Drucken. */
export async function vermerkeMahnungPerPost(brand: string, id: string, wer?: string): Promise<MailErgebnis> {
  const m = await holeMahnung(brand, id);
  if (!m) return { ok: false, status: 404, fehler: 'Mahnung nicht gefunden.' };
  if (m.versendetAm) return { ok: false, status: 409, fehler: 'Diese Mahnung ist schon verschickt.' };
  if (m.rechnungStorniert) return { ok: false, status: 409, fehler: 'Die Rechnung ist storniert – nicht mehr mahnen.' };
  if (m.rechnungBezahlt) return { ok: false, status: 409, fehler: 'Die Rechnung ist inzwischen bezahlt – nicht mehr mahnen.' };
  if (!(await sperre(id))) return { ok: false, status: 409, fehler: GESPERRT };
  const schreiben = await mahnschreibenPdf(brand, id).catch(() => null);
  if (!(await vermerkeVersand(brand, m, 'post', wer, undefined, schreiben))) return { ok: false, status: 409, fehler: GESPERRT };
  return { ok: true };
}
