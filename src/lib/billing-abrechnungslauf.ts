// Rechnungswesen Stufe 3, T10b: Abrechnungsart je Klient (K26), Entwurf je Sitzung (K27)
// und Monatslauf (K28, K29). Es entstehen nur Entwürfe; verschickt und festgeschrieben
// wird erst nach Geralds Prüfung unter Rechnungen → Entwürfe.
import { pool } from './website-db';
import { ladeRegeln, type Abrechnungsart, type Regeln } from './billing-regeln';
import { alleOffenenPosten, initPostenTabelle, verbucheQuellen, type Posten } from './billing-posten';
import { holeLeistung } from './billing-leistungen';
import { listKlienten, type Klient } from './klientenakte';
import { erstelleEntwurfAusPosten } from './billing-entwurf';

type KlientArt = Pick<Klient, 'id' | 'abrechnungsart' | 'rechnung_an' | 'rechnung_firma'>;

/** Eigene Einstellung des Klienten, sonst Voreinstellung für Firma bzw. Privat (K26). */
export function wirksameAbrechnungsart(k: Omit<KlientArt, 'id'>, regeln: Regeln): Abrechnungsart {
  if (k.abrechnungsart === 'monatlich' || k.abrechnungsart === 'je_sitzung') return k.abrechnungsart;
  return k.rechnung_an === 'firma' && k.rechnung_firma ? regeln.abrechnungsartFirma : regeln.abrechnungsartPrivat;
}

/** Abgerechnet wird am Monatsersten der Vormonat (deutsche Zeit). */
export function vormonat(jetzt: Date): { jahr: number; monat: number } {
  const [j, m] = jetzt.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }).split('-').map(Number);
  return m === 1 ? { jahr: j - 1, monat: 12 } : { jahr: j, monat: m - 1 };
}

export function monatsende(jahr: number, monat: number): string {
  const tag = new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
  return `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
}

export interface Plan { klientId: string; postenIds: string[] }

const abrechenbar = (p: Posten) => p.zustand === 'offen' && p.einzelpreis !== null;

/**
 * K28: je Klient „monatlich“ ein Entwurf mit allen offenen Posten bis Monatsende
 * (auch ältere, die noch offen sind). K29: Klienten, für die der Monat schon lief, nicht.
 */
export function planeMonatslauf(
  posten: Posten[], art: (klientId: string) => Abrechnungsart, bis: string, schonGelaufen: Set<string>,
): Plan[] {
  const je = new Map<string, string[]>();
  for (const p of posten) {
    if (!abrechenbar(p) || p.datum > bis || art(p.klientId) !== 'monatlich' || schonGelaufen.has(p.klientId)) continue;
    je.set(p.klientId, [...(je.get(p.klientId) ?? []), p.id]);
  }
  return [...je].map(([klientId, postenIds]) => ({ klientId, postenIds }));
}

/** K27: für jeden offenen Posten eines Klienten „je Sitzung“ ein eigener Entwurf. */
export function planeJeSitzung(posten: Posten[], art: (klientId: string) => Abrechnungsart): Plan[] {
  return posten
    .filter((p) => abrechenbar(p) && p.autoEntwurf !== false && art(p.klientId) === 'je_sitzung')
    .map((p) => ({ klientId: p.klientId, postenIds: [p.id] }));
}

// ── Datenbank ───────────────────────────────────────────────────────────────

// Die Tabelle abrechnungslaeufe legt initPostenTabelle an (Verwerfen löscht dort den Vermerk).

async function klientenMitArt(brand: string): Promise<{ klienten: Map<string, Klient>; art: (id: string) => Abrechnungsart }> {
  const [liste, regeln] = await Promise.all([listKlienten(), ladeRegeln(brand)]);
  const klienten = new Map(liste.map((k) => [k.id, k]));
  return { klienten, art: (id) => { const k = klienten.get(id); return k ? wirksameAbrechnungsart(k, regeln) : 'je_sitzung'; } };
}

export interface LaufErgebnis { angelegt: number; fehler: string[] }

/** K27: legt für offene Posten von Klienten „je Sitzung“ je einen Entwurf an. */
export async function entwuerfeJeSitzung(brand: string, nurKlient?: string): Promise<LaufErgebnis> {
  await initPostenTabelle();
  const { klienten, art } = await klientenMitArt(brand);
  const offen = (await alleOffenenPosten(brand)).filter((p) => !nurKlient || p.klientId === nurKlient);
  const ergebnis: LaufErgebnis = { angelegt: 0, fehler: [] };
  for (const plan of planeJeSitzung(offen, art)) {
    const klient = klienten.get(plan.klientId);
    if (!klient) continue;
    const r = await erstelleEntwurfAusPosten(brand, klient, plan.postenIds).catch((e: Error) => ({ ok: false as const, fehler: e.message }));
    if (r.ok) ergebnis.angelegt += 1; else ergebnis.fehler.push(`${klient.name}: ${r.fehler}`);
  }
  return ergebnis;
}

/** Holt neue Posten aus Terminen und Zeiterfassung und legt danach die Entwürfe „je Sitzung“ an. */
export async function verbucheUndEntwerfe(brand: string): Promise<void> {
  await verbucheQuellen(brand, (k) => holeLeistung(brand, k));
  await entwuerfeJeSitzung(brand).catch(() => ({ angelegt: 0, fehler: [] }));
}

/**
 * K28, K29: Monatslauf für einen Monat. Der Lauf wird je Klient zuerst vermerkt (eindeutig je
 * Klient und Monat); ist er schon vermerkt, passiert nichts. Scheitert der Entwurf, wird der
 * Vermerk zurückgenommen. Verwirft Gerald den Entwurf, darf der Monat erneut laufen.
 */
export async function monatslauf(
  brand: string, jahr: number, monat: number, opts: { nurPlanen?: boolean } = {},
): Promise<LaufErgebnis & { monat: string; uebersprungen: number; geplant: { klient: string; posten: number }[] }> {
  await initPostenTabelle();
  await verbucheQuellen(brand, (k) => holeLeistung(brand, k));
  const kennung = `${jahr}-${String(monat).padStart(2, '0')}`;
  const { klienten, art } = await klientenMitArt(brand);
  const gelaufen = new Set<string>((await pool.query(
    'SELECT klient_id::text AS klient_id FROM abrechnungslaeufe WHERE brand = $1 AND monat = $2', [brand, kennung],
  )).rows.map((r: { klient_id: string }) => r.klient_id));
  const offen = await alleOffenenPosten(brand);
  const plaene = planeMonatslauf(offen, art, monatsende(jahr, monat), gelaufen);

  const geplant = plaene.map((p) => ({ klient: klienten.get(p.klientId)?.name ?? '', posten: p.postenIds.length }));
  const ergebnis = { angelegt: 0, fehler: [] as string[], monat: kennung, uebersprungen: 0, geplant };
  if (opts.nurPlanen) return ergebnis;
  for (const plan of plaene) {
    const klient = klienten.get(plan.klientId);
    if (!klient) continue;
    const vermerkt = await pool.query(
      `INSERT INTO abrechnungslaeufe (brand, klient_id, monat) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [brand, plan.klientId, kennung]);
    if ((vermerkt.rowCount ?? 0) === 0) { ergebnis.uebersprungen += 1; continue; }
    const r = await erstelleEntwurfAusPosten(brand, klient, plan.postenIds).catch((e: Error) => ({ ok: false as const, fehler: e.message }));
    if (r.ok) {
      await pool.query('UPDATE abrechnungslaeufe SET invoice_id = $4 WHERE brand = $1 AND klient_id = $2 AND monat = $3',
        [brand, plan.klientId, kennung, r.invoiceId]);
      ergebnis.angelegt += 1;
    } else {
      await pool.query('DELETE FROM abrechnungslaeufe WHERE brand = $1 AND klient_id = $2 AND monat = $3', [brand, plan.klientId, kennung]);
      ergebnis.fehler.push(`${klient.name}: ${r.fehler}`);
    }
  }
  return ergebnis;
}
