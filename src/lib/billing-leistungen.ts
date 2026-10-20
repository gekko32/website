// Rechnungswesen Stufe 3, T3/T4: Leistungen, die Gerald selbst pflegt
// (Spezifikation K1, K3, K4, K5, K6, K7). Eine Tabelle für Website, Buchung und
// Rechnung. Leistungen werden nie gelöscht, nur stillgelegt (K3).
import { pool } from './website-db';
import { bundleLeistungen } from './content-bundle';
import type { LeistungCategory, LeistungServiceRow } from '../content-schema/pages';

export interface Kategorie {
  id: string; titel: string; icon: string; beschreibung: string | null; sortierung: number;
}

export interface Leistung {
  key: string;
  kategorieId: string;
  name: string;
  beschreibung: string;
  /** Euro; darf nur bei „nach Vereinbarung“ fehlen und ist dann beim Erfassen einzutragen. */
  preis: number | null;
  /** Website zeigt „nach Vereinbarung“ statt des Preises; ein Preis kann trotzdem als Vorschlag hinterlegt sein. */
  nachVereinbarung: boolean;
  einheit: string;
  dauerMin: number | null;
  website: boolean;
  hervorheben: boolean;
  aktiv: boolean;
  sortierung: number;
}

/**
 * Stand der festen Liste im Programmcode am 20.10.2026 (vorher `SERVICES` in
 * stripe-billing.ts). Wird nur einmal beim ersten Start in die Tabelle übernommen;
 * danach gelten ausschließlich die gepflegten Werte.
 */
export const STARTLISTE_CODE_2026_10: readonly { key: string; name: string; cents: number; unit: string }[] = [
  { key: 'erstgespraech', name: 'Kostenloses Erstgespräch', cents: 0, unit: 'Einheit' },
  { key: 'callback', name: 'Rückruf', cents: 0, unit: 'Einheit' },
  { key: 'meeting', name: 'Online-Meeting', cents: 0, unit: 'Einheit' },
  { key: 'termin', name: 'Termin vor Ort', cents: 0, unit: 'Einheit' },
  { key: '50plus-digital-einzel', name: '50+ digital — Einzelbegleitung', cents: 6000, unit: 'Stunde' },
  { key: '50plus-digital-gruppe', name: '50+ digital — Kleine Gruppe', cents: 4000, unit: 'Person/Stunde' },
  { key: '50plus-digital-5er', name: '50+ digital — 5er-Paket', cents: 27000, unit: 'Paket' },
  { key: '50plus-digital-10er', name: '50+ digital — 10er-Paket', cents: 50000, unit: 'Paket' },
  { key: 'coaching-session', name: 'Führungskräfte-Coaching — Einzelsession (90 Min.)', cents: 15000, unit: 'Session' },
  { key: 'coaching-6er', name: 'Führungskräfte-Coaching — 6er-Paket', cents: 80000, unit: 'Paket' },
  { key: 'coaching-intensiv', name: 'Führungskräfte-Coaching — Intensiv-Tag (6 Std.)', cents: 50000, unit: 'Tag' },
  { key: 'beratung-tag', name: 'Unternehmensberatung — Tagessatz', cents: 100000, unit: 'Tag' },
];

const ZUSATZ_KATEGORIEN: Record<string, { titel: string; icon: string }> = {
  'fuehrungskraefte': { titel: 'Führungskräfte-Coaching', icon: '🎯' },
  'digital-50plus': { titel: '50+ digital', icon: '💻' },
  'beratung': { titel: 'Unternehmensberatung', icon: '🏢' },
  'termine': { titel: 'Termine & Gespräche', icon: '📅' },
};

function kategorieFuerCodeKey(key: string): string {
  if (key.startsWith('coaching')) return 'fuehrungskraefte';
  if (key.startsWith('50plus')) return 'digital-50plus';
  if (key.startsWith('beratung')) return 'beratung';
  return 'termine';
}

const istPaket = (key: string, name: string) => /paket|-\d+er$/i.test(key) || /paket/i.test(name);

/** Startliste nach Entscheidung vom 20.10.2026: beide Listen, Pakete stillgelegt. */
export function startlisteAus(
  website: LeistungCategory[],
  code: readonly { key: string; name: string; cents: number; unit: string }[],
): { kategorien: Kategorie[]; leistungen: Leistung[] } {
  const kategorien: Kategorie[] = website.map((c, i) => ({
    id: c.id, titel: c.title, icon: c.icon, beschreibung: c.description ?? null, sortierung: i + 1,
  }));
  const leistungen: Leistung[] = [];

  website.forEach((c) => c.services.forEach((s: LeistungServiceRow, i) => {
    const nv = !/\d/.test(s.price);
    const zahl = Number.parseFloat(s.price.replace(/[^\d,]/g, '').replace(',', '.'));
    leistungen.push({
      key: s.key, kategorieId: c.id, name: s.name, beschreibung: s.desc ?? '',
      preis: nv || !Number.isFinite(zahl) ? null : zahl, nachVereinbarung: nv || !Number.isFinite(zahl),
      einheit: (s.unit ?? '').replace(/^\s*\/\s*/, '').trim(),
      dauerMin: s.durationMin ?? null, website: true, hervorheben: s.highlight === true,
      aktiv: !istPaket(s.key, s.name), sortierung: i + 1,
    });
  }));

  code.forEach((c, i) => {
    // Gleicher Schlüssel in beiden Listen: Website-Text bleibt, der Rechnungspreis
    // wird übernommen (Website zeigt weiter „nach Vereinbarung“).
    const doppelt = leistungen.find((l) => l.key === c.key);
    if (doppelt) {
      if (doppelt.preis === null) doppelt.preis = c.cents / 100;
      return;
    }
    const kategorieId = kategorieFuerCodeKey(c.key);
    if (!kategorien.some((k) => k.id === kategorieId)) {
      const z = ZUSATZ_KATEGORIEN[kategorieId];
      kategorien.push({ id: kategorieId, titel: z.titel, icon: z.icon, beschreibung: null, sortierung: kategorien.length + 1 });
    }
    leistungen.push({
      key: c.key, kategorieId, name: c.name, beschreibung: '', preis: c.cents / 100, nachVereinbarung: false,
      einheit: c.unit, dauerMin: null, website: false, hervorheben: false,
      aktiv: !istPaket(c.key, c.name), sortierung: 100 + i,
    });
  });

  return { kategorien, leistungen };
}

export function preisAnzeige(l: Pick<Leistung, 'preis' | 'nachVereinbarung'>): string {
  if (l.nachVereinbarung || l.preis === null) return 'nach Vereinbarung';
  if (l.preis === 0) return 'kostenlos';
  const mitCent = !Number.isInteger(l.preis);
  return `${l.preis.toLocaleString('de-DE', { minimumFractionDigits: mitCent ? 2 : 0, maximumFractionDigits: 2 })} €`;
}

/** Form, die die Website-Seite Leistungen erwartet: nur aktive Website-Leistungen (K6, K7). */
export function websiteKategorien(kategorien: Kategorie[], leistungen: Leistung[]): LeistungCategory[] {
  return [...kategorien]
    .sort((a, b) => a.sortierung - b.sortierung)
    .map((k) => ({
      id: k.id, title: k.titel, icon: k.icon, ...(k.beschreibung ? { description: k.beschreibung } : {}),
      services: leistungen
        .filter((l) => l.kategorieId === k.id && l.aktiv && l.website)
        .sort((a, b) => a.sortierung - b.sortierung)
        .map((l) => ({
          key: l.key, name: l.name, price: preisAnzeige(l), unit: l.einheit ? `/ ${l.einheit}` : '',
          desc: l.beschreibung, ...(l.hervorheben ? { highlight: true } : {}),
          ...(l.dauerMin ? { durationMin: l.dauerMin } : {}),
          // Zeiterfassung belegt den Stundensatz damit vor (Prüfung Runde 1, Befund 9).
          ...(l.preis !== null && /stunde/i.test(l.einheit) ? { stundensatz_cents: Math.round(l.preis * 100) } : {}),
        })),
    }))
    .filter((c) => c.services.length > 0);
}

/**
 * Öffentliche Buchung: Beide Felder (serviceKey, leistungKey) dürfen nur Leistungen
 * aus dem öffentlichen Katalog nennen (K7). Liefert den ersten unbekannten Schlüssel.
 */
export function unbekannteBuchungsLeistung(
  katalog: LeistungCategory[],
  felder: { serviceKey?: unknown; leistungKey?: unknown },
): string | null {
  const erlaubt = new Set(katalog.flatMap((c) => c.services.map((s) => s.key)));
  for (const wert of [felder.serviceKey, felder.leistungKey]) {
    if (wert === undefined || wert === null || wert === '') continue;
    if (typeof wert !== 'string' || !erlaubt.has(wert)) return String(wert);
  }
  return null;
}

/** Nur aktive Leistungen mit Preis über 0 dürfen automatisch abgerechnet werden (K3). */
export function abrechenbar(l: Pick<Leistung, 'aktiv' | 'preis'> | null | undefined): boolean {
  return !!l && l.aktiv && l.preis !== null && l.preis > 0;
}

export function schluesselAus(name: string, vorhanden: string[]): string {
  const basis = name.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'leistung';
  if (!vorhanden.includes(basis)) return basis;
  let n = 2;
  while (vorhanden.includes(`${basis}-${n}`)) n++;
  return `${basis}-${n}`;
}

export interface LeistungEingabe {
  name?: string; kategorieId?: string; beschreibung?: string; preis?: string;
  nachVereinbarung?: boolean; einheit?: string; dauerMin?: string;
  website?: boolean; hervorheben?: boolean;
}

export type LeistungWerte = Omit<Leistung, 'key' | 'aktiv' | 'sortierung'>;

export function pruefeLeistung(e: LeistungEingabe, kategorieIds: string[]): { werte: LeistungWerte | null; fehler: { key: string; meldung: string }[] } {
  const fehler: { key: string; meldung: string }[] = [];
  const name = (e.name ?? '').trim();
  if (name.length < 2 || name.length > 120) fehler.push({ key: 'name', meldung: 'Bitte einen Namen mit 2 bis 120 Zeichen eintragen.' });

  const kategorieId = (e.kategorieId ?? '').trim();
  if (!kategorieIds.includes(kategorieId)) fehler.push({ key: 'kategorieId', meldung: 'Bitte eine Kategorie wählen.' });

  const nachVereinbarung = e.nachVereinbarung === true;
  const preisRoh = (e.preis ?? '').trim().replace(',', '.');
  let preis: number | null = null;
  if (preisRoh === '') {
    if (!nachVereinbarung) fehler.push({ key: 'preis', meldung: 'Bitte einen Preis eintragen (0 ist erlaubt) oder „nach Vereinbarung“ wählen.' });
  } else if (!/^\d+(\.\d{1,2})?$/.test(preisRoh)) {
    fehler.push({ key: 'preis', meldung: 'Der Preis muss eine Zahl ab 0 mit höchstens zwei Nachkommastellen sein.' });
  } else {
    preis = Number(preisRoh);
  }

  const dauerRoh = (e.dauerMin ?? '').trim();
  let dauerMin: number | null = null;
  if (dauerRoh !== '') {
    if (!/^\d+$/.test(dauerRoh) || Number(dauerRoh) < 1 || Number(dauerRoh) > 1440) {
      fehler.push({ key: 'dauerMin', meldung: 'Die Dauer muss eine ganze Zahl von 1 bis 1440 Minuten sein.' });
    } else dauerMin = Number(dauerRoh);
  }

  const einheit = (e.einheit ?? '').trim();
  if (einheit.length > 40) fehler.push({ key: 'einheit', meldung: 'Die Einheit darf höchstens 40 Zeichen haben.' });

  if ((e.beschreibung ?? '').trim().length > 1000) {
    fehler.push({ key: 'beschreibung', meldung: 'Die Beschreibung darf höchstens 1000 Zeichen haben.' });
  }

  if (fehler.length > 0) return { werte: null, fehler };
  return {
    werte: {
      name, kategorieId, beschreibung: (e.beschreibung ?? '').trim(), preis: nachVereinbarung && preis === null ? null : preis,
      nachVereinbarung, einheit, dauerMin, website: e.website === true, hervorheben: e.hervorheben === true,
    },
    fehler,
  };
}

// ── Datenbank ───────────────────────────────────────────────────────────────

let tabellenBereit: Promise<void> | null = null;

export function initLeistungenTabellen(brand: string): Promise<void> {
  tabellenBereit ??= (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leistungs_kategorien (
        brand        TEXT NOT NULL,
        id           TEXT NOT NULL,
        titel        TEXT NOT NULL,
        icon         TEXT NOT NULL DEFAULT '',
        beschreibung TEXT,
        sortierung   INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (brand, id)
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leistungen (
        brand             TEXT NOT NULL,
        key               TEXT NOT NULL,
        kategorie_id      TEXT NOT NULL,
        name              TEXT NOT NULL,
        beschreibung      TEXT NOT NULL DEFAULT '',
        preis             NUMERIC(12,2) CHECK (preis IS NULL OR preis >= 0),
        nach_vereinbarung BOOLEAN NOT NULL DEFAULT false,
        einheit           TEXT NOT NULL DEFAULT '',
        dauer_min         INTEGER,
        website           BOOLEAN NOT NULL DEFAULT false,
        hervorheben       BOOLEAN NOT NULL DEFAULT false,
        aktiv             BOOLEAN NOT NULL DEFAULT true,
        sortierung        INTEGER NOT NULL DEFAULT 0,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (brand, key),
        CHECK (preis IS NOT NULL OR nach_vereinbarung)
      )`);
  })().catch((err) => { tabellenBereit = null; throw err; });
  return tabellenBereit.then(() => befuelleEinmal(brand));
}

const befuellt = new Set<string>();

async function befuelleEinmal(brand: string): Promise<void> {
  if (befuellt.has(brand)) return;
  const { rows } = await pool.query('SELECT 1 FROM leistungen WHERE brand = $1 LIMIT 1', [brand]);
  if (rows.length === 0) {
    // Die feste Code-Liste gehörte nur zu mentolder; andere Marken starten mit ihrer Inhaltsdatei.
    const { kategorien, leistungen } = startlisteAus(bundleLeistungen(brand), brand === 'mentolder' ? STARTLISTE_CODE_2026_10 : []);
    // Alles oder nichts: Bricht die Erstbefüllung ab, bleibt keine halbe Liste zurück
    // (sonst gälte „Zeilen vorhanden“ und der Rest käme nie). Prüfung Runde 1, Befund 8.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const k of kategorien) {
        await client.query(
          `INSERT INTO leistungs_kategorien (brand, id, titel, icon, beschreibung, sortierung)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [brand, k.id, k.titel, k.icon, k.beschreibung, k.sortierung]);
      }
      for (const l of leistungen) {
        await client.query(
          `INSERT INTO leistungen (brand, key, kategorie_id, name, beschreibung, preis, nach_vereinbarung,
             einheit, dauer_min, website, hervorheben, aktiv, sortierung)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
          [brand, l.key, l.kategorieId, l.name, l.beschreibung, l.preis, l.nachVereinbarung,
            l.einheit, l.dauerMin, l.website, l.hervorheben, l.aktiv, l.sortierung]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  befuellt.add(brand);
}

function zeileZuLeistung(r: Record<string, unknown>): Leistung {
  return {
    key: r.key as string, kategorieId: r.kategorie_id as string, name: r.name as string,
    beschreibung: (r.beschreibung as string) ?? '',
    preis: r.preis === null || r.preis === undefined ? null : Number(r.preis),
    nachVereinbarung: r.nach_vereinbarung === true, einheit: (r.einheit as string) ?? '',
    dauerMin: r.dauer_min === null || r.dauer_min === undefined ? null : Number(r.dauer_min),
    website: r.website === true, hervorheben: r.hervorheben === true, aktiv: r.aktiv === true,
    sortierung: Number(r.sortierung ?? 0),
  };
}

export async function listeKategorien(brand: string): Promise<Kategorie[]> {
  await initLeistungenTabellen(brand);
  const { rows } = await pool.query(
    'SELECT id, titel, icon, beschreibung, sortierung FROM leistungs_kategorien WHERE brand = $1 ORDER BY sortierung, titel',
    [brand]);
  return rows.map((r: Record<string, unknown>) => ({
    id: r.id as string, titel: r.titel as string, icon: (r.icon as string) ?? '',
    beschreibung: (r.beschreibung as string | null) ?? null, sortierung: Number(r.sortierung ?? 0),
  }));
}

export async function listeLeistungen(brand: string, opts: { nurAktiv?: boolean } = {}): Promise<Leistung[]> {
  await initLeistungenTabellen(brand);
  const { rows } = await pool.query(
    `SELECT * FROM leistungen WHERE brand = $1 ${opts.nurAktiv ? 'AND aktiv' : ''} ORDER BY kategorie_id, sortierung, name`,
    [brand]);
  return rows.map(zeileZuLeistung);
}

export async function holeLeistung(brand: string, key: string): Promise<Leistung | null> {
  await initLeistungenTabellen(brand);
  const { rows } = await pool.query('SELECT * FROM leistungen WHERE brand = $1 AND key = $2', [brand, key]);
  return rows[0] ? zeileZuLeistung(rows[0]) : null;
}

/** Neue Leistung (key = null) oder Änderung einer bestehenden. Liefert den Schlüssel. */
export async function speichereLeistung(brand: string, key: string | null, w: LeistungWerte): Promise<string> {
  await initLeistungenTabellen(brand);
  if (key) {
    await pool.query(
      `UPDATE leistungen SET kategorie_id=$3, name=$4, beschreibung=$5, preis=$6, nach_vereinbarung=$7,
         einheit=$8, dauer_min=$9, website=$10, hervorheben=$11, updated_at=now()
       WHERE brand=$1 AND key=$2`,
      [brand, key, w.kategorieId, w.name, w.beschreibung, w.preis, w.nachVereinbarung,
        w.einheit, w.dauerMin, w.website, w.hervorheben]);
    return key;
  }
  const { rows } = await pool.query('SELECT key FROM leistungen WHERE brand = $1', [brand]);
  const neu = schluesselAus(w.name, rows.map((r: { key: string }) => r.key));
  await pool.query(
    `INSERT INTO leistungen (brand, key, kategorie_id, name, beschreibung, preis, nach_vereinbarung,
       einheit, dauer_min, website, hervorheben, aktiv, sortierung)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,
       (SELECT COALESCE(MAX(sortierung),0)+1 FROM leistungen WHERE brand=$1 AND kategorie_id=$3))`,
    [brand, neu, w.kategorieId, w.name, w.beschreibung, w.preis, w.nachVereinbarung,
      w.einheit, w.dauerMin, w.website, w.hervorheben]);
  return neu;
}

/** Stilllegen bzw. wieder aktivieren. Löschen gibt es nicht (K3). */
export async function setzeLeistungAktiv(brand: string, key: string, aktiv: boolean): Promise<void> {
  await initLeistungenTabellen(brand);
  await pool.query('UPDATE leistungen SET aktiv=$3, updated_at=now() WHERE brand=$1 AND key=$2', [brand, key, aktiv]);
}

/** Ohne Datenbank: Inhaltsdatei nach denselben Regeln (Pakete stillgelegt). */
function rueckfallKatalog(brand: string): LeistungCategory[] {
  const { kategorien, leistungen } = startlisteAus(bundleLeistungen(brand), []);
  return websiteKategorien(kategorien, leistungen);
}

/** Auswahl für Rechnungsformulare: aktive Leistungen mit Preis (T4). */
export async function leistungsOptionen(brand: string): Promise<{ key: string; name: string; cents: number }[]> {
  const alle = await listeLeistungen(brand, { nurAktiv: true });
  return alle
    .filter((l) => l.preis !== null)
    .map((l) => ({ key: l.key, name: l.name, cents: Math.round((l.preis as number) * 100) }));
}

/** Alle aktiven Leistungen (auch interne) in der Form des Website-Katalogs, für Admin-Seiten. */
export async function katalogIntern(brand: string): Promise<LeistungCategory[]> {
  try {
    const [kategorien, leistungen] = await Promise.all([listeKategorien(brand), listeLeistungen(brand, { nurAktiv: true })]);
    return websiteKategorien(kategorien, leistungen.map((l) => ({ ...l, website: true })));
  } catch {
    return rueckfallKatalog(brand);
  }
}

/** Website-Ansicht; ohne Datenbank fällt sie auf die Inhaltsdatei zurück. */
export async function websiteLeistungen(brand: string): Promise<LeistungCategory[]> {
  try {
    const [kategorien, leistungen] = await Promise.all([listeKategorien(brand), listeLeistungen(brand, { nurAktiv: true })]);
    return websiteKategorien(kategorien, leistungen);
  } catch {
    return rueckfallKatalog(brand);
  }
}
