// Rechnungswesen Stufe 3, T5: Abrechnungsposten – alles Abrechenbare an einer Stelle
// (Spezifikation K2, K11, K14, K16; später K12, K13, K18, K22 ff.).
// Ein Posten speichert Text, Menge und Einzelpreis zum Zeitpunkt der Erfassung;
// spätere Preisänderungen der Leistung ändern ihn nicht (K2).
import { pool } from './website-db';
import type { Leistung } from './billing-leistungen';

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
  einzelpreis: number;
  zustand: PostenZustand;
  invoiceId: string | null;
  notiz: string | null;
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

export interface KlientSumme { klientId: string; klientName: string; anzahl: number; summe: number }

/** Übersicht offener Posten je Klient, größte Summe zuerst (K16). */
export function summenJeKlient(posten: Posten[]): KlientSumme[] {
  const je = new Map<string, KlientSumme>();
  for (const p of posten) {
    if (p.zustand !== 'offen') continue;
    const s = je.get(p.klientId) ?? { klientId: p.klientId, klientName: p.klientName, anzahl: 0, summe: 0 };
    s.anzahl += 1;
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
        einzelpreis   NUMERIC(12,2) NOT NULL CHECK (einzelpreis >= 0),
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
  })().catch((err) => { tabelleBereit = null; throw err; });
  return tabelleBereit;
}

const POSTEN_SPALTEN = `p.id, p.klient_id, COALESCE(c.name, '') AS klient_name, p.herkunft, p.datum::text AS datum,
  p.leistung_key, p.text, p.menge, p.einheit, p.einzelpreis, p.zustand, p.invoice_id, p.notiz`;

function zeileZuPosten(r: Record<string, unknown>): Posten {
  return {
    id: r.id as string, klientId: r.klient_id as string, klientName: r.klient_name as string,
    herkunft: r.herkunft as Herkunft, datum: r.datum as string, leistungKey: (r.leistung_key as string | null) ?? null,
    text: r.text as string, menge: Number(r.menge), einheit: (r.einheit as string) ?? '', einzelpreis: Number(r.einzelpreis),
    zustand: r.zustand as PostenZustand, invoiceId: (r.invoice_id as string | null) ?? null, notiz: (r.notiz as string | null) ?? null,
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
export async function setzeAbrechnen(brand: string, postenId: string, abrechnen: boolean): Promise<boolean> {
  await initPostenTabelle();
  const { rowCount } = await pool.query(
    `UPDATE abrechnungsposten SET zustand = $3, updated_at = now()
      WHERE brand = $1 AND id = $2 AND zustand IN ('offen','nicht_abrechnen')`,
    [brand, postenId, abrechnen ? 'offen' : 'nicht_abrechnen']);
  return (rowCount ?? 0) > 0;
}

export async function klientDesPostens(brand: string, postenId: string): Promise<string | null> {
  await initPostenTabelle();
  const { rows } = await pool.query('SELECT klient_id FROM abrechnungsposten WHERE brand = $1 AND id = $2', [brand, postenId]);
  return (rows[0]?.klient_id as string | undefined) ?? null;
}
