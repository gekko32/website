// Rechnungswesen Stufe 4, T16/T17 (AE11, AE12): Angebote aus individuellen Aufträgen.
// Ein Angebot entsteht als Entwurf aus den geplanten Positionen eines Auftrags „mit Angebot“
// (K47). Erst beim Versand bekommt es seine Nummer AN-Jahr-laufend und speichert eine Kopie
// der Positionen und des Empfängers (K49) – danach ist es unveränderlich. Änderungen laufen
// über eine neue Fassung (K50). Gespeichert in billing_quotes.
import type { PoolClient } from 'pg';
import { pool } from './website-db';
import { createCustomer } from './native-billing';
import { resolveEffectiveTaxMode } from './tax-monitor';
import { ladeRegeln } from './billing-regeln';
import { initPostenTabelle, postenBetrag, holeAuftrag, legeAuftragAn, legePositionAn, loescheAuftrag, type Posten, type PostenZustand } from './billing-posten';
import { rechnungsempfaenger, verknuepfeRechnungskunde, type Klient } from './klientenakte';
import { aktuellerEmpfaenger, fehlendeAngaben, leseEmpfaenger, AnschriftFehlt, type Empfaenger } from './billing-empfaenger';
import { entwurfsKennung, istEntwurfsKennung, naechsteNummer } from './billing-nummer';
import { rechnungszeilen, type RechnungsZeile } from './billing-entwurf';
import type { Versandweg } from './billing-versand';

export type AngebotStatus = 'entwurf' | 'verschickt' | 'angenommen' | 'abgelehnt' | 'ersetzt';
export type AngebotStand = AngebotStatus | 'abgelaufen';

export const ANGEBOT_STAND_TEXT: Record<AngebotStand, string> = {
  entwurf: 'Entwurf', verschickt: 'verschickt, Antwort offen', angenommen: 'angenommen', abgelehnt: 'abgelehnt',
  ersetzt: 'ersetzt durch neue Fassung', abgelaufen: 'abgelaufen',
};

/** K50: AN-2026-0001, AN-2026-0001-2, … */
export function fassungsNummer(grundnummer: string, fassung: number): string {
  return fassung <= 1 ? grundnummer : `${grundnummer}-${fassung}`;
}

/** K55: ein verschicktes Angebot nach „gültig bis“ ist abgelaufen (am letzten Tag noch gültig). */
export function angebotStand(a: { status: AngebotStatus; gueltigBis: string }, heute: string): AngebotStand {
  return a.status === 'verschickt' && a.gueltigBis < heute ? 'abgelaufen' : a.status;
}

const tagBerlin = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });

export function gueltigBisVorschlag(jetzt: Date, tage: number): string {
  const d = new Date(`${tagBerlin(jetzt)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}

/** K48: „gültig bis“ im Einzelfall – ab heute, höchstens ein Jahr. */
export function pruefeGueltigBis(roh: string | null | undefined, heute: string): { wert: string | null; fehler: string | null } {
  const s = (roh ?? '').trim();
  const d = new Date(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    return { wert: null, fehler: 'Bitte ein gültiges Datum für „gültig bis“ wählen.' };
  }
  if (s < heute) return { wert: null, fehler: '„Gültig bis“ darf nicht in der Vergangenheit liegen.' };
  if (Date.parse(s) - Date.parse(heute) > 366 * 86_400_000) return { wert: null, fehler: '„Gültig bis“ höchstens ein Jahr ab heute.' };
  return { wert: s, fehler: null };
}

export interface Angebot {
  id: string; brand: string; number: string; status: AngebotStatus; stand: AngebotStand;
  klientId: string | null; auftragId: string | null; auftragTitel: string | null;
  customerId: string; fassung: number; grundnummer: string | null; vorgaengerId: string | null;
  datum: string; gueltigBis: string; netto: number; brutto: number; taxMode: string;
  positionen: RechnungsZeile[]; empfaenger: Empfaenger | null;
  versandweg: Versandweg | null; versendetAm: string | null;
  antwortAm: string | null; antwortGrund: string | null; abgelaufenAngenommen: boolean;
  einleitung: string | null; schluss: string | null;
  /** Nachtrag 24.10.2026 (K86): als Vorlage markiert, mit Namen. */
  vorlageName: string | null;
}

/** Prüfung D5: nummeriert, aber (noch) nicht verschickt – in Listen eigens benennen. */
export function standText(a: Pick<Angebot, 'stand' | 'status' | 'versendetAm'>): string {
  return a.status === 'verschickt' && !a.versendetAm ? `nummeriert, noch nicht verschickt${a.stand === 'abgelaufen' ? ' (abgelaufen)' : ''}` : ANGEBOT_STAND_TEXT[a.stand];
}

/** K84: aktive Angebote zuerst, dann die abgeschlossenen. */
export const AKTIVE_STAENDE: AngebotStand[] = ['entwurf', 'verschickt', 'abgelaufen'];
export const istAktiv = (a: Pick<Angebot, 'stand'>) => AKTIVE_STAENDE.includes(a.stand);
export function sortiereAngebote<T extends Pick<Angebot, 'stand'>>(liste: T[]): T[] {
  return [...liste.filter(istAktiv), ...liste.filter((a) => !istAktiv(a))];
}

// ── Datenbank ───────────────────────────────────────────────────────────────

let bereit: Promise<void> | null = null;
export function initAngebotTabelle(): Promise<void> {
  bereit ??= (async () => {
    await initPostenTabelle();
    // billing_quotes gibt es aus dem alten System (initBillingTables); hier die Spalten für Stufe 4.
    await pool.query(`
      ALTER TABLE billing_quotes
        ADD COLUMN IF NOT EXISTS klient_id      UUID,
        ADD COLUMN IF NOT EXISTS auftrag_id     UUID,
        ADD COLUMN IF NOT EXISTS fassung        INTEGER NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS grundnummer    TEXT,
        ADD COLUMN IF NOT EXISTS vorgaenger_id  TEXT,
        ADD COLUMN IF NOT EXISTS tax_mode       TEXT,
        ADD COLUMN IF NOT EXISTS positionen     JSONB,
        ADD COLUMN IF NOT EXISTS empfaenger     JSONB,
        ADD COLUMN IF NOT EXISTS einleitung     TEXT,
        ADD COLUMN IF NOT EXISTS schluss        TEXT,
        ADD COLUMN IF NOT EXISTS versandweg     TEXT,
        ADD COLUMN IF NOT EXISTS versendet_am   TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS antwort_am     DATE,
        ADD COLUMN IF NOT EXISTS antwort_grund  TEXT,
        ADD COLUMN IF NOT EXISTS abgelaufen_angenommen BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS pdf            BYTEA,
        ADD COLUMN IF NOT EXISTS vorlage_name   TEXT`);
  })().catch((e) => { bereit = null; throw e; });
  return bereit;
}

const SPALTEN = `q.id, q.brand, q.number, q.status, q.klient_id::text AS klient_id, q.auftrag_id::text AS auftrag_id,
  a.titel AS auftrag_titel, q.customer_id, q.fassung, q.grundnummer, q.vorgaenger_id, q.issue_date::text AS datum,
  q.valid_until::text AS gueltig_bis, q.net_amount, q.gross_amount, q.tax_mode, q.positionen, q.empfaenger,
  q.versandweg, q.versendet_am::text AS versendet_am, q.antwort_am::text AS antwort_am, q.antwort_grund,
  q.abgelaufen_angenommen, q.einleitung, q.schluss, q.vorlage_name`;

function zeile(r: Record<string, unknown>, heute: string): Angebot {
  const status = r.status as AngebotStatus;
  const gueltigBis = r.gueltig_bis as string;
  return {
    id: r.id as string, brand: r.brand as string, number: r.number as string, status,
    stand: angebotStand({ status, gueltigBis }, heute),
    klientId: (r.klient_id as string | null) ?? null, auftragId: (r.auftrag_id as string | null) ?? null,
    auftragTitel: (r.auftrag_titel as string | null) ?? null, customerId: r.customer_id as string,
    fassung: Number(r.fassung ?? 1), grundnummer: (r.grundnummer as string | null) ?? null,
    vorgaengerId: (r.vorgaenger_id as string | null) ?? null, datum: r.datum as string, gueltigBis,
    netto: Number(r.net_amount), brutto: Number(r.gross_amount), taxMode: (r.tax_mode as string) ?? 'kleinunternehmer',
    positionen: (r.positionen as RechnungsZeile[] | null) ?? [], empfaenger: leseEmpfaenger(r.empfaenger),
    versandweg: (r.versandweg as Versandweg | null) ?? null, versendetAm: (r.versendet_am as string | null) ?? null,
    antwortAm: (r.antwort_am as string | null) ?? null, antwortGrund: (r.antwort_grund as string | null) ?? null,
    abgelaufenAngenommen: r.abgelaufen_angenommen === true,
    einleitung: (r.einleitung as string | null) ?? null, schluss: (r.schluss as string | null) ?? null,
    vorlageName: (r.vorlage_name as string | null) ?? null,
  };
}

export async function holeAngebot(brand: string, id: string, jetzt = new Date()): Promise<Angebot | null> {
  await initAngebotTabelle();
  const { rows } = await pool.query(
    `SELECT ${SPALTEN} FROM billing_quotes q LEFT JOIN auftraege a ON a.id = q.auftrag_id WHERE q.brand = $1 AND q.id = $2`, [brand, id]);
  return rows[0] ? zeile(rows[0], tagBerlin(jetzt)) : null;
}

export async function angeboteDesKlienten(brand: string, klientId: string, jetzt = new Date()): Promise<Angebot[]> {
  await initAngebotTabelle();
  const { rows } = await pool.query(
    `SELECT ${SPALTEN} FROM billing_quotes q LEFT JOIN auftraege a ON a.id = q.auftrag_id
      WHERE q.brand = $1 AND q.klient_id = $2 ORDER BY q.created_at DESC`, [brand, klientId]);
  return rows.map((r: Record<string, unknown>) => zeile(r, tagBerlin(jetzt)));
}

/** K57: verschickte, noch nicht beantwortete Angebote aller Klienten (inkl. abgelaufener). */
export async function offeneAngebote(brand: string, jetzt = new Date()): Promise<(Angebot & { klientName: string })[]> {
  await initAngebotTabelle();
  const { rows } = await pool.query(
    `SELECT ${SPALTEN}, c.name AS klient_name FROM billing_quotes q
       LEFT JOIN auftraege a ON a.id = q.auftrag_id LEFT JOIN customers c ON c.id = q.klient_id
      WHERE q.brand = $1 AND q.status = 'verschickt' ORDER BY q.valid_until`, [brand]);
  return rows.map((r: Record<string, unknown>) => ({ ...zeile(r, tagBerlin(jetzt)), klientName: (r.klient_name as string) ?? '' }));
}

export type AngebotFilter = 'aktiv' | 'abgeschlossen' | 'alle';

/**
 * Nachtrag 24.10.2026 (K85): zentrale Liste aller Angebote aller Klienten – Filter, nur Vorlagen, Suche
 * in Nummer, Klient, Auftrag, Vorlagenname und Positionstexten.
 */
export async function alleAngebote(
  brand: string, opts: { filter?: AngebotFilter; nurVorlagen?: boolean; suche?: string } = {}, jetzt = new Date(),
): Promise<(Angebot & { klientName: string })[]> {
  await initAngebotTabelle();
  const suche = (opts.suche ?? '').trim().slice(0, 100);
  const { rows } = await pool.query(
    `SELECT ${SPALTEN}, c.name AS klient_name FROM billing_quotes q
       LEFT JOIN auftraege a ON a.id = q.auftrag_id LEFT JOIN customers c ON c.id = q.klient_id
      WHERE q.brand = $1 AND q.klient_id IS NOT NULL
        AND ($2::boolean IS NOT TRUE OR q.vorlage_name IS NOT NULL)
        AND ($3 = '' OR q.number ILIKE $4 OR c.name ILIKE $4 OR a.titel ILIKE $4 OR q.vorlage_name ILIKE $4
             -- Prüfung A3: nur die Bezeichnungen, nicht die JSON-Schlüssel; Posten nur beim Entwurf (sonst gilt die Kopie)
             OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(q.positionen, '[]'::jsonb)) z WHERE z->>'description' ILIKE $4)
             OR (q.status = 'entwurf' AND EXISTS (SELECT 1 FROM abrechnungsposten p WHERE p.auftrag_id = q.auftrag_id AND p.text ILIKE $4)))
      ORDER BY q.created_at DESC`,
    [brand, opts.nurVorlagen === true, suche, `%${suche.replace(/[%_\\]/g, (z) => '\\' + z)}%`]);
  const liste = rows.map((r: Record<string, unknown>) => ({ ...zeile(r, tagBerlin(jetzt)), klientName: (r.klient_name as string) ?? '' }));
  const gefiltert = opts.filter === 'aktiv' ? liste.filter(istAktiv)
    : opts.filter === 'abgeschlossen' ? liste.filter((a) => !istAktiv(a)) : liste;
  return sortiereAngebote(gefiltert);
}

/** K86: als Vorlage markieren (Name) oder Markierung entfernen (null). Ändert am Angebot selbst nichts. */
export async function markiereVorlage(brand: string, id: string, name: string | null): Promise<Ergebnis<object>> {
  await initAngebotTabelle();
  const n = name === null ? null : name.trim().slice(0, 120);
  if (n !== null && n.length < 2) return { ok: false, fehler: 'Bitte einen Vorlagennamen mit mindestens zwei Zeichen eintragen.' };
  const r = await pool.query('UPDATE billing_quotes SET vorlage_name = $3 WHERE brand = $1 AND id = $2', [brand, id, n]);
  return (r.rowCount ?? 0) > 0 ? { ok: true } : { ok: false, fehler: 'Angebot nicht gefunden.' };
}

/** K88: die geplanten Positionen eines Auftrags mit allen Feldern – für die änderbare Entwurfsseite. */
export async function geplantePositionenDesAuftrags(brand: string, auftragId: string): Promise<Posten[]> {
  await initAngebotTabelle();
  return geplantePositionen(pool, brand, auftragId);
}

/** K88: Betrag eines Angebotsentwurfs nach Änderungen an den geplanten Positionen nachziehen. */
export async function aktualisiereAngebotsentwurf(brand: string, auftragId: string): Promise<void> {
  await initAngebotTabelle();
  const pos = await geplantePositionen(pool, brand, auftragId);
  await pool.query(`UPDATE billing_quotes SET net_amount = $3, gross_amount = $3 WHERE brand = $1 AND auftrag_id = $2 AND status = 'entwurf'`,
    [brand, auftragId, summe(pos)]);
}

const tagePlus = (iso: string, tage: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
};

/**
 * K87: neues Angebot aus einem bestehenden (Vorlage): neuer Auftrag „mit Angebot“ für den gewählten Klienten,
 * Positionen kopiert (Leistungsdatum ab heute, Zeiträume behalten ihre Länge), Angebotsentwurf dazu.
 */
export async function angebotAusVorlage(
  brand: string, quelleId: string, ziel: Klient, titel: string, jetzt = new Date(),
): Promise<Ergebnis<{ id: string; auftragId: string }>> {
  const quelle = await holeAngebot(brand, quelleId, jetzt);
  if (!quelle) return { ok: false, fehler: 'Angebot nicht gefunden.' };
  const { positionen } = await angebotVorschau(brand, quelle);
  if (positionen.length === 0) return { ok: false, fehler: 'Dieses Angebot hat keine Positionen.' };
  const { getKlient } = await import('./klientenakte');
  const quellKlient = quelle.klientId ? await getKlient(quelle.klientId) : null;
  // Bei „Firma zahlt“ hängt an jeder Zeile der Name der Person – für den neuen Auftrag weglassen.
  // Prüfung A1: auch den Namen aus der Empfängerkopie des Angebots (Klient inzwischen umbenannt/gelöscht).
  const namen = [...new Set([quelle.empfaenger?.company ? quelle.empfaenger.name : null, quellKlient?.name].filter((n): n is string => !!n))];
  const ohnePerson = (t: string) => {
    const n = namen.find((x) => t.endsWith(` · ${x}`));
    return n ? t.slice(0, -(` · ${n}`.length)) : t;
  };
  const heute = tagBerlin(jetzt);
  const auftragId = await legeAuftragAn(brand, ziel.id, titel, 'mit_angebot');
  try {
    for (const z of positionen) {
      const tage = z.leistungBis ? Math.round((Date.parse(z.leistungBis) - Date.parse(z.leistungVon)) / 86_400_000) : 0;
      await legePositionAn(brand, ziel.id, auftragId, {
        datum: heute, datumBis: tage > 0 ? tagePlus(heute, tage) : null, text: ohnePerson(z.description),
        menge: z.quantity, einheit: z.unit ?? '', einzelpreis: z.unitPrice,
      });
    }
    const e = await erstelleAngebotsentwurf(brand, ziel, auftragId, jetzt);
    if (!e.ok) { await loescheAuftrag(brand, auftragId).catch(() => false); return e; }
    return { ok: true, id: e.id, auftragId };
  } catch (err) {
    // Prüfung A2: keinen halben Auftrag ohne Angebot zurücklassen.
    await loescheAuftrag(brand, auftragId).catch(() => false);
    throw err;
  }
}

/** Geplante Positionen eines Auftrags (Quelle für Entwurf und Versand). */
async function geplantePositionen(db: Pick<PoolClient, 'query'>, brand: string, auftragId: string): Promise<Posten[]> {
  const { rows } = await db.query(
    `SELECT id, klient_id, herkunft, datum::text AS datum, datum_bis::text AS datum_bis, text, menge, einheit, einzelpreis, zustand
       FROM abrechnungsposten WHERE brand = $1 AND auftrag_id = $2 AND zustand = 'geplant' ORDER BY datum, created_at`,
    [brand, auftragId]);
  return rows.map((r: Record<string, unknown>) => ({
    id: r.id as string, klientId: r.klient_id as string, klientName: '', herkunft: 'auftrag', datum: r.datum as string,
    datumBis: (r.datum_bis as string | null) ?? null, leistungKey: null, text: r.text as string, menge: Number(r.menge),
    einheit: (r.einheit as string) ?? '', einzelpreis: r.einzelpreis === null ? null : Number(r.einzelpreis),
    zustand: r.zustand as PostenZustand, invoiceId: null, notiz: null, auftragId,
  }));
}

const summe = (p: Posten[]) => p.reduce((s, x) => Math.round((s + postenBetrag(x)) * 100) / 100, 0);

/** Positionen fürs Angebot; bei „Firma zahlt“ mit Namen der Person (wie Rechnungen). */
function angebotsZeilen(p: Posten[], klient: Klient): RechnungsZeile[] {
  return rechnungszeilen(p, { person: rechnungsempfaenger(klient).company ? klient.name : null });
}

export type Ergebnis<T> = ({ ok: true } & T) | { ok: false; fehler: string };

/** K47: Angebotsentwurf aus den geplanten Positionen eines Auftrags „mit Angebot“. */
export async function erstelleAngebotsentwurf(brand: string, klient: Klient, auftragId: string, jetzt = new Date()): Promise<Ergebnis<{ id: string }>> {
  await initAngebotTabelle();
  const auftrag = await holeAuftrag(brand, auftragId);
  if (!auftrag || auftrag.klientId !== klient.id) return { ok: false, fehler: 'Auftrag nicht gefunden.' };
  if (auftrag.modus !== 'mit_angebot') return { ok: false, fehler: 'Dieser Auftrag läuft ohne Angebot.' };
  if (auftrag.stand !== 'geplant') return { ok: false, fehler: 'Für diesen Auftrag gibt es schon ein Angebot. Für Änderungen eine neue Fassung anlegen.' };
  const offenerEntwurf = await pool.query(`SELECT id FROM billing_quotes WHERE brand=$1 AND auftrag_id=$2 AND status='entwurf'`, [brand, auftragId]);
  if (offenerEntwurf.rows[0]) return { ok: true, id: offenerEntwurf.rows[0].id as string };
  const pos = await geplantePositionen(pool, brand, auftragId);
  if (pos.length === 0) return { ok: false, fehler: 'Bitte zuerst mindestens eine Position mit Preis anlegen.' };
  if (pos.some((p) => p.einzelpreis === null)) return { ok: false, fehler: 'Bei einer Position fehlt der Preis.' };

  const e = rechnungsempfaenger(klient);
  const kunde = await createCustomer({
    brand, name: e.name, email: e.email, company: e.company ?? undefined, addressLine1: e.addressLine1 ?? undefined,
    postalCode: e.postalCode ?? undefined, city: e.city ?? undefined, vatNumber: e.vatNumber ?? undefined,
  });
  await verknuepfeRechnungskunde(kunde.id, klient.id);
  const regeln = await ladeRegeln(brand);
  const taxMode = await resolveEffectiveTaxMode(brand);
  const betrag = summe(pos);
  const { rows } = await pool.query(
    `INSERT INTO billing_quotes (brand, number, status, customer_id, issue_date, valid_until, net_amount, tax_rate, gross_amount,
       klient_id, auftrag_id, fassung, tax_mode)
     VALUES ($1,$2,'entwurf',$3,$4,$5,$6,0,$6,$7,$8,1,$9) RETURNING id`,
    [brand, entwurfsKennung(), kunde.id, tagBerlin(jetzt), gueltigBisVorschlag(jetzt, regeln.angebotGueltigTage),
     betrag, klient.id, auftragId, taxMode]);
  return { ok: true, id: rows[0].id as string };
}

/** Für die Prüfansicht eines Entwurfs: Positionen und Empfänger, wie sie heute verschickt würden. */
export async function angebotVorschau(brand: string, a: Angebot): Promise<{ positionen: RechnungsZeile[]; empfaenger: Empfaenger | null }> {
  if (a.status !== 'entwurf' || !a.auftragId || !a.klientId) return { positionen: a.positionen, empfaenger: a.empfaenger };
  const { getKlient } = await import('./klientenakte');
  const klient = await getKlient(a.klientId);
  const pos = await geplantePositionen(pool, brand, a.auftragId);
  return {
    positionen: klient ? angebotsZeilen(pos, klient) : [],
    empfaenger: await aktuellerEmpfaenger(brand, a.customerId, { klientId: a.klientId }),
  };
}

/** Prüfung Stufe 4 (B5, K48): „gültig bis“ eines Entwurfs sofort speichern (Vorschau zeigt es dann). */
export async function setzeGueltigBis(brand: string, id: string, gueltigBis: string): Promise<boolean> {
  await initAngebotTabelle();
  const r = await pool.query(`UPDATE billing_quotes SET valid_until=$3 WHERE brand=$1 AND id=$2 AND status='entwurf'`, [brand, id, gueltigBis]);
  return (r.rowCount ?? 0) > 0;
}

/** K51: Entwurf verwerfen – Positionen bleiben geplant; bei einer Fassung gilt die vorige wieder. */
export async function verwirfAngebot(brand: string, id: string): Promise<boolean> {
  await initAngebotTabelle();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `DELETE FROM billing_quotes WHERE brand=$1 AND id=$2 AND status='entwurf' RETURNING vorgaenger_id, auftrag_id`, [brand, id]);
    if (!rows[0]) { await client.query('ROLLBACK'); return false; }
    if (rows[0].vorgaenger_id) {
      await client.query(`UPDATE billing_quotes SET status='verschickt' WHERE id=$1 AND status='ersetzt'`, [rows[0].vorgaenger_id]);
      await client.query(`UPDATE auftraege SET stand='angeboten' WHERE id=$1`, [rows[0].auftrag_id]);
    }
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * K49: Angebot verschicken. In einer Transaktion: Nummer vergeben (lückenlos), Positionen und
 * Empfänger kopieren, Auftrag „angeboten“. `dokument` erzeugt das PDF mit der endgültigen
 * Nummer; scheitert es, wird nichts gespeichert und keine Nummer verbraucht.
 */
export async function versendeAngebot(
  brand: string, id: string,
  opts: {
    weg: Versandweg; gueltigBis?: string; jetzt?: Date; dokument?: (a: Angebot) => Promise<Buffer>;
    /** K100: nur nummerieren – „verschickt per E-Mail“ wird erst mit der tatsächlich gesendeten Mail vermerkt. */
    ohneVersandvermerk?: boolean;
  },
): Promise<Ergebnis<{ angebot: Angebot; pdf: Buffer | null }>> {
  await initAngebotTabelle();
  const jetzt = opts.jetzt ?? new Date();
  const vorher = await holeAngebot(brand, id, jetzt);
  if (!vorher || vorher.status !== 'entwurf' || !vorher.klientId || !vorher.auftragId) return { ok: false, fehler: 'Nur Entwürfe lassen sich verschicken.' };
  const { getKlient } = await import('./klientenakte');
  const klient = await getKlient(vorher.klientId);
  if (!klient) return { ok: false, fehler: 'Klientenakte nicht gefunden.' };
  const empfaenger = await aktuellerEmpfaenger(brand, vorher.customerId, { klientId: vorher.klientId });
  if (!empfaenger) return { ok: false, fehler: 'Empfänger nicht gefunden.' };
  const fehlt = fehlendeAngaben(empfaenger);
  if (fehlt.length > 0) return { ok: false, fehler: new AnschriftFehlt(fehlt).message.replace('Festschreiben', 'Versand') };
  const [texte] = await Promise.all([import('./billing-rechnungstexte').then((m) => m.ladeRechnungstexte(brand))]);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sperre = await client.query(`SELECT id FROM billing_quotes WHERE id=$1 AND status='entwurf' FOR UPDATE`, [id]);
    if (!sperre.rows[0]) { await client.query('ROLLBACK'); return { ok: false, fehler: 'Das Angebot wurde inzwischen geändert.' }; }
    const pos = await geplantePositionen(client, brand, vorher.auftragId);
    if (pos.length === 0) { await client.query('ROLLBACK'); return { ok: false, fehler: 'Der Auftrag hat keine geplanten Positionen mehr.' }; }
    if (pos.some((p) => p.einzelpreis === null)) { await client.query('ROLLBACK'); return { ok: false, fehler: 'Bei einer Position fehlt der Preis.' }; }
    const heute = tagBerlin(jetzt);
    const gueltigBis = opts.gueltigBis ?? vorher.gueltigBis;
    let grundnummer = vorher.grundnummer;
    if (!grundnummer || istEntwurfsKennung(grundnummer)) grundnummer = await naechsteNummer(client, brand, Number(heute.slice(0, 4)), 'angebot');
    const nummer = fassungsNummer(grundnummer, vorher.fassung);
    const zeilen = angebotsZeilen(pos, klient);
    const betrag = summe(pos);
    await client.query(
      `UPDATE billing_quotes SET number=$2, grundnummer=$3, status='verschickt', issue_date=$4, valid_until=$5,
         net_amount=$6, gross_amount=$6, positionen=$7::jsonb, empfaenger=$8::jsonb, einleitung=$9, schluss=$10,
         versandweg=$11, versendet_am=CASE WHEN $11::text IS NULL THEN NULL ELSE now() END
       WHERE id=$1`,
      [id, nummer, grundnummer, heute, gueltigBis, betrag, JSON.stringify(zeilen), JSON.stringify(empfaenger),
       texte.angebot_intro_text || null, texte.angebot_outro_text || null, opts.ohneVersandvermerk ? null : opts.weg]);
    await client.query(`UPDATE auftraege SET stand='angeboten' WHERE id=$1`, [vorher.auftragId]);
    const angebot: Angebot = {
      ...vorher, number: nummer, grundnummer, status: 'verschickt', stand: 'verschickt', datum: heute, gueltigBis,
      netto: betrag, brutto: betrag, positionen: zeilen, empfaenger, versandweg: opts.ohneVersandvermerk ? null : opts.weg,
      einleitung: texte.angebot_intro_text || null, schluss: texte.angebot_outro_text || null,
    };
    const pdf = opts.dokument ? await opts.dokument(angebot) : null;
    if (pdf) await client.query('UPDATE billing_quotes SET pdf=$2 WHERE id=$1', [id, pdf]);
    await client.query('COMMIT');
    return { ok: true, angebot, pdf };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** K50: neue Fassung eines verschickten Angebots – die alte steht danach auf „ersetzt“. */
export async function neueFassung(brand: string, id: string, jetzt = new Date()): Promise<Ergebnis<{ id: string }>> {
  await initAngebotTabelle();
  const alt = await holeAngebot(brand, id, jetzt);
  if (!alt || alt.status !== 'verschickt') return { ok: false, fehler: 'Eine neue Fassung geht nur von einem verschickten, unbeantworteten Angebot.' };
  const regeln = await ladeRegeln(brand);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upd = await client.query(`UPDATE billing_quotes SET status='ersetzt' WHERE id=$1 AND status='verschickt'`, [id]);
    if ((upd.rowCount ?? 0) === 0) { await client.query('ROLLBACK'); return { ok: false, fehler: 'Das Angebot wurde inzwischen geändert.' }; }
    const { rows } = await client.query(
      `INSERT INTO billing_quotes (brand, number, status, customer_id, issue_date, valid_until, net_amount, tax_rate, gross_amount,
         klient_id, auftrag_id, fassung, grundnummer, vorgaenger_id, tax_mode)
       VALUES ($1,$2,'entwurf',$3,$4,$5,$6,0,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [brand, entwurfsKennung(), alt.customerId, tagBerlin(jetzt), gueltigBisVorschlag(jetzt, regeln.angebotGueltigTage),
       alt.netto, alt.klientId, alt.auftragId, alt.fassung + 1, alt.grundnummer, alt.id, alt.taxMode]);
    await client.query(`UPDATE auftraege SET stand='geplant' WHERE id=$1`, [alt.auftragId]);
    await client.query('COMMIT');
    return { ok: true, id: rows[0].id as string };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ── T17: Antwort des Kunden (K52–K55) ─────────────────────────────────────────

/** Antwort zwischen Versand und heute. */
export function pruefeAntwortDatum(roh: string | null | undefined, versendet: string, heute: string): { wert: string | null; fehler: string | null } {
  const s = (roh ?? '').trim();
  const d = new Date(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    return { wert: null, fehler: 'Bitte ein gültiges Datum der Antwort wählen.' };
  }
  if (s > heute) return { wert: null, fehler: 'Das Datum der Antwort liegt in der Zukunft.' };
  if (s < versendet.slice(0, 10)) return { wert: null, fehler: 'Das Datum der Antwort liegt vor dem Versand des Angebots.' };
  return { wert: s, fehler: null };
}

export { gemaessAngebotText } from './billing-angebot-text';

export const VERMERK_NICHT_IM_ANGEBOT = 'nicht im angenommenen Angebot';

/**
 * K52, K55: Annahme vermerken. Die angebotenen Positionen werden offene Posten mit genau den
 * angebotenen Werten (Herkunft angebot_id); später dazugekommene, nicht angebotene Positionen
 * werden „ausgenommen“ mit Vermerk. Der Auftrag ist danach beauftragt.
 */
export async function vermerkeAnnahme(brand: string, id: string, datum: string): Promise<Ergebnis<object>> {
  await initAngebotTabelle();
  const a = await holeAngebot(brand, id);
  if (!a || a.status !== 'verschickt') return { ok: false, fehler: 'Annehmen geht nur bei der neuesten verschickten Fassung.' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE billing_quotes SET status='angenommen', antwort_am=$2, abgelaufen_angenommen=$3 WHERE id=$1 AND status='verschickt'`,
      [id, datum, datum > a.gueltigBis]);
    if ((upd.rowCount ?? 0) === 0) { await client.query('ROLLBACK'); return { ok: false, fehler: 'Das Angebot wurde inzwischen geändert.' }; }
    const angeboten = new Set<string>();
    for (const z of a.positionen) {
      const werte = [id, z.description, z.quantity, z.unit ?? '', z.unitPrice, z.leistungVon, z.leistungBis ?? null];
      const r = await client.query(
        `UPDATE abrechnungsposten SET zustand='offen', angebot_id=$1, text=$2, menge=$3, einheit=$4, einzelpreis=$5, datum=$6,
           datum_bis=$7, updated_at=now()
         WHERE id=$8 AND zustand='geplant' RETURNING id`, [...werte, z.postenId]);
      if (r.rows[0]) { angeboten.add(z.postenId); continue; }
      // Position wurde nach dem Versand gelöscht oder geändert: aus der Kopie des Angebots neu anlegen.
      const neu = await client.query(
        `INSERT INTO abrechnungsposten (brand, klient_id, herkunft, auftrag_id, angebot_id, text, menge, einheit, einzelpreis, datum, datum_bis, zustand)
         VALUES ($8,$9,'auftrag',$10,$1,$2,$3,$4,$5,$6,$7,'offen') RETURNING id`, [...werte, brand, a.klientId, a.auftragId]);
      angeboten.add(neu.rows[0].id as string);
    }
    await client.query(
      `UPDATE abrechnungsposten SET zustand='nicht_abrechnen',
         notiz = CASE WHEN notiz IS NULL OR notiz = '' THEN $3 ELSE notiz || ' · ' || $3 END, updated_at=now()
       WHERE brand=$1 AND auftrag_id=$2 AND zustand='geplant' AND NOT (id::text = ANY($4::text[]))`,
      [brand, a.auftragId, VERMERK_NICHT_IM_ANGEBOT, [...angeboten]]);
    await client.query(`UPDATE auftraege SET stand='beauftragt' WHERE id=$1`, [a.auftragId]);
    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** K54: Ablehnung vermerken – Positionen bleiben geplant und damit nicht abrechenbar. */
export async function vermerkeAblehnung(brand: string, id: string, datum: string, grund: string | null): Promise<Ergebnis<object>> {
  await initAngebotTabelle();
  const a = await holeAngebot(brand, id);
  if (!a || a.status !== 'verschickt') return { ok: false, fehler: 'Ablehnen geht nur bei der neuesten verschickten Fassung.' };
  const g = (grund ?? '').trim().slice(0, 300) || null;
  const upd = await pool.query(
    `UPDATE billing_quotes SET status='abgelehnt', antwort_am=$2, antwort_grund=$3 WHERE id=$1 AND status='verschickt'`, [id, datum, g]);
  if ((upd.rowCount ?? 0) === 0) return { ok: false, fehler: 'Das Angebot wurde inzwischen geändert.' };
  await pool.query(`UPDATE auftraege SET stand='abgelehnt' WHERE id=$1`, [a.auftragId]);
  return { ok: true };
}

/**
 * K134 (Handtest 29.10.2026): Datum und Grund einer vermerkten Antwort korrigieren. Der Zustand
 * (angenommen/abgelehnt) bleibt; ein Grund gibt es nur bei der Ablehnung.
 */
export async function korrigiereAntwort(brand: string, id: string, datum: string, grund: string | null): Promise<Ergebnis<object>> {
  await initAngebotTabelle();
  const a = await holeAngebot(brand, id);
  if (!a || (a.status !== 'angenommen' && a.status !== 'abgelehnt')) return { ok: false, fehler: 'Korrigieren geht nur bei einer vermerkten Annahme oder Ablehnung.' };
  const g = a.status === 'abgelehnt' ? (grund ?? '').trim().slice(0, 300) || null : null;
  const upd = await pool.query(
    `UPDATE billing_quotes SET antwort_am=$3, antwort_grund=$4,
       abgelaufen_angenommen = CASE WHEN status='angenommen' THEN $3::date > valid_until ELSE abgelaufen_angenommen END
     WHERE brand=$1 AND id=$2 AND status IN ('angenommen','abgelehnt')`, [brand, id, datum, g]);
  return (upd.rowCount ?? 0) > 0 ? { ok: true } : { ok: false, fehler: 'Das Angebot wurde inzwischen geändert.' };
}

/** K128: Rechnungsentwürfe, auf denen Posten dieses Angebots liegen. */
export async function entwuerfeDesAngebots(brand: string, angebotId: string): Promise<{ id: string; betrag: number }[]> {
  const { rows } = await pool.query(
    `SELECT i.id, i.gross_amount FROM billing_invoices i
      WHERE i.brand=$1 AND i.status='draft'
        AND i.id::text IN (SELECT invoice_id::text FROM abrechnungsposten WHERE brand=$1 AND angebot_id=$2 AND zustand='auf_entwurf')`,
    [brand, angebotId]);
  return rows.map((r) => ({ id: String(r.id), betrag: Number(r.gross_amount) }));
}
