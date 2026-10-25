// Sprechende Dateinamen (Gerald 24.10.2026, K117–K122): Aus dem Namen soll man im Explorer ablesen
// können, was die Datei ist, ohne sie zu öffnen.
//   JJJJMMTT_Art_Nummer_Kundennr_Name_Inhalt.pdf   (kein Betrag)
// Felder mit „_“, Wörter im Feld mit „-“, Umlaute ausgeschrieben, nur A–Z/0–9, höchstens 120 Zeichen.
// Gilt für Download, E-Mail-Anhang und Ablage gleichermaßen.
import { pool } from './website-db';
import { leseEmpfaenger, kundennummerVon } from './billing-empfaenger';
import type { Angebot } from './billing-angebot';

export const MAX_LAENGE = 120;

const UMLAUTE: Record<string, string> = {
  'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss', 'ẞ': 'SS',
  // zerfallen nicht in Grundbuchstabe + Akzent und gingen sonst verloren
  'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'ø': 'o', 'Ø': 'O', 'æ': 'ae', 'Æ': 'Ae', 'œ': 'oe', 'Œ': 'Oe', 'ı': 'i',
};

/** Ein Feld: Umlaute ausgeschrieben, Akzente weg, alles andere als „-“; nie „_“ im Feld. */
export function dateiTeil(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/[äöüÄÖÜßẞłŁđĐøØæÆœŒı]/g, (z) => UMLAUTE[z])
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Person „Anna Müller“ → „Mueller-Anna“ (sortiert nach Nachnamen); Firma → „Firma-zHd-Vorname-Nachname“. */
export function namensTeil(e: { name?: string | null; company?: string | null }): string {
  const person = (e.name ?? '').trim();
  const firma = (e.company ?? '').trim();
  if (firma) return dateiTeil(person && person !== firma ? `${firma} zHd ${person}` : firma);
  const w = person.split(/\s+/).filter(Boolean);
  return dateiTeil(w.length > 1 ? [w[w.length - 1], ...w.slice(0, -1)].join(' ') : person);
}

const MONATE = ['Jan', 'Feb', 'Maer', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const kompakt = (iso: string) => iso.slice(0, 10).replace(/-/g, '');

/** Leistungszeitraum: ein Tag → JJJJMMTT, ein ganzer Monat oder Teile davon → „Nov-2026“, sonst „von-bis“. */
export function zeitraumTeil(von?: string | null, bis?: string | null): string {
  const v = (von ?? '').slice(0, 10); const b = (bis ?? von ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b) || b === v) return kompakt(v);
  if (v.slice(0, 7) === b.slice(0, 7)) return `${MONATE[Number(v.slice(5, 7)) - 1]}-${v.slice(0, 4)}`;
  return `${kompakt(v)}-bis-${kompakt(b)}`;
}

export interface DateinameFelder {
  datum: string;            // JJJJ-MM-TT
  art: string;              // Rechnung, Gutschrift, Angebot, Zahlungserinnerung, Mahnung-1 …
  nummer: string;
  kundennummer?: string | null;
  name?: string;            // schon als namensTeil()
  inhalt?: string | null;
  endung?: string;
}

const kuerze = (s: string, n: number) => (n <= 0 ? '' : s.slice(0, n).replace(/-+$/, ''));

/** Baut den Namen; leere Felder entfallen. Zu lang → erst Inhalt, dann Name kürzen. */
export function belegDateiname(f: DateinameFelder): string {
  const endung = `.${f.endung ?? 'pdf'}`;
  const fest = [kompakt(f.datum), dateiTeil(f.art), dateiTeil(f.nummer), dateiTeil(f.kundennummer)].filter(Boolean);
  let name = dateiTeil(f.name);
  let inhalt = dateiTeil(f.inhalt);
  const laenge = () => [...fest, name, inhalt].filter(Boolean).join('_').length + endung.length;
  if (laenge() > MAX_LAENGE) inhalt = kuerze(inhalt, inhalt.length - (laenge() - MAX_LAENGE));
  if (laenge() > MAX_LAENGE) name = kuerze(name, name.length - (laenge() - MAX_LAENGE));
  return [...fest, name, inhalt].filter(Boolean).join('_') + endung;
}

/** Art des Schreibens zur Rechnungsart. */
export function rechnungsArt(kind: string | null | undefined): string {
  switch (kind) {
    case 'gutschrift': return 'Gutschrift';
    case 'prepayment': return 'Anzahlungsrechnung';
    case 'final': return 'Schlussrechnung';
    default: return 'Rechnung';
  }
}

/** Wie der Titel auf dem PDF: Stufe 1 Zahlungserinnerung, danach 1., 2. Mahnung. */
export const mahnungsArt = (stufe: number) => (stufe <= 1 ? 'Zahlungserinnerung' : `Mahnung-${stufe - 1}`);

// ── Datenbank ───────────────────────────────────────────────────────────────

type Abfrage = (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/**
 * Abfrage innerhalb einer offenen Transaktion: jede Abfrage hinter einem Sicherungspunkt, damit ein
 * Fehler beim Namen nie das Festschreiben abbricht.
 */
export function inTransaktion(client: { query: (s: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }): Abfrage {
  return async (sql, params) => {
    await client.query('SAVEPOINT beleg_dateiname');
    try {
      const r = await client.query(sql, params);
      await client.query('RELEASE SAVEPOINT beleg_dateiname');
      return r;
    } catch (e) {
      await client.query('ROLLBACK TO SAVEPOINT beleg_dateiname').catch(() => {});
      throw e;
    }
  };
}
const isoTag = (v: unknown): string =>
  v instanceof Date ? v.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }) : String(v ?? '').slice(0, 10);

/**
 * Dateiname einer Rechnung/Gutschrift aus der Datenbank. `abfrage` erlaubt die Abfrage innerhalb der
 * Festschreib-Transaktion (dort ist die neue Nummer noch nicht sichtbar). Fehler → null, der Aufrufer
 * nimmt dann die Nummer.
 */
export async function rechnungsDateiname(
  invoiceId: string, abfrage: Abfrage = (s, p) => pool.query(s, p), endung = 'pdf',
): Promise<string | null> {
  try {
    const r = (await abfrage(
      `SELECT i.number, i.status, i.kind, i.issue_date AS datum, i.empfaenger, c.name AS kunde_name, c.company AS kunde_firma,
              COALESCE(i.service_period_start, (SELECT MIN(l.leistung_von) FROM billing_invoice_line_items l WHERE l.invoice_id = i.id))::text AS von,
              COALESCE(i.service_period_end, (SELECT MAX(COALESCE(l.leistung_bis, l.leistung_von)) FROM billing_invoice_line_items l WHERE l.invoice_id = i.id))::text AS bis,
              (SELECT k.customer_number FROM customers k WHERE k.id = i.klient_id) AS kundennummer,
              (SELECT b.number FROM billing_invoices b WHERE b.id = i.cancels_invoice_id) AS bezug
         FROM billing_invoices i JOIN billing_customers c ON c.id = i.customer_id WHERE i.id = $1`, [invoiceId])).rows[0];
    if (!r) return null;
    // Auftragstitel nur, wenn alle Positionen aus einem Auftrag stammen (eigene Abfrage: Tabellen gibt es nicht überall).
    let auftrag: string | null = null;
    try {
      const t = (await abfrage(
        `SELECT MIN(a.titel) AS titel, COUNT(DISTINCT p.auftrag_id) AS n FROM abrechnungsposten p JOIN auftraege a ON a.id = p.auftrag_id WHERE p.invoice_id = $1`,
        [invoiceId])).rows[0];
      if (t && Number(t.n) === 1 && typeof t.titel === 'string') auftrag = t.titel;
    } catch { auftrag = null; }
    const e = leseEmpfaenger(r.empfaenger) ?? { name: r.kunde_name as string, company: (r.kunde_firma as string | null) ?? null };
    const gutschrift = r.kind === 'gutschrift';
    return belegDateiname({
      datum: isoTag(r.datum),
      art: rechnungsArt(r.kind as string),
      nummer: r.status === 'draft' ? 'Entwurf' : (r.number as string),
      kundennummer: r.kundennummer as string | null,
      name: namensTeil(e),
      inhalt: gutschrift
        ? (r.bezug ? `zu ${r.bezug}` : '')
        : [auftrag, zeitraumTeil(r.von as string | null, r.bis as string | null)].filter(Boolean).join('-'),
      endung,
    });
  } catch {
    return null;
  }
}

/** Dateiname eines Angebots; Entwürfe heißen „Entwurf“ statt der internen Kennung. */
export async function angebotsDateiname(a: Angebot): Promise<string> {
  return belegDateiname({
    datum: a.datum,
    art: 'Angebot',
    nummer: a.status === 'entwurf' ? 'Entwurf' : a.number,
    kundennummer: await kundennummerVon(a.klientId).catch(() => undefined),
    name: a.empfaenger ? namensTeil(a.empfaenger) : '',
    inhalt: a.auftragTitel,
  });
}

/** Dateiname einer Zahlungserinnerung/Mahnung: Nummer der Rechnung, Inhalt „zu Rechnung vom …“. */
export function mahnungsDateiname(m: {
  stufe: number; datum: unknown; rechnungsnummer: string; rechnungsdatum: unknown;
  kundennummer?: string | null; empfaenger: { name?: string | null; company?: string | null };
}): string {
  return belegDateiname({
    datum: isoTag(m.datum),
    art: mahnungsArt(m.stufe),
    nummer: m.rechnungsnummer,
    kundennummer: m.kundennummer,
    name: namensTeil(m.empfaenger),
    inhalt: /^\d{4}-\d{2}-\d{2}/.test(isoTag(m.rechnungsdatum)) ? `zu Rechnung vom ${kompakt(isoTag(m.rechnungsdatum))}` : '',
  });
}
