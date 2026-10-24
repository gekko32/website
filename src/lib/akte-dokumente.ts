// Nachtrag Stufe 4 (K101–K105, 24.10.2026): Notizen und Dokumente je Klient, auch als Nachweis zur Antwort
// auf ein Angebot (Anruf, Antwort-Mail, Brief). Dateien liegen in der Datenbank der Website (damit in der
// nächtlichen Sicherung). Einträge sind unveränderlich; ein falscher Eintrag wird zurückgezogen, bleibt
// aber mit Vermerk sichtbar (Datenbank-Sperre).
import { pool, ensureSchemaOnce } from './db-pool';

export type EintragArt = 'notiz' | 'annahme' | 'ablehnung';
export type EintragWeg = 'telefon' | 'email' | 'brief' | 'persoenlich' | 'sonstiges';

export const ART_TEXT: Record<EintragArt, string> = { notiz: 'Notiz', annahme: 'Annahme', ablehnung: 'Ablehnung' };
export const WEG_TEXT: Record<EintragWeg, string> = {
  telefon: 'Telefon', email: 'E-Mail', brief: 'Brief', persoenlich: 'persönlich', sonstiges: 'sonstiges',
};

/** K104: erlaubte Dateien – Typ wird aus der Endung bestimmt, nicht aus der Angabe des Browsers. */
const ERLAUBT: Record<string, string> = {
  pdf: 'application/pdf', eml: 'message/rfc822', msg: 'application/vnd.ms-outlook', txt: 'text/plain',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
};
export const ERLAUBTE_ENDUNGEN = Object.keys(ERLAUBT);
export const MAX_GROESSE = 15 * 1024 * 1024;

export interface Datei { name: string; inhalt: Buffer }
export interface AkteEintrag {
  id: string; klientId: string; angebotId: string | null; angebotNummer: string | null; art: EintragArt; weg: EintragWeg | null;
  datum: string; notiz: string | null; dateiName: string | null; dateiGroesse: number | null;
  erstelltAm: string; erstelltVon: string | null;
  zurueckgezogenAm: string | null; zurueckgezogenVon: string | null; zurueckGrund: string | null;
}

export function initAkteDokumente(): Promise<void> {
  return ensureSchemaOnce('akte_eintraege', async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS akte_eintraege (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        brand TEXT NOT NULL,
        klient_id UUID NOT NULL,
        angebot_id TEXT,
        art TEXT NOT NULL CHECK (art IN ('notiz','annahme','ablehnung')),
        weg TEXT CHECK (weg IN ('telefon','email','brief','persoenlich','sonstiges')),
        datum DATE NOT NULL,
        notiz TEXT,
        datei_name TEXT,
        datei_mime TEXT,
        datei_groesse INTEGER,
        datei_inhalt BYTEA,
        erstellt_am TIMESTAMPTZ NOT NULL DEFAULT now(),
        erstellt_von TEXT,
        zurueckgezogen_am TIMESTAMPTZ,
        zurueckgezogen_von TEXT,
        zurueck_grund TEXT,
        CHECK (notiz IS NOT NULL OR datei_inhalt IS NOT NULL)
      );
      CREATE INDEX IF NOT EXISTS akte_eintraege_klient ON akte_eintraege (brand, klient_id, datum DESC);
      CREATE INDEX IF NOT EXISTS akte_eintraege_angebot ON akte_eintraege (angebot_id);
      CREATE OR REPLACE FUNCTION akte_eintraege_sperre() RETURNS trigger AS $$
      BEGIN
        IF TG_OP <> 'UPDATE' THEN
          RAISE EXCEPTION 'Notizen und Dokumente lassen sich nicht löschen, nur zurückziehen (K105).';
        END IF;
        IF OLD.zurueckgezogen_am IS NOT NULL
           OR (NEW.brand, NEW.klient_id, NEW.angebot_id, NEW.art, NEW.weg, NEW.datum, NEW.notiz, NEW.datei_name,
               NEW.datei_mime, NEW.datei_groesse, NEW.datei_inhalt, NEW.erstellt_am, NEW.erstellt_von)
              IS DISTINCT FROM
              (OLD.brand, OLD.klient_id, OLD.angebot_id, OLD.art, OLD.weg, OLD.datum, OLD.notiz, OLD.datei_name,
               OLD.datei_mime, OLD.datei_groesse, OLD.datei_inhalt, OLD.erstellt_am, OLD.erstellt_von) THEN
          RAISE EXCEPTION 'Notizen und Dokumente lassen sich nicht ändern, nur einmal zurückziehen (K105).';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS akte_eintraege_sperre ON akte_eintraege;
      CREATE TRIGGER akte_eintraege_sperre BEFORE UPDATE OR DELETE ON akte_eintraege
        FOR EACH ROW EXECUTE FUNCTION akte_eintraege_sperre();
      DROP TRIGGER IF EXISTS akte_eintraege_kein_truncate ON akte_eintraege;
      CREATE TRIGGER akte_eintraege_kein_truncate BEFORE TRUNCATE ON akte_eintraege
        FOR EACH STATEMENT EXECUTE FUNCTION akte_eintraege_sperre();`);
  });
}

const endung = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1] ?? '');
/** Dateiname ohne Pfad, ohne Steuerzeichen und Anführungszeichen (für den Download-Kopf). */
export const sichererName = (name: string) =>
  [...(name.split(/[\\/]/).pop() ?? 'datei')].filter((z) => z.charCodeAt(0) >= 32 && z !== '"' && z !== '\\').join('').trim().slice(0, 150) || 'datei';

/** K104: Datei prüfen, bevor irgendetwas gespeichert wird. */
export function pruefeDatei(d: Datei | null): string | null {
  if (!d) return null;
  if (d.inhalt.length === 0) return 'Die Datei ist leer.';
  if (d.inhalt.length > MAX_GROESSE) return 'Die Datei ist größer als 15 MB.';
  if (!ERLAUBT[endung(d.name)]) return `Dieser Dateityp ist nicht erlaubt. Erlaubt: ${ERLAUBTE_ENDUNGEN.join(', ')}.`;
  return null;
}

export const istWeg = (w: unknown): w is EintragWeg => typeof w === 'string' && w in WEG_TEXT;

export type EintragErgebnis = { ok: true; id: string } | { ok: false; fehler: string };

export async function legeEintragAn(
  brand: string,
  e: { klientId: string; angebotId?: string | null; art: EintragArt; weg?: string | null; datum: string; notiz?: string | null; datei?: Datei | null },
  wer?: string | null,
): Promise<EintragErgebnis> {
  await initAkteDokumente();
  if (!/^[0-9a-f-]{36}$/i.test(e.klientId)) return { ok: false, fehler: 'Klient nicht gefunden.' };
  const notiz = (e.notiz ?? '').trim().slice(0, 5000) || null;
  const dateiFehler = pruefeDatei(e.datei ?? null);
  if (dateiFehler) return { ok: false, fehler: dateiFehler };
  if (!notiz && !e.datei) return { ok: false, fehler: 'Bitte eine Notiz schreiben oder eine Datei wählen.' };
  const d = new Date(`${e.datum}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.datum) || Number.isNaN(d.getTime()) || !d.toISOString().startsWith(e.datum)) {
    return { ok: false, fehler: 'Bitte ein gültiges Datum wählen.' };
  }
  const weg = istWeg(e.weg) ? e.weg : null;
  const name = e.datei ? sichererName(e.datei.name) : null;
  const { rows } = await pool.query(
    `INSERT INTO akte_eintraege (brand, klient_id, angebot_id, art, weg, datum, notiz, datei_name, datei_mime, datei_groesse, datei_inhalt, erstellt_von)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id::text AS id`,
    [brand, e.klientId, e.angebotId ?? null, e.art, weg, e.datum, notiz, name, e.datei ? ERLAUBT[endung(e.datei.name)] : null,
     e.datei ? e.datei.inhalt.length : null, e.datei ? e.datei.inhalt : null, wer ?? null]);
  return { ok: true, id: rows[0].id as string };
}

const SPALTEN = `e.id::text AS id, e.klient_id::text AS klient_id, e.angebot_id, q.number AS angebot_nummer, e.art, e.weg,
  e.datum::text AS datum, e.notiz, e.datei_name, e.datei_groesse, e.erstellt_am::text AS erstellt_am, e.erstellt_von,
  e.zurueckgezogen_am::text AS zurueckgezogen_am, e.zurueckgezogen_von, e.zurueck_grund`;

const zeile = (r: Record<string, unknown>): AkteEintrag => ({
  id: r.id as string, klientId: r.klient_id as string, angebotId: (r.angebot_id as string | null) ?? null,
  angebotNummer: (r.angebot_nummer as string | null) ?? null, art: r.art as EintragArt, weg: (r.weg as EintragWeg | null) ?? null,
  datum: r.datum as string, notiz: (r.notiz as string | null) ?? null, dateiName: (r.datei_name as string | null) ?? null,
  dateiGroesse: r.datei_groesse === null || r.datei_groesse === undefined ? null : Number(r.datei_groesse),
  erstelltAm: r.erstellt_am as string, erstelltVon: (r.erstellt_von as string | null) ?? null,
  zurueckgezogenAm: (r.zurueckgezogen_am as string | null) ?? null, zurueckgezogenVon: (r.zurueckgezogen_von as string | null) ?? null,
  zurueckGrund: (r.zurueck_grund as string | null) ?? null,
});

/** K103: alle Einträge eines Klienten, neueste zuerst (ohne Dateiinhalt). */
export async function eintraegeDesKlienten(brand: string, klientId: string): Promise<AkteEintrag[]> {
  await initAkteDokumente();
  const { rows } = await pool.query(
    `SELECT ${SPALTEN} FROM akte_eintraege e LEFT JOIN billing_quotes q ON q.id = e.angebot_id
      WHERE e.brand = $1 AND e.klient_id = $2 ORDER BY e.datum DESC, e.erstellt_am DESC`, [brand, klientId]);
  return rows.map(zeile);
}

/** K102: Einträge zu einem Angebot. */
export async function eintraegeDesAngebots(brand: string, angebotId: string): Promise<AkteEintrag[]> {
  await initAkteDokumente();
  const { rows } = await pool.query(
    `SELECT ${SPALTEN} FROM akte_eintraege e LEFT JOIN billing_quotes q ON q.id = e.angebot_id
      WHERE e.brand = $1 AND e.angebot_id = $2 ORDER BY e.datum DESC, e.erstellt_am DESC`, [brand, angebotId]);
  return rows.map(zeile);
}

export async function holeEintrag(brand: string, id: string): Promise<AkteEintrag | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  await initAkteDokumente();
  const { rows } = await pool.query(
    `SELECT ${SPALTEN} FROM akte_eintraege e LEFT JOIN billing_quotes q ON q.id = e.angebot_id WHERE e.brand = $1 AND e.id = $2`, [brand, id]);
  return rows[0] ? zeile(rows[0]) : null;
}

/** K104: Datei zum Herunterladen. */
export async function holeDatei(brand: string, id: string): Promise<{ name: string; mime: string; inhalt: Buffer } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  await initAkteDokumente();
  const r = (await pool.query(
    'SELECT datei_name, datei_mime, datei_inhalt FROM akte_eintraege WHERE brand = $1 AND id = $2 AND datei_inhalt IS NOT NULL', [brand, id])).rows[0];
  return r ? { name: r.datei_name as string, mime: (r.datei_mime as string) || 'application/octet-stream', inhalt: Buffer.from(r.datei_inhalt) } : null;
}

/** K105: zurückziehen – einmalig, mit Vermerk; Inhalt bleibt erhalten. */
export async function zieheZurueck(brand: string, id: string, wer: string | null | undefined, grund: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  await initAkteDokumente();
  const r = await pool.query(
    `UPDATE akte_eintraege SET zurueckgezogen_am = now(), zurueckgezogen_von = $3, zurueck_grund = $4
      WHERE brand = $1 AND id = $2 AND zurueckgezogen_am IS NULL`, [brand, id, wer ?? null, grund.trim().slice(0, 300) || null]);
  return (r.rowCount ?? 0) > 0;
}

/** Dateigröße lesbar. */
export const groesseText = (n: number | null) =>
  n === null ? '' : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;

/** Aus einem Formular-Feld eine Datei machen (leeres Feld → null). */
export async function dateiAusFormular(wert: FormDataEntryValue | null): Promise<Datei | null> {
  if (!wert || typeof wert === 'string' || wert.size === 0) return null;
  return { name: wert.name || 'datei', inhalt: Buffer.from(await wert.arrayBuffer()) };
}
