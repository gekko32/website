// Handtest 29.10.2026 (H18, K145, K146): Kundennummern M0001 …
// Der alte Vorgabewert `'M' || lpad(nextval('customer_number_seq'), 4, '0')` kürzte ab 10.000 auf
// vier Stellen (11161 → „M1116“) und lief dann auf vergebene Nummern. Jetzt erzeugt eine Funktion in
// der Datenbank die Nummer: nie gekürzt, vergebene Nummern werden übersprungen. Sie gilt für jeden
// Weg, auf dem ein Kunde entsteht (Akte, Registrierung, Buchung), weil sie der Vorgabewert der Spalte ist.
// Dieselbe Funktion setzt auch das Schema-Skript der Datenbank (mentolder-prod, website-schema.yaml).
import { pool } from './website-db';

/** M0020, M0999, M10000 – mindestens vier Ziffern, nie gekürzt. */
export function kundennummerText(n: number): string {
  return `M${String(n).padStart(4, '0')}`;
}

/**
 * Legt die Funktion an (falls sie fehlt) und setzt sie als Vorgabewert (falls ein anderer gilt).
 * Prüfung C1/C3: billig genug, um vor jedem Anlegen zu laufen – ein Neustart der Datenbank mit
 * einem älteren Schema-Skript würde sonst unbemerkt den kürzenden Vorgabewert zurückbringen.
 * Ohne Zähler (Tests, andere Marken) tut sie nichts.
 */
export async function ensureKundennummer(): Promise<void> {
  await pool.query(`
    DO $do$
    BEGIN
      IF to_regclass('customer_number_seq') IS NULL THEN RETURN; END IF;
      IF to_regprocedure('naechste_kundennummer()') IS NULL THEN
        CREATE FUNCTION naechste_kundennummer() RETURNS text LANGUAGE plpgsql AS $f$
        DECLARE n bigint; k text;
        BEGIN
          LOOP
            n := nextval('customer_number_seq');
            k := 'M' || lpad(n::text, greatest(4, length(n::text)), '0');
            EXIT WHEN NOT EXISTS (SELECT 1 FROM customers WHERE customer_number = k);
          END LOOP;
          RETURN k;
        END $f$;
      END IF;
      IF COALESCE((SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
                     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                    WHERE d.adrelid = 'customers'::regclass AND a.attname = 'customer_number'), '')
         <> 'naechste_kundennummer()' THEN
        ALTER TABLE customers ALTER COLUMN customer_number SET DEFAULT naechste_kundennummer();
      END IF;
    END $do$;`);
}

export interface KundennummerStand {
  /** Die Zahl, die der nächste neue Klient bekommt (vor dem Überspringen vergebener Nummern). */
  naechste: number;
  /** Höchste schon vergebene Nummer im Format M…, 0 wenn keine. */
  hoechste: number;
}

export async function leseKundennummerStand(): Promise<KundennummerStand | null> {
  const s = await pool.query(`SELECT to_regclass('customer_number_seq') IS NOT NULL AS da`);
  if (!s.rows[0]?.da) return null;
  const z = await pool.query('SELECT last_value, is_called FROM customer_number_seq');
  const h = await pool.query(
    `SELECT COALESCE(MAX(substring(customer_number FROM 2)::bigint), 0) AS hoechste
       FROM customers WHERE customer_number ~ '^M[0-9]+$'`);
  const last = Number(z.rows[0].last_value);
  return { naechste: z.rows[0].is_called ? last + 1 : last, hoechste: Number(h.rows[0].hoechste) };
}

/** K146: Prüfung der Eingabe „Nächste Kundennummer“ (ganze Zahl 1–999999). */
export function pruefeNaechsteKundennummer(roh: string): { wert: number | null; fehler: string | null } {
  const s = roh.trim().replace(/^M/i, '');
  if (!/^\d{1,6}$/.test(s) || Number(s) < 1) {
    return { wert: null, fehler: 'Bitte eine ganze Zahl von 1 bis 999999 eintragen (z. B. 20 für M0020).' };
  }
  return { wert: Number(s), fehler: null };
}

/** Setzt den Zähler so, dass der nächste Klient diese Nummer bekommt (vergebene werden übersprungen). */
export async function setzeNaechsteKundennummer(n: number): Promise<void> {
  if (n > 1) await pool.query(`SELECT setval('customer_number_seq', $1, true)`, [n - 1]);
  else await pool.query(`SELECT setval('customer_number_seq', 1, false)`);
}
