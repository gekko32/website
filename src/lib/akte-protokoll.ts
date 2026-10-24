// Änderungsprotokoll (Gerald, 24.10.2026; Nachtrag Stufe 4, K94–K99): wer hat wann was geändert.
// Eigene Tabelle akte_protokoll, nur Anhängen (Datenbank-Sperre gegen Ändern und Löschen, K95).
// Rechnungsereignisse stehen schon in billing_audit_log; die Ansicht liest beide zusammen.
// Protokollieren darf eine Änderung nie scheitern lassen (K99). Geheimnisse gehören nicht hinein (K98).
import { pool, ensureSchemaOnce } from './db-pool';
import { logger } from './logger';

export type ProtokollBereich = 'stammdaten' | 'posten' | 'auftrag' | 'angebot' | 'rechnung' | 'einstellungen';

export const BEREICH_TEXT: Record<ProtokollBereich, string> = {
  stammdaten: 'Stammdaten', posten: 'Posten', auftrag: 'Auftrag', angebot: 'Angebot', rechnung: 'Rechnung', einstellungen: 'Einstellungen',
};

export interface ProtokollEintrag {
  bereich: ProtokollBereich; aktion: string; klientId?: string | null; objekt?: string | null;
  beschreibung?: string | null; vorher?: Record<string, unknown> | null; nachher?: Record<string, unknown> | null;
}

export interface ProtokollZeile {
  am: string; wer: string | null; klientId: string | null; klientName: string | null; bereich: ProtokollBereich;
  aktion: string; objekt: string | null; beschreibung: string | null;
  vorher: Record<string, unknown> | null; nachher: Record<string, unknown> | null;
}

/** Felder, die nie ins Protokoll dürfen (K98). */
const GEHEIM = /passw|pass$|secret|token|api_?key|schluessel/i;
function bereinigt(o: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!o) return null;
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === '' || GEHEIM.test(k)) continue;
    r[k] = typeof v === 'string' ? v.slice(0, 500) : v;
  }
  return Object.keys(r).length ? r : null;
}

export function initProtokoll(): Promise<void> {
  return ensureSchemaOnce('akte_protokoll', async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS akte_protokoll (
        id BIGSERIAL PRIMARY KEY,
        brand TEXT NOT NULL,
        am TIMESTAMPTZ NOT NULL DEFAULT now(),
        wer TEXT,
        klient_id UUID,
        bereich TEXT NOT NULL,
        aktion TEXT NOT NULL,
        objekt TEXT,
        beschreibung TEXT,
        vorher JSONB,
        nachher JSONB
      );
      CREATE INDEX IF NOT EXISTS akte_protokoll_klient ON akte_protokoll (brand, klient_id, am DESC);
      CREATE INDEX IF NOT EXISTS akte_protokoll_am ON akte_protokoll (brand, am DESC);
      CREATE OR REPLACE FUNCTION akte_protokoll_unveraenderlich() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Das Änderungsprotokoll ist unveränderlich (K95).';
      END $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS akte_protokoll_sperre ON akte_protokoll;
      CREATE TRIGGER akte_protokoll_sperre BEFORE UPDATE OR DELETE ON akte_protokoll
        FOR EACH ROW EXECUTE FUNCTION akte_protokoll_unveraenderlich();`);
  });
}

/** Einen Eintrag schreiben. Wirft nie (K99). */
export async function protokolliere(brand: string, wer: string | null | undefined, e: ProtokollEintrag): Promise<void> {
  try {
    await initProtokoll();
    const uuid = e.klientId && /^[0-9a-f-]{36}$/i.test(e.klientId) ? e.klientId : null;
    await pool.query(
      `INSERT INTO akte_protokoll (brand, wer, klient_id, bereich, aktion, objekt, beschreibung, vorher, nachher)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)`,
      [brand, wer ?? null, uuid, e.bereich, e.aktion.slice(0, 200), e.objekt?.slice(0, 300) ?? null, e.beschreibung?.slice(0, 1000) ?? null,
       JSON.stringify(bereinigt(e.vorher)), JSON.stringify(bereinigt(e.nachher))]);
  } catch (err) {
    logger.warn({ err, aktion: e.aktion }, '[protokoll] Eintrag nicht geschrieben');
  }
}

/** Nur die geänderten Felder zweier Stände (für vorher → nachher). */
export function unterschied(vorher: Record<string, unknown>, nachher: Record<string, unknown>, felder: string[]): { vorher: Record<string, unknown>; nachher: Record<string, unknown> } | null {
  const v: Record<string, unknown> = {}; const n: Record<string, unknown> = {};
  for (const f of felder) {
    const a = vorher[f] ?? null; const b = nachher[f] ?? null;
    if (String(a ?? '') !== String(b ?? '')) { v[f] = a; n[f] = b; }
  }
  return Object.keys(n).length ? { vorher: v, nachher: n } : null;
}

const RECHNUNG_AKTION: Record<string, string> = {
  created: 'Rechnung angelegt', finalize: 'Rechnung festgeschrieben', versand: 'Rechnung verschickt',
  paid: 'Zahlung erfasst', mark_paid: 'Als bezahlt markiert', storno: 'Rechnung storniert (Gutschrift)',
  dunning_generated: 'Mahnung erstellt', dunning_sent: 'Mahnung verschickt',
};

export interface ProtokollFilter {
  klientId?: string; bereich?: ProtokollBereich; wer?: string; suche?: string; von?: string; bis?: string;
  limit?: number; offset?: number;
}

/** K96, K97: Protokoll lesen – eigene Einträge und Rechnungsereignisse zusammen, neueste zuerst. */
export async function leseProtokoll(brand: string, f: ProtokollFilter = {}): Promise<{ zeilen: ProtokollZeile[]; mehr: boolean }> {
  await initProtokoll();
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
  const offset = Math.max(f.offset ?? 0, 0);
  const datum = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const suche = (f.suche ?? '').trim().slice(0, 100);
  const muster = `%${suche.replace(/[%_\\]/g, (z) => '\\' + z)}%`;
  const { rows } = await pool.query(
    `WITH alle AS (
       SELECT p.am, p.wer, p.klient_id, p.bereich, p.aktion, p.objekt, p.beschreibung, p.vorher, p.nachher
         FROM akte_protokoll p WHERE p.brand = $1
       UNION ALL
       SELECT l.created_at, COALESCE(l.actor_email, l.metadata->>'sentBy', l.metadata->>'recordedBy'), i.klient_id, 'rechnung',
              l.action, i.number, l.reason, NULL::jsonb, l.metadata
         FROM billing_audit_log l JOIN billing_invoices i ON i.id = l.invoice_id WHERE i.brand = $1
     )
     SELECT a.am::text AS am, a.wer, a.klient_id::text AS klient_id, c.name AS klient_name, a.bereich, a.aktion, a.objekt,
            a.beschreibung, a.vorher, a.nachher
       FROM alle a LEFT JOIN customers c ON c.id = a.klient_id
      WHERE ($2::uuid IS NULL OR a.klient_id = $2::uuid)
        AND ($3::text IS NULL OR a.bereich = $3)
        AND ($4::text IS NULL OR a.wer ILIKE $4)
        AND ($5::date IS NULL OR a.am >= $5::date)
        AND ($6::date IS NULL OR a.am < ($6::date + 1))
        AND ($7 = '' OR a.aktion ILIKE $8 OR a.objekt ILIKE $8 OR a.beschreibung ILIKE $8 OR c.name ILIKE $8
             OR a.vorher::text ILIKE $8 OR a.nachher::text ILIKE $8)
      ORDER BY a.am DESC
      LIMIT $9 OFFSET $10`,
    [brand, f.klientId && /^[0-9a-f-]{36}$/i.test(f.klientId) ? f.klientId : null, f.bereich ?? null,
     f.wer ? `%${f.wer.replace(/[%_\\]/g, (z) => '\\' + z)}%` : null, datum(f.von), datum(f.bis), suche, muster, limit + 1, offset]);
  const zeilen = rows.slice(0, limit).map((r: Record<string, unknown>) => ({
    am: r.am as string, wer: (r.wer as string | null) ?? null, klientId: (r.klient_id as string | null) ?? null,
    klientName: (r.klient_name as string | null) ?? null, bereich: r.bereich as ProtokollBereich,
    aktion: r.bereich === 'rechnung' ? (RECHNUNG_AKTION[r.aktion as string] ?? (r.aktion as string)) : (r.aktion as string),
    objekt: (r.objekt as string | null) ?? null, beschreibung: (r.beschreibung as string | null) ?? null,
    vorher: (r.vorher as Record<string, unknown> | null) ?? null, nachher: (r.nachher as Record<string, unknown> | null) ?? null,
  }));
  return { zeilen, mehr: rows.length > limit };
}

/** Kurze Darstellung „Feld: vorher → nachher“ für Listen. */
export function aenderungText(z: Pick<ProtokollZeile, 'vorher' | 'nachher'>): string {
  const felder = [...new Set([...Object.keys(z.vorher ?? {}), ...Object.keys(z.nachher ?? {})])];
  return felder.map((k) => {
    const v = z.vorher?.[k]; const n = z.nachher?.[k];
    const t = (x: unknown) => (x === null || x === undefined || x === '' ? '–' : typeof x === 'object' ? JSON.stringify(x) : String(x));
    return z.vorher && k in z.vorher ? `${k}: ${t(v)} → ${t(n)}` : `${k}: ${t(n)}`;
  }).join(' · ');
}
