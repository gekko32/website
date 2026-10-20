// Rechnungswesen Stufe 3, T9: Ausfallhonorar (Spezifikation K17–K21, AE8).
// Eine späte Absage durch den Kunden (oder Nichterscheinen) eines freigegebenen
// Termins wird zum Posten „Ausfallhonorar“. Maßgeblich ist die Regel, die zum
// Zeitpunkt der Absage galt (sie wird bei der Absage im Termin festgehalten).
import { pool } from './website-db';
import { ausfallBetrag, ladeRegeln, type Regeln } from './billing-regeln';
import type { Leistung } from './billing-leistungen';
import type { NeuerPosten, TerminZeile } from './billing-posten';

/** 'umbuchung' setzt der Kundenlink beim Verschieben: kein Ausfallhonorar. */
export type AbsageVon = 'kunde' | 'gerald' | 'nicht_erschienen' | 'umbuchung';

type AusfallRegel = Pick<Regeln, 'ausfallFristStunden' | 'ausfallArt' | 'ausfallWert'>;

const textWert = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

function regelAus(v: unknown, aktuell: Regeln): AusfallRegel {
  const r = v as Partial<AusfallRegel> | null | undefined;
  if (r && typeof r.ausfallFristStunden === 'number' && (r.ausfallArt === 'prozent' || r.ausfallArt === 'betrag')
      && typeof r.ausfallWert === 'number') {
    return { ausfallFristStunden: r.ausfallFristStunden, ausfallArt: r.ausfallArt, ausfallWert: r.ausfallWert };
  }
  return { ausfallFristStunden: aktuell.ausfallFristStunden, ausfallArt: aktuell.ausfallArt, ausfallWert: aktuell.ausfallWert };
}

const deDatum = (d: Date) => d.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' });
const isoDatum = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });

/** Welche abgesagten Termine ergeben ein Ausfallhonorar (K18, K19)? */
export function ausfaelleZuPosten(
  termine: TerminZeile[],
  regelnAktuell: Regeln,
  findeLeistung: (key: string) => Leistung | null,
): NeuerPosten[] {
  const neu: NeuerPosten[] = [];
  for (const t of termine) {
    const p = t.payload;
    if (!t.klientId) continue;
    if (p.state !== 'storniert') continue;
    if (!textWert(p.freigegebenAm) && p.adminCreated !== true) continue; // nur bestätigte Termine
    const von = (textWert(p.abgesagtVon) ?? 'kunde') as AbsageVon;
    if (von === 'gerald' || von === 'umbuchung') continue; // eigene Absage oder Verschieben kostet nichts
    const start = textWert(p.slotStart) ? new Date(p.slotStart as string) : null;
    const abgesagt = textWert(p.cancelledAt) ? new Date(p.cancelledAt as string) : null;
    if (!start || !abgesagt || Number.isNaN(start.getTime()) || Number.isNaN(abgesagt.getTime())) continue;

    const regel = regelAus(p.ausfallRegel, regelnAktuell);
    const stundenVorher = (start.getTime() - abgesagt.getTime()) / 3_600_000;
    const zuSpaet = von === 'nicht_erschienen' || stundenVorher < regel.ausfallFristStunden;
    if (!zuSpaet) continue;

    const key = textWert(p.leistungKey) ?? textWert(p.serviceKey);
    const leistung = key ? findeLeistung(key) : null;
    if (!leistung || leistung.preis === 0) continue; // kostenlose Termine kosten auch beim Ausfall nichts

    const regelVoll: Regeln = { ...regelnAktuell, ...regel };
    const einzelpreis = leistung.preis === null
      ? (regel.ausfallArt === 'betrag' ? ausfallBetrag(regelVoll, 0) : null)
      : ausfallBetrag(regelVoll, leistung.preis);
    if (einzelpreis === 0) continue;

    const grund = von === 'nicht_erschienen'
      ? 'Nicht erschienen'
      : `Absage ${Math.round(stundenVorher)} Std. vor Termin (Frist ${regel.ausfallFristStunden} Std.)`;
    neu.push({
      klientId: t.klientId, herkunftRef: t.id, isTestData: t.isTestData, leistungKey: leistung.key,
      datum: isoDatum(start), text: `Ausfallhonorar: ${leistung.name} am ${deDatum(start)}`,
      menge: 1, einheit: '', einzelpreis, zustand: 'offen',
      notiz: einzelpreis === null ? `${grund} · Preis fehlt – bitte eintragen` : grund,
    });
  }
  return neu;
}

/** Vermerk, wenn Gerald eine Absage einträgt (AE8); hält die geltende Regel fest. */
export function absageVermerk(von: AbsageVon, jetzt: Date, regeln: Regeln): Record<string, unknown> {
  return {
    state: 'storniert', outcome: 'storniert', cancelledAt: jetzt.toISOString(), abgesagtVon: von,
    ausfallRegel: { ausfallFristStunden: regeln.ausfallFristStunden, ausfallArt: regeln.ausfallArt, ausfallWert: regeln.ausfallWert },
  };
}

/** K21: Checkbox „AGB gelesen“ aus Formular oder JSON. */
export function agbBestaetigt(wert: unknown): boolean {
  return wert === true || wert === 'on' || wert === 'true';
}

// ── Datenbank ───────────────────────────────────────────────────────────────

/** Übernimmt späte Absagen als Posten „Ausfallhonorar“, je Termin höchstens einmal. */
export async function verbucheAusfaelle(
  brand: string,
  findeLeistung: (key: string) => Promise<Leistung | null>,
): Promise<number> {
  const { rows } = await pool.query(
    `SELECT i.id::text AS id, i.payload, COALESCE(i.is_test_data, false) AS is_test_data,
            (SELECT c.id FROM customers c WHERE lower(c.email) = lower(i.payload->>'email') LIMIT 1) AS klient_id
       FROM inbox_items i
      WHERE i.type = 'booking' AND i.payload->>'state' = 'storniert'
        AND (i.payload ? 'freigegebenAm' OR (i.payload->>'adminCreated' = 'true' AND i.created_at >= '2026-10-20T00:00:00Z'))
        AND NOT EXISTS (SELECT 1 FROM abrechnungsposten a
                         WHERE a.brand = $1 AND a.herkunft = 'ausfall' AND a.herkunft_ref = i.id::text)
        -- Prüfung L2 (B1): steht der Termin selbst schon auf einer Rechnung, kein zusätzliches Ausfallhonorar.
        AND NOT EXISTS (SELECT 1 FROM abrechnungsposten t
                         WHERE t.brand = $1 AND t.herkunft = 'termin' AND t.herkunft_ref = i.id::text
                           AND t.zustand IN ('auf_entwurf','abgerechnet'))`,
    [brand]);
  if (rows.length === 0) return 0;
  const regeln = await ladeRegeln(brand);
  const katalog = new Map<string, Leistung | null>();
  for (const r of rows) {
    const k = textWert(r.payload?.leistungKey) ?? textWert(r.payload?.serviceKey);
    if (k && !katalog.has(k)) katalog.set(k, await findeLeistung(k));
  }
  const neu = ausfaelleZuPosten(rows.map((r: Record<string, unknown>) => ({
    id: r.id as string, klientId: (r.klient_id as string | null) ?? null,
    isTestData: r.is_test_data === true, payload: (r.payload as Record<string, unknown>) ?? {},
  })), regeln, (k) => katalog.get(k) ?? null);
  let angelegt = 0;
  for (const p of neu) {
    const res = await pool.query(
      `INSERT INTO abrechnungsposten (brand, klient_id, herkunft, herkunft_ref, leistung_key, datum, text,
         menge, einheit, einzelpreis, zustand, notiz, is_test_data)
       VALUES ($1,$2,'ausfall',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT DO NOTHING`,
      [brand, p.klientId, p.herkunftRef, p.leistungKey, p.datum, p.text, p.menge, p.einheit,
        p.einzelpreis, p.zustand, p.notiz, p.isTestData]);
    angelegt += res.rowCount ?? 0;
  }
  return angelegt;
}

export interface GebuchterTermin {
  id: string; start: string | null; ende: string | null; leistung: string | null;
  freigegeben: boolean; abgesagt: boolean; abgesagtVon: string | null; abgesagtAm: string | null;
}

/** Gebuchte Termine (Postfach) eines Klienten für die Akte. */
export async function gebuchteTermine(email: string): Promise<GebuchterTermin[]> {
  const { rows } = await pool.query(
    `SELECT i.id::text AS id, i.payload FROM inbox_items i
      WHERE i.type = 'booking' AND lower(i.payload->>'email') = lower($1)
        AND (i.payload ? 'freigegebenAm' OR (i.payload->>'adminCreated' = 'true' AND i.created_at >= '2026-10-20T00:00:00Z'))
      ORDER BY i.payload->>'slotStart' DESC NULLS LAST LIMIT 50`, [email]);
  return rows.map((r: { id: string; payload: Record<string, unknown> }) => ({
    id: r.id, start: textWert(r.payload.slotStart), ende: textWert(r.payload.slotEnd),
    leistung: textWert(r.payload.leistungKey) ?? textWert(r.payload.serviceKey),
    freigegeben: true, abgesagt: r.payload.state === 'storniert' || r.payload.abgelehnt === true,
    abgesagtVon: textWert(r.payload.abgesagtVon) ?? (r.payload.state === 'storniert' ? 'kunde' : null),
    abgesagtAm: textWert(r.payload.cancelledAt),
  }));
}

/** Absage durch Gerald vermerken (Kunde hat abgesagt / ich habe abgesagt / nicht erschienen). */
export async function vermerkeAbsage(brand: string, inboxId: string, von: AbsageVon, klientEmail: string, jetzt = new Date()): Promise<string | null> {
  const regeln = await ladeRegeln(brand);
  const vermerk = absageVermerk(von, jetzt, regeln);
  if (von === 'nicht_erschienen') {
    // Zeitpunkt = Terminbeginn; nur für begonnene Termine sinnvoll.
    const { rows } = await pool.query(`SELECT payload->>'slotStart' AS s FROM inbox_items WHERE id::text = $1`, [inboxId]);
    if (rows[0]?.s) vermerk.cancelledAt = new Date(rows[0].s).toISOString();
  }
  const { rows } = await pool.query(
    `UPDATE inbox_items SET payload = payload || $1::jsonb
      WHERE id::text = $2 AND type = 'booking' AND COALESCE(payload->>'state','') <> 'storniert'
        AND lower(payload->>'email') = lower($3)  -- nur Termine der geöffneten Akte (Prüfung L2, B9)
      RETURNING payload->>'email' AS email`,
    [JSON.stringify(vermerk), inboxId, klientEmail]);
  return (rows[0]?.email as string | undefined) ?? null;
}

/** K20: Ausfallhonorar erlassen; der Vermerk bleibt in der Akte sichtbar. */
export async function erlasseAusfall(brand: string, postenId: string, grund: string, jetzt = new Date()): Promise<boolean> {
  const vermerk = `Erlassen am ${deDatum(jetzt)}${grund.trim() ? `: ${grund.trim().slice(0, 200)}` : ''}`;
  const { rowCount } = await pool.query(
    `UPDATE abrechnungsposten SET zustand = 'erlassen',
       notiz = CASE WHEN notiz IS NULL OR notiz = '' THEN $3 ELSE notiz || ' · ' || $3 END, updated_at = now()
      WHERE brand = $1 AND id = $2 AND herkunft = 'ausfall' AND zustand IN ('offen','nicht_abrechnen')`,
    [brand, postenId, vermerk]);
  return (rowCount ?? 0) > 0;
}
