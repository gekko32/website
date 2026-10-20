// Rechnungswesen Stufe 3, T5: Abrechnungsposten – alles Abrechenbare an einer Stelle
// (Spezifikation K2, K11, K14, K16; später K12, K13, K18, K22 ff.).
// Ein Posten speichert Text, Menge und Einzelpreis zum Zeitpunkt der Erfassung;
// spätere Preisänderungen der Leistung ändern ihn nicht (K2).
import { pool } from './website-db';
import type { Leistung } from './billing-leistungen';
import { verbucheAusfaelle } from './billing-ausfall';

export type Herkunft = 'hand' | 'termin' | 'zeit' | 'ausfall' | 'auftrag';
export type PostenZustand = 'offen' | 'nicht_abrechnen' | 'erlassen' | 'auf_entwurf' | 'abgerechnet';

export interface Posten {
  id: string;
  klientId: string;
  klientName: string;
  herkunft: Herkunft;
  datum: string;
  leistungKey: string | null;
  text: string;
  menge: number;
  einheit: string;
  /** null = Preis fehlt noch (Leistung „nach Vereinbarung“); muss vor der Rechnung eingetragen werden. */
  einzelpreis: number | null;
  zustand: PostenZustand;
  invoiceId: string | null;
  notiz: string | null;
  /** Nur bei Positionen eines individuellen Auftrags (T8). */
  auftragId?: string | null;
}

export const HERKUNFT_TEXT: Record<Herkunft, string> = {
  hand: 'von Hand', termin: 'Termin', zeit: 'Zeiterfassung', ausfall: 'Ausfallhonorar', auftrag: 'Auftrag',
};
export const ZUSTAND_TEXT: Record<PostenZustand, string> = {
  offen: 'offen', nicht_abrechnen: 'nicht abrechnen', erlassen: 'erlassen',
  auf_entwurf: 'auf Rechnungsentwurf', abgerechnet: 'abgerechnet',
};

/** Betrag in Euro, kaufmännisch auf Cent gerundet (in ganzen Cent gerechnet, ohne Gleitkomma-Fehler). */
export function postenBetrag(p: Pick<Posten, 'menge' | 'einzelpreis'>): number {
  if (p.einzelpreis === null) return 0;
  const mengeHundertstel = Math.round(p.menge * 100);
  const preisCent = Math.round(p.einzelpreis * 100);
  return Math.round((mengeHundertstel * preisCent) / 100) / 100;
}

export interface SitzungEingabe {
  datum?: string; leistungKey?: string; menge?: string; preis?: string; text?: string; nichtAbrechnen?: boolean;
}

export interface SitzungWerte {
  datum: string; leistungKey: string; text: string; menge: number; einheit: string;
  einzelpreis: number; zustand: 'offen' | 'nicht_abrechnen';
}

function gueltigesDatum(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function dezimal(roh: string): number | null {
  const s = roh.trim().replace(',', '.');
  return /^-?\d+(\.\d{1,2})?$/.test(s) ? Number(s) : null;
}

/** Preis in Euro ab 0, höchstens zwei Nachkommastellen; sonst null. */
export function pruefePreis(roh: string | null | undefined): number | null {
  const p = dezimal(roh ?? '');
  return p !== null && p >= 0 ? p : null;
}

/** Prüft „Sitzung erfassen“ (K11). `leistung` ist die gewählte Leistung oder null. */
export function pruefeSitzung(e: SitzungEingabe, leistung: Leistung | null): { werte: SitzungWerte | null; fehler: { key: string; meldung: string }[] } {
  const fehler: { key: string; meldung: string }[] = [];
  const datum = (e.datum ?? '').trim();
  if (!gueltigesDatum(datum)) fehler.push({ key: 'datum', meldung: 'Bitte ein gültiges Datum wählen.' });

  if (!leistung || !leistung.aktiv) fehler.push({ key: 'leistungKey', meldung: 'Bitte eine aktive Leistung wählen.' });

  const menge = dezimal(e.menge ?? '');
  if (menge === null || menge <= 0 || menge > 1000) fehler.push({ key: 'menge', meldung: 'Die Menge muss größer als 0 und höchstens 1000 sein.' });

  const preisRoh = (e.preis ?? '').trim();
  let einzelpreis: number | null = null;
  if (preisRoh !== '') {
    const p = dezimal(preisRoh);
    if (p === null || p < 0) fehler.push({ key: 'preis', meldung: 'Der Preis muss eine Zahl ab 0 sein.' });
    else einzelpreis = p;
  } else if (leistung && leistung.aktiv) {
    if (leistung.preis === null) fehler.push({ key: 'preis', meldung: 'Diese Leistung hat keinen festen Preis („nach Vereinbarung“). Bitte den Preis eintragen.' });
    else einzelpreis = leistung.preis;
  }

  const text = (e.text ?? '').trim();
  if (text.length > 300) fehler.push({ key: 'text', meldung: 'Der Text darf höchstens 300 Zeichen haben.' });

  if (fehler.length > 0 || !leistung) return { werte: null, fehler };
  return {
    werte: {
      datum, leistungKey: leistung.key, text: text || leistung.name, menge: menge!, einheit: leistung.einheit,
      einzelpreis: einzelpreis!, zustand: e.nichtAbrechnen ? 'nicht_abrechnen' : 'offen',
    },
    fehler,
  };
}

// ── T6: Termine werden zu Posten (K12, K15) ────────────────────────────────

/** Eine Buchung aus dem Postfach (inbox_items, type 'booking') mit zugeordneter Akte. */
export interface TerminZeile {
  id: string;
  klientId: string | null;
  isTestData: boolean;
  payload: Record<string, unknown>;
}

export interface NeuerPosten {
  klientId: string; herkunftRef: string; isTestData: boolean; leistungKey: string;
  datum: string; text: string; menge: number; einheit: string;
  einzelpreis: number | null; zustand: 'offen' | 'nicht_abrechnen'; notiz: string | null;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/**
 * Welche Buchungen werden zu Posten? Freigegeben (beim Annehmen vermerkt) oder vom
 * Admin selbst eingetragen, vorbei, nicht storniert oder abgelehnt, mit bekannter
 * Leistung und zugeordneter Akte. KI-Coaching-Sitzungen sind keine Buchungen und
 * erzeugen deshalb nie einen Posten (K15).
 */
export function termineZuPosten(
  termine: TerminZeile[],
  jetzt: Date,
  findeLeistung: (key: string) => Leistung | null,
): NeuerPosten[] {
  const neu: NeuerPosten[] = [];
  for (const t of termine) {
    const p = t.payload;
    if (!t.klientId) continue;
    if (!text(p.freigegebenAm) && p.adminCreated !== true) continue;
    if (p.state === 'storniert' || p.state === 'abgelehnt' || p.abgelehnt === true) continue;
    const start = text(p.slotStart) ? new Date(p.slotStart as string) : null;
    const ende = text(p.slotEnd) ? new Date(p.slotEnd as string) : null;
    if (!start || !ende || Number.isNaN(start.getTime()) || Number.isNaN(ende.getTime())) continue;
    if (ende.getTime() > jetzt.getTime()) continue;
    const key = text(p.leistungKey) ?? text(p.serviceKey);
    const leistung = key ? findeLeistung(key) : null;
    if (!leistung) continue;

    const stunden = Math.round(((ende.getTime() - start.getTime()) / 3_600_000) * 100) / 100;
    const menge = /stunde/i.test(leistung.einheit) && stunden > 0 ? stunden : 1;
    const preis = leistung.preis;
    neu.push({
      klientId: t.klientId, herkunftRef: t.id, isTestData: t.isTestData, leistungKey: leistung.key,
      datum: start.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }),
      text: leistung.name, menge, einheit: leistung.einheit,
      einzelpreis: preis,
      zustand: preis === 0 ? 'nicht_abrechnen' : 'offen',
      notiz: preis === null ? 'Preis fehlt – bitte eintragen' : null,
    });
  }
  return neu;
}

// ── T7: Zeiterfassung wird zu Posten (K13) ─────────────────────────────────

export interface ZeitZeile {
  id: string;
  klientId: string | null;
  minuten: number;
  abrechenbar: boolean;
  satzCent: number;
  leistungKey: string | null;
  beschreibung: string | null;
  projektTitel: string;
  datum: string;
  /** Altdaten: schon über das frühere Stripe-System abgerechnet. */
  schonAbgerechnet: boolean;
}

export type NeuerZeitPosten = Omit<NeuerPosten, 'isTestData' | 'leistungKey'> & { leistungKey: string | null };

export function zeitenZuPosten(zeiten: ZeitZeile[], findeLeistung: (key: string) => Leistung | null): NeuerZeitPosten[] {
  const neu: NeuerZeitPosten[] = [];
  for (const z of zeiten) {
    if (!z.abrechenbar || !z.klientId || z.schonAbgerechnet || z.minuten <= 0) continue;
    const leistung = z.leistungKey ? findeLeistung(z.leistungKey) : null;
    const preis = z.satzCent > 0 ? z.satzCent / 100 : (leistung?.preis ?? null);
    const beschreibung = text(z.beschreibung);
    neu.push({
      klientId: z.klientId, herkunftRef: z.id, leistungKey: leistung?.key ?? null, datum: z.datum,
      text: beschreibung ? `${z.projektTitel}: ${beschreibung}` : z.projektTitel,
      menge: Math.round((z.minuten / 60) * 100) / 100, einheit: 'Stunde',
      einzelpreis: preis, zustand: 'offen',
      notiz: preis === null ? 'Preis fehlt – bitte eintragen' : null,
    });
  }
  return neu;
}

// ── T8: Individuelle Aufträge (K8–K10) ─────────────────────────────────────

export interface Auftrag { id: string; klientId: string; titel: string; createdAt: string }

export function pruefeAuftragTitel(roh: string | null | undefined): { titel: string | null; fehler: string | null } {
  const titel = (roh ?? '').trim();
  if (titel.length < 2 || titel.length > 120) return { titel: null, fehler: 'Bitte einen Titel mit 2 bis 120 Zeichen eintragen.' };
  return { titel, fehler: null };
}

export interface PositionEingabe { datum?: string; text?: string; menge?: string; einheit?: string; preis?: string }
export interface PositionWerte { datum: string; text: string; menge: number; einheit: string; einzelpreis: number }

/** Eigene Position eines Auftrags: Text, Menge, Einheit, Einzelpreis, Leistungsdatum (K8). */
export function pruefePosition(e: PositionEingabe): { werte: PositionWerte | null; fehler: { key: string; meldung: string }[] } {
  const fehler: { key: string; meldung: string }[] = [];
  const datum = (e.datum ?? '').trim();
  if (!gueltigesDatum(datum)) fehler.push({ key: 'datum', meldung: 'Bitte ein gültiges Leistungsdatum wählen.' });
  const t = (e.text ?? '').trim();
  if (t.length < 1 || t.length > 300) fehler.push({ key: 'text', meldung: 'Bitte eine Bezeichnung mit höchstens 300 Zeichen eintragen.' });
  const menge = dezimal(e.menge ?? '');
  if (menge === null || menge <= 0 || menge > 1000) fehler.push({ key: 'menge', meldung: 'Die Menge muss größer als 0 und höchstens 1000 sein.' });
  const einheit = (e.einheit ?? '').trim();
  if (einheit.length > 40) fehler.push({ key: 'einheit', meldung: 'Die Einheit darf höchstens 40 Zeichen haben.' });
  const preis = pruefePreis(e.preis);
  if (preis === null) fehler.push({ key: 'preis', meldung: 'Bitte einen Einzelpreis ab 0 eintragen (ohne Tausenderpunkt, z. B. 1200 oder 1200,50).' });
  if (fehler.length > 0) return { werte: null, fehler };
  return { werte: { datum, text: t, menge: menge!, einheit, einzelpreis: preis! }, fehler };
}

/** K10: Posten lassen sich nur ändern, solange sie auf keiner Rechnung stehen und nicht erlassen sind. */
export function postenAenderbar(zustand: PostenZustand): boolean {
  return zustand === 'offen' || zustand === 'nicht_abrechnen';
}

export interface KlientSumme { klientId: string; klientName: string; anzahl: number; summe: number; ohnePreis: number }

/** Übersicht offener Posten je Klient, größte Summe zuerst (K16). */
export function summenJeKlient(posten: Posten[]): KlientSumme[] {
  const je = new Map<string, KlientSumme>();
  for (const p of posten) {
    if (p.zustand !== 'offen') continue;
    const s = je.get(p.klientId) ?? { klientId: p.klientId, klientName: p.klientName, anzahl: 0, summe: 0, ohnePreis: 0 };
    s.anzahl += 1;
    if (p.einzelpreis === null) s.ohnePreis += 1;
    s.summe = Math.round((s.summe + postenBetrag(p)) * 100) / 100;
    je.set(p.klientId, s);
  }
  return [...je.values()].sort((a, b) => b.summe - a.summe || a.klientName.localeCompare(b.klientName));
}

// ── Datenbank ───────────────────────────────────────────────────────────────

let tabelleBereit: Promise<void> | null = null;

export function initPostenTabelle(): Promise<void> {
  tabelleBereit ??= (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS abrechnungsposten (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        brand         TEXT NOT NULL,
        klient_id     UUID NOT NULL,
        herkunft      TEXT NOT NULL CHECK (herkunft IN ('hand','termin','zeit','ausfall','auftrag')),
        herkunft_ref  TEXT,
        leistung_key  TEXT,
        datum         DATE NOT NULL,
        text          TEXT NOT NULL,
        menge         NUMERIC(10,2) NOT NULL CHECK (menge > 0),
        einheit       TEXT NOT NULL DEFAULT '',
        einzelpreis   NUMERIC(12,2) CHECK (einzelpreis IS NULL OR einzelpreis >= 0),
        zustand       TEXT NOT NULL DEFAULT 'offen'
                      CHECK (zustand IN ('offen','nicht_abrechnen','erlassen','auf_entwurf','abgerechnet')),
        invoice_id    TEXT,
        notiz         TEXT,
        is_test_data  BOOLEAN NOT NULL DEFAULT false,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    // Aus Terminen, Zeiterfassung usw. entsteht je Quelle höchstens ein Posten.
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS abrechnungsposten_herkunft_uniq
        ON abrechnungsposten (brand, herkunft, herkunft_ref) WHERE herkunft_ref IS NOT NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS abrechnungsposten_klient_idx ON abrechnungsposten (brand, klient_id, zustand)`);
    // T8: individuelle Aufträge; ihre Positionen sind Posten mit auftrag_id.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auftraege (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        brand       TEXT NOT NULL,
        klient_id   UUID NOT NULL,
        titel       TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`ALTER TABLE abrechnungsposten ADD COLUMN IF NOT EXISTS auftrag_id UUID`);
  })().catch((err) => { tabelleBereit = null; throw err; });
  return tabelleBereit;
}

const POSTEN_SPALTEN = `p.id, p.klient_id, COALESCE(c.name, '') AS klient_name, p.herkunft, p.datum::text AS datum,
  p.leistung_key, p.text, p.menge, p.einheit, p.einzelpreis, p.zustand, p.invoice_id, p.notiz, p.auftrag_id`;

function zeileZuPosten(r: Record<string, unknown>): Posten {
  return {
    id: r.id as string, klientId: r.klient_id as string, klientName: r.klient_name as string,
    herkunft: r.herkunft as Herkunft, datum: r.datum as string, leistungKey: (r.leistung_key as string | null) ?? null,
    text: r.text as string, menge: Number(r.menge), einheit: (r.einheit as string) ?? '',
    einzelpreis: r.einzelpreis === null || r.einzelpreis === undefined ? null : Number(r.einzelpreis),
    zustand: r.zustand as PostenZustand, invoiceId: (r.invoice_id as string | null) ?? null, notiz: (r.notiz as string | null) ?? null,
    auftragId: (r.auftrag_id as string | null) ?? null,
  };
}

export async function legeSitzungAn(brand: string, klientId: string, w: SitzungWerte): Promise<string> {
  await initPostenTabelle();
  const { rows } = await pool.query(
    `INSERT INTO abrechnungsposten (brand, klient_id, herkunft, leistung_key, datum, text, menge, einheit, einzelpreis, zustand)
     VALUES ($1,$2,'hand',$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [brand, klientId, w.leistungKey, w.datum, w.text, w.menge, w.einheit, w.einzelpreis, w.zustand]);
  return rows[0].id as string;
}

export async function postenDesKlienten(brand: string, klientId: string): Promise<Posten[]> {
  await initPostenTabelle();
  const { rows } = await pool.query(
    `SELECT ${POSTEN_SPALTEN} FROM abrechnungsposten p LEFT JOIN customers c ON c.id = p.klient_id
      WHERE p.brand = $1 AND p.klient_id = $2 AND p.is_test_data = false
      ORDER BY p.datum DESC, p.created_at DESC LIMIT 500`,
    [brand, klientId]);
  return rows.map(zeileZuPosten);
}

export async function alleOffenenPosten(brand: string): Promise<Posten[]> {
  await initPostenTabelle();
  const { rows } = await pool.query(
    `SELECT ${POSTEN_SPALTEN} FROM abrechnungsposten p LEFT JOIN customers c ON c.id = p.klient_id
      WHERE p.brand = $1 AND p.zustand = 'offen' AND p.is_test_data = false
      ORDER BY p.datum`,
    [brand]);
  return rows.map(zeileZuPosten);
}

/**
 * „nicht abrechnen“ ↔ „offen“ umschalten (K14). Posten auf einer Rechnung
 * (Entwurf oder abgerechnet) bleiben unverändert. Liefert true bei Erfolg.
 */
/** Ein Terminposten, dessen Termin nachträglich abgesagt wurde (Vermerk von neutralisiereAbgesagteTermine). */
export const VERMERK_TERMIN_ABGESAGT = 'Termin abgesagt';
const ABGESAGT_SQL = `(herkunft = 'termin' AND COALESCE(notiz, '') LIKE '%${VERMERK_TERMIN_ABGESAGT}%')`;

export function terminAbgesagt(p: Pick<Posten, 'herkunft' | 'notiz'>): boolean {
  return p.herkunft === 'termin' && (p.notiz ?? '').includes(VERMERK_TERMIN_ABGESAGT);
}

export async function setzeAbrechnen(brand: string, postenId: string, abrechnen: boolean): Promise<boolean> {
  await initPostenTabelle();
  const { rowCount } = await pool.query(
    `UPDATE abrechnungsposten SET zustand = $3, updated_at = now()
      WHERE brand = $1 AND id = $2 AND zustand IN ('offen','nicht_abrechnen')
        -- Prüfung L2 (N1): ein abgesagter Termin lässt sich nicht wieder öffnen.
        AND NOT ($3 = 'offen' AND ${ABGESAGT_SQL})`,
    [brand, postenId, abrechnen ? 'offen' : 'nicht_abrechnen']);
  return (rowCount ?? 0) > 0;
}

/**
 * Übernimmt vergangene, freigegebene Termine als Posten (T6). Läuft beim Öffnen von
 * Akte und Übersicht und vor jeder Abrechnung; jeder Termin höchstens einmal
 * (eindeutiger Index auf herkunft_ref). Liefert die Zahl neuer Posten.
 */
export async function verbucheVergangeneTermine(
  brand: string,
  findeLeistung: (key: string) => Promise<Leistung | null>,
  jetzt: Date = new Date(),
): Promise<number> {
  await initPostenTabelle();
  const { rows } = await pool.query(
    `SELECT i.id::text AS id, i.payload, COALESCE(i.is_test_data, false) AS is_test_data,
            (SELECT c.id FROM customers c WHERE lower(c.email) = lower(i.payload->>'email') LIMIT 1) AS klient_id
       FROM inbox_items i
      WHERE i.type = 'booking'
        AND (i.payload ? 'freigegebenAm' OR (i.payload->>'adminCreated' = 'true' AND i.created_at >= '2026-10-21T00:00:00Z'))
        AND (i.payload->>'slotEnd') IS NOT NULL
        AND COALESCE(i.payload->>'state', '') <> 'storniert'
        AND NOT EXISTS (SELECT 1 FROM abrechnungsposten a
                         WHERE a.brand = $1 AND a.herkunft = 'termin' AND a.herkunft_ref = i.id::text)`,
    // Prüfung L2 (B7, N4): Ob der Termin vorbei ist, prüft termineZuPosten im Programm –
    // ein ungültiger Zeitwert in einer einzelnen Buchung kann die Abfrage so nie abbrechen.
    [brand]);
  if (rows.length === 0) return 0;

  const keys = new Set<string>();
  for (const r of rows) {
    const k = text(r.payload?.leistungKey) ?? text(r.payload?.serviceKey);
    if (k) keys.add(k);
  }
  const katalog = new Map<string, Leistung | null>();
  for (const k of keys) katalog.set(k, await findeLeistung(k));

  const neu = termineZuPosten(
    rows.map((r: Record<string, unknown>) => ({
      id: r.id as string, klientId: (r.klient_id as string | null) ?? null,
      isTestData: r.is_test_data === true, payload: (r.payload as Record<string, unknown>) ?? {},
    })),
    jetzt,
    (k) => katalog.get(k) ?? null,
  );
  let angelegt = 0;
  for (const p of neu) {
    const res = await pool.query(
      `INSERT INTO abrechnungsposten (brand, klient_id, herkunft, herkunft_ref, leistung_key, datum, text,
         menge, einheit, einzelpreis, zustand, notiz, is_test_data)
       VALUES ($1,$2,'termin',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT DO NOTHING`,
      [brand, p.klientId, p.herkunftRef, p.leistungKey, p.datum, p.text, p.menge, p.einheit,
        p.einzelpreis, p.zustand, p.notiz, p.isTestData]);
    angelegt += res.rowCount ?? 0;
  }
  return angelegt;
}

/** Übernimmt abrechenbare Zeiteinträge als Posten (T7), je Eintrag höchstens einmal. */
export async function verbucheZeiten(
  brand: string,
  findeLeistung: (key: string) => Promise<Leistung | null>,
): Promise<number> {
  await initPostenTabelle();
  let rows: Record<string, unknown>[];
  try {
    ({ rows } = await pool.query(
      `SELECT t.id::text AS id, t.minutes, t.billable, t.rate_cents, t.leistung_key, t.description,
              t.entry_date::text AS datum, t.stripe_invoice_id, p.title,
              COALESCE(p.customer_id, pp.customer_id) AS klient_id
         FROM time_entries t
         JOIN public.customer_projects p ON p.id = t.project_id
         LEFT JOIN public.customer_projects pp ON pp.id = p.parent_id
        WHERE p.brand = $1 AND t.billable AND t.stripe_invoice_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM abrechnungsposten a
                           WHERE a.brand = $1 AND a.herkunft = 'zeit' AND a.herkunft_ref = t.id::text)`,
      [brand]));
  } catch {
    return 0; // Zeiterfassung noch nie benutzt (Tabelle fehlt)
  }
  if (rows.length === 0) return 0;

  const katalog = new Map<string, Leistung | null>();
  for (const r of rows) {
    const k = text(r.leistung_key);
    if (k && !katalog.has(k)) katalog.set(k, await findeLeistung(k));
  }
  const neu = zeitenZuPosten(rows.map((r) => ({
    id: r.id as string, klientId: (r.klient_id as string | null) ?? null, minuten: Number(r.minutes),
    abrechenbar: r.billable === true, satzCent: Number(r.rate_cents ?? 0), leistungKey: text(r.leistung_key),
    beschreibung: (r.description as string | null) ?? null, projektTitel: String(r.title ?? 'Projekt'),
    datum: r.datum as string, schonAbgerechnet: !!r.stripe_invoice_id,
  })), (k) => katalog.get(k) ?? null);

  let angelegt = 0;
  for (const p of neu) {
    const res = await pool.query(
      `INSERT INTO abrechnungsposten (brand, klient_id, herkunft, herkunft_ref, leistung_key, datum, text,
         menge, einheit, einzelpreis, zustand, notiz)
       VALUES ($1,$2,'zeit',$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT DO NOTHING`,
      [brand, p.klientId, p.herkunftRef, p.leistungKey, p.datum, p.text, p.menge, p.einheit,
        p.einzelpreis, p.zustand, p.notiz]);
    angelegt += res.rowCount ?? 0;
  }
  return angelegt;
}

/** Holt alles Abrechenbare aus Terminen und Zeiterfassung (vor Akte, Übersicht, Abrechnung). */
export async function verbucheQuellen(
  brand: string,
  findeLeistung: (key: string) => Promise<Leistung | null>,
): Promise<void> {
  await verbucheVergangeneTermine(brand, findeLeistung).catch(() => 0);
  await verbucheZeiten(brand, findeLeistung).catch(() => 0);
  await neutralisiereAbgesagteTermine(brand).catch(() => 0);
  await verbucheAusfaelle(brand, findeLeistung).catch(() => 0);
}

/**
 * Prüfung L2 (B1, B2): Wurde ein Termin abgesagt oder abgelehnt, nachdem er schon
 * Posten geworden ist, wird dieser Terminposten nicht abgerechnet – sonst käme bei
 * „Nicht erschienen“ der volle Preis plus Ausfallhonorar, bei „Ich habe abgesagt“
 * der volle Preis. Posten auf einer Rechnung bleiben unberührt.
 */
export async function neutralisiereAbgesagteTermine(brand: string): Promise<number> {
  await initPostenTabelle();
  const { rowCount } = await pool.query(
    `UPDATE abrechnungsposten a
        SET zustand = 'nicht_abrechnen',
            notiz = CASE WHEN a.notiz IS NULL OR a.notiz = '' THEN 'Termin abgesagt' ELSE a.notiz || ' · Termin abgesagt' END,
            updated_at = now()
       FROM inbox_items i
      WHERE a.brand = $1 AND a.herkunft = 'termin' AND a.herkunft_ref = i.id::text
        AND a.zustand = 'offen'
        AND (i.payload->>'state' = 'storniert' OR i.payload->>'abgelehnt' = 'true')`,
    [brand]);
  return rowCount ?? 0;
}

/** Preis eines offenen Postens nachtragen oder ändern (z. B. „nach Vereinbarung“). */
export async function setzePostenPreis(brand: string, postenId: string, preis: number): Promise<boolean> {
  await initPostenTabelle();
  const { rowCount } = await pool.query(
    `UPDATE abrechnungsposten SET einzelpreis = $3,
       notiz = CASE WHEN notiz = 'Preis fehlt – bitte eintragen' THEN NULL ELSE notiz END,
       updated_at = now()
      WHERE brand = $1 AND id = $2 AND zustand IN ('offen','nicht_abrechnen')`,
    [brand, postenId, preis]);
  return (rowCount ?? 0) > 0;
}

export async function legeAuftragAn(brand: string, klientId: string, titel: string): Promise<string> {
  await initPostenTabelle();
  const { rows } = await pool.query(
    'INSERT INTO auftraege (brand, klient_id, titel) VALUES ($1,$2,$3) RETURNING id', [brand, klientId, titel]);
  return rows[0].id as string;
}

export async function auftraegeDesKlienten(brand: string, klientId: string): Promise<Auftrag[]> {
  await initPostenTabelle();
  const { rows } = await pool.query(
    `SELECT id, klient_id, titel, created_at::text AS created_at FROM auftraege
      WHERE brand = $1 AND klient_id = $2 ORDER BY created_at DESC`, [brand, klientId]);
  return rows.map((r: Record<string, unknown>) => ({
    id: r.id as string, klientId: r.klient_id as string, titel: r.titel as string, createdAt: r.created_at as string,
  }));
}

export async function klientDesAuftrags(brand: string, auftragId: string): Promise<string | null> {
  await initPostenTabelle();
  const { rows } = await pool.query('SELECT klient_id FROM auftraege WHERE brand = $1 AND id = $2', [brand, auftragId]);
  return (rows[0]?.klient_id as string | undefined) ?? null;
}

export async function legePositionAn(brand: string, klientId: string, auftragId: string, w: PositionWerte): Promise<string> {
  await initPostenTabelle();
  const { rows } = await pool.query(
    `INSERT INTO abrechnungsposten (brand, klient_id, herkunft, auftrag_id, datum, text, menge, einheit, einzelpreis, zustand)
     VALUES ($1,$2,'auftrag',$3,$4,$5,$6,$7,$8,'offen') RETURNING id`,
    [brand, klientId, auftragId, w.datum, w.text, w.menge, w.einheit, w.einzelpreis]);
  return rows[0].id as string;
}

/** K10: Position eines Auftrags ändern – nur solange sie auf keiner Rechnung steht. */
export async function aenderePosition(brand: string, postenId: string, w: PositionWerte): Promise<boolean> {
  await initPostenTabelle();
  const { rowCount } = await pool.query(
    `UPDATE abrechnungsposten SET datum=$3, text=$4, menge=$5, einheit=$6, einzelpreis=$7, updated_at=now()
      WHERE brand=$1 AND id=$2 AND herkunft='auftrag' AND zustand IN ('offen','nicht_abrechnen')`,
    [brand, postenId, w.datum, w.text, w.menge, w.einheit, w.einzelpreis]);
  return (rowCount ?? 0) > 0;
}

export async function klientDesPostens(brand: string, postenId: string): Promise<string | null> {
  await initPostenTabelle();
  const { rows } = await pool.query('SELECT klient_id FROM abrechnungsposten WHERE brand = $1 AND id = $2', [brand, postenId]);
  return (rows[0]?.klient_id as string | undefined) ?? null;
}
