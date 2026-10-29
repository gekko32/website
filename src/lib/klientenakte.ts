// components/website/src/lib/klientenakte.ts
// Klientenakte (Gerald, 19.10.2026 – Rechnungswesen Stufe 2, Befund R1).
//
// EINE Akte pro Klient, aufgehängt an `customers.id` (Kundennummer M0001 …) –
// nicht am Benutzerkonto. Klienten entstehen meist nach Mail oder Anruf und
// werden von Gerald angelegt; ein Konto (`keycloak_user_id`) kann später über
// /api/admin/clients/enroll ergänzt werden. Buchungen über die Website legen
// über upsertCustomer() bereits Zeilen in derselben Tabelle an.
//
// Rechnungsempfänger: die Person selbst oder eine Firma (Führungskräfte-
// Coaching: Firma zahlt, Person wird gecoacht). Die Rechnung geht über
// billing_customers, verknüpft per billing_customers.customers_id.

import { pool } from './website-db';
import { ensureCustomerCrmSchema } from './customer-crm-db';
import type { Abrechnungsart } from './billing-regeln';
import { hatEchteEmail, platzhalterEmail } from './billing-versand';
import { ensureKundennummer } from './kundennummer';
import { logger } from './logger';

export type RechnungAn = 'person' | 'firma';

export interface KlientEingabe {
  name: string;
  email: string;
  phone?: string | null;
  address?: string | null;
  postal_code?: string | null;
  city?: string | null;
  rechnung_an?: RechnungAn;
  rechnung_firma?: string | null;
  rechnung_firma_adresse?: string | null;
  rechnung_firma_plz?: string | null;
  rechnung_firma_ort?: string | null;
  rechnung_email?: string | null;
  rechnung_ust_id?: string | null;
  notiz?: string | null;
  /** Stufe 3 T10b: null = Voreinstellung aus Einstellungen → Regeln (Firma/Privat). */
  abrechnungsart?: Abrechnungsart | null;
}

export interface Klient extends Required<Pick<KlientEingabe, 'name' | 'email'>> {
  id: string;
  customer_number: string | null;
  phone: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  rechnung_an: RechnungAn;
  rechnung_firma: string | null;
  rechnung_firma_adresse: string | null;
  rechnung_firma_plz: string | null;
  rechnung_firma_ort: string | null;
  rechnung_email: string | null;
  rechnung_ust_id: string | null;
  notiz: string | null;
  abrechnungsart: Abrechnungsart | null;
  hat_konto: boolean;
  keycloak_user_id: string | null;
  created_at: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const leer = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
};

/** Geprüfte Eingabe; email null = Klient ohne E-Mail (Stufe 4, K61). */
export type GepruefterKlient = Omit<Required<KlientEingabe>, 'email'> & { email: string | null };

/** Prüft und bereinigt eine Eingabe. Wirft mit deutscher Meldung. */
export function pruefeKlient(input: KlientEingabe): GepruefterKlient {
  const name = leer(input.name);
  // Stufe 4 T13: E-Mail freiwillig; ein Platzhalter aus dem System zählt als „keine“.
  const roh = leer(input.email)?.toLowerCase() ?? null;
  const email = roh && hatEchteEmail(roh) ? roh : null;
  if (!name) throw new Error('Bitte einen Namen angeben.');
  if (email && !EMAIL_RE.test(email)) throw new Error('Bitte eine gültige E-Mail-Adresse angeben oder das Feld leer lassen.');
  const rechnung_an: RechnungAn = input.rechnung_an === 'firma' ? 'firma' : 'person';
  const rechnung_email = leer(input.rechnung_email)?.toLowerCase() ?? null;
  if (rechnung_email && !EMAIL_RE.test(rechnung_email)) {
    throw new Error('Die Rechnungs-E-Mail ist ungültig.');
  }
  const artRoh = leer(input.abrechnungsart);
  if (artRoh !== null && artRoh !== 'monatlich' && artRoh !== 'je_sitzung') {
    throw new Error('Abrechnungsart: bitte „monatlich“ oder „je Sitzung“ wählen.');
  }
  const out: GepruefterKlient = {
    name, email,
    phone: leer(input.phone),
    address: leer(input.address),
    postal_code: leer(input.postal_code),
    city: leer(input.city),
    rechnung_an,
    rechnung_firma: leer(input.rechnung_firma),
    rechnung_firma_adresse: leer(input.rechnung_firma_adresse),
    rechnung_firma_plz: leer(input.rechnung_firma_plz),
    rechnung_firma_ort: leer(input.rechnung_firma_ort),
    rechnung_email,
    rechnung_ust_id: leer(input.rechnung_ust_id),
    notiz: leer(input.notiz),
    abrechnungsart: artRoh,
  };
  if (rechnung_an === 'firma' && !out.rechnung_firma) {
    throw new Error('Bei „Rechnung an Firma“ bitte den Firmennamen angeben.');
  }
  return out;
}

export interface Rechnungsempfaenger {
  name: string;
  email: string;
  company: string | null;
  addressLine1: string | null;
  postalCode: string | null;
  city: string | null;
  vatNumber: string | null;
}

/** Wer bekommt die Rechnung? Person oder Firma – reine Ableitung aus der Akte. */
export function rechnungsempfaenger(k: Pick<Klient,
  'name' | 'email' | 'address' | 'postal_code' | 'city' | 'rechnung_an' | 'rechnung_firma' |
  'rechnung_firma_adresse' | 'rechnung_firma_plz' | 'rechnung_firma_ort' | 'rechnung_email' |
  'rechnung_ust_id'>): Rechnungsempfaenger {
  const email = k.rechnung_email ?? k.email;
  if (k.rechnung_an === 'firma' && k.rechnung_firma) {
    return {
      name: k.name, email, company: k.rechnung_firma,
      addressLine1: k.rechnung_firma_adresse, postalCode: k.rechnung_firma_plz,
      city: k.rechnung_firma_ort, vatNumber: k.rechnung_ust_id,
    };
  }
  return {
    name: k.name, email, company: null,
    addressLine1: k.address, postalCode: k.postal_code, city: k.city, vatNumber: null,
  };
}

let schemaFertig = false;
export async function ensureKlientenakteSchema(): Promise<void> {
  if (schemaFertig) return;
  await ensureCustomerCrmSchema(); // address, city, postal_code, country, …
  await pool.query(`
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS rechnung_an TEXT NOT NULL DEFAULT 'person';
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS rechnung_firma TEXT;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS rechnung_firma_adresse TEXT;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS rechnung_firma_plz TEXT;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS rechnung_firma_ort TEXT;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS rechnung_email TEXT;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS rechnung_ust_id TEXT;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS notiz TEXT;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS abrechnungsart TEXT;
  `);
  schemaFertig = true;
}

const SPALTEN = `id, name, email, customer_number, phone, address, postal_code, city,
  rechnung_an, rechnung_firma, rechnung_firma_adresse, rechnung_firma_plz, rechnung_firma_ort,
  rechnung_email, rechnung_ust_id, notiz, abrechnungsart, keycloak_user_id,
  (keycloak_user_id IS NOT NULL) AS hat_konto, created_at`;

export async function listKlienten(): Promise<Klient[]> {
  await ensureKlientenakteSchema();
  const r = await pool.query(
    `SELECT ${SPALTEN} FROM customers
      WHERE is_admin IS NOT TRUE
      ORDER BY name ASC`,
  );
  return r.rows;
}

export async function getKlient(id: string): Promise<Klient | null> {
  await ensureKlientenakteSchema();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await pool.query(`SELECT ${SPALTEN} FROM customers WHERE id = $1`, [id]);
  return r.rows[0] ?? null;
}

/** Legt einen Klienten OHNE Benutzerkonto an. Gibt es die E-Mail schon, Fehler mit vorhandener Id. */
export async function createKlient(input: KlientEingabe): Promise<{ ok: true; klient: Klient } | { ok: false; error: string; vorhandenId?: string }> {
  await ensureKlientenakteSchema();
  let k: GepruefterKlient;
  try { k = pruefeKlient(input); } catch (e) { return { ok: false, error: (e as Error).message }; }
  // K62: doppelte E-Mail nur prüfen, wenn eine angegeben ist; sonst Platzhalter (AE9).
  if (k.email) {
    const dup = await pool.query(`SELECT id FROM customers WHERE lower(email) = $1`, [k.email]);
    if (dup.rows[0]) {
      return { ok: false, error: 'Zu dieser E-Mail gibt es schon eine Akte.', vorhandenId: dup.rows[0].id };
    }
  }
  const email = k.email ?? platzhalterEmail();
  // K145 (Handtest 29.10.2026): Kundennummer nie kürzen, vergebene überspringen. Vor jedem Anlegen
  // prüfen (Prüfung C1); scheitert das, wird nur gewarnt – die Akte bleibt nutzbar.
  await ensureKundennummer().catch((err) => logger.warn({ err }, '[klientenakte] Kundennummer-Regel nicht gesetzt'));
  let r;
  try {
    r = await pool.query(
      `INSERT INTO customers (name, email, phone, address, postal_code, city,
         rechnung_an, rechnung_firma, rechnung_firma_adresse, rechnung_firma_plz, rechnung_firma_ort,
         rechnung_email, rechnung_ust_id, notiz, company, acquisition_source, abrechnungsart)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$8,'manuell',$15)
       RETURNING ${SPALTEN}`,
      [k.name, email, k.phone, k.address, k.postal_code, k.city,
       k.rechnung_an, k.rechnung_firma, k.rechnung_firma_adresse, k.rechnung_firma_plz, k.rechnung_firma_ort,
       k.rechnung_email, k.rechnung_ust_id, k.notiz, k.abrechnungsart],
    );
  } catch (e) {
    // K145 (Handtest 29.10.2026): statt stummem Abbruch eine verständliche Meldung.
    const err = e as { code?: string; constraint?: string };
    if (err.code === '23505' && err.constraint === 'customers_customer_number_key') {
      return { ok: false, error: 'Die Kundennummer war schon vergeben. Bitte noch einmal „Anlegen“ klicken; bleibt es dabei, unter Einstellungen → Regeln „Nächste Kundennummer“ prüfen.' };
    }
    if (err.code === '23505') return { ok: false, error: 'Diese Angaben gibt es schon bei einem anderen Klienten (z. B. die E-Mail-Adresse).' };
    throw e;
  }
  return { ok: true, klient: r.rows[0] };
}

export async function updateKlient(id: string, input: KlientEingabe): Promise<{ ok: true; klient: Klient } | { ok: false; error: string }> {
  await ensureKlientenakteSchema();
  let k: GepruefterKlient;
  try { k = pruefeKlient(input); } catch (e) { return { ok: false, error: (e as Error).message }; }
  let email: string;
  if (k.email) {
    const dup = await pool.query(`SELECT id FROM customers WHERE lower(email) = $1 AND id <> $2`, [k.email, id]);
    if (dup.rows[0]) return { ok: false, error: 'Diese E-Mail gehört schon zu einer anderen Akte.' };
    email = k.email;
  } else {
    // Ohne E-Mail: vorhandenen Platzhalter behalten, sonst neuen vergeben (K64 rückwärts).
    const alt = (await pool.query('SELECT email FROM customers WHERE id = $1', [id])).rows[0]?.email as string | undefined;
    email = alt && !hatEchteEmail(alt) ? alt : platzhalterEmail();
  }
  const r = await pool.query(
    `UPDATE customers SET name=$2, email=$3, phone=$4, address=$5, postal_code=$6, city=$7,
       rechnung_an=$8, rechnung_firma=$9, rechnung_firma_adresse=$10, rechnung_firma_plz=$11,
       rechnung_firma_ort=$12, rechnung_email=$13, rechnung_ust_id=$14, notiz=$15,
       company=COALESCE($9, company), abrechnungsart=$16, updated_at=now()
     WHERE id=$1 RETURNING ${SPALTEN}`,
    [id, k.name, email, k.phone, k.address, k.postal_code, k.city,
     k.rechnung_an, k.rechnung_firma, k.rechnung_firma_adresse, k.rechnung_firma_plz,
     k.rechnung_firma_ort, k.rechnung_email, k.rechnung_ust_id, k.notiz, k.abrechnungsart],
  );
  if (!r.rows[0]) return { ok: false, error: 'Akte nicht gefunden.' };
  return { ok: true, klient: r.rows[0] };
}

export interface AkteSitzung { id: string; title: string; status: string; created_at: string }
export interface AkteTermin { id: string; meeting_type: string; scheduled_at: string | null; status: string }
export interface AkteRechnung { id: string; number: string; issue_date: string; gross_amount: number; status: string; empfaenger: string;
  /** Stufe 4 (K58): Versandweg und -zeitpunkt, leer bei älteren Rechnungen und Entwürfen. */
  versandweg?: string | null; versendet_am?: string | null }

/** Termine, Coaching-Sitzungen und Rechnungen einer Akte. */
export async function akteVerlauf(klient: Pick<Klient, 'id' | 'email'>, brand: string): Promise<{
  termine: AkteTermin[]; sitzungen: AkteSitzung[]; rechnungen: AkteRechnung[];
}> {
  const [t, s, r] = await Promise.all([
    pool.query(
      `SELECT id, meeting_type, scheduled_at, status FROM meetings
        WHERE customer_id = $1 ORDER BY scheduled_at DESC NULLS LAST LIMIT 100`,
      [klient.id],
    ).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT id, title, status, created_at FROM coaching.sessions
        WHERE client_id = $1 AND brand = $2 ORDER BY created_at DESC LIMIT 100`,
      [klient.id, brand],
    ).catch(() => ({ rows: [] })),
    // Verknüpft über customers_id; ältere Rechnungen ohne Verknüpfung über die E-Mail.
    pool.query(
      `SELECT i.id, i.number, i.issue_date, i.gross_amount::float AS gross_amount, i.status, i.versandweg, i.versendet_am,
              COALESCE(bc.company, bc.name) AS empfaenger
         FROM billing_invoices i JOIN billing_customers bc ON bc.id = i.customer_id
        WHERE i.brand = $3 AND i.is_test_data = false
          -- Prüfung L3 (B2): Rechnungen aus Posten tragen ihre Akte; ältere über Verknüpfung oder E-Mail.
          AND (i.klient_id = $1 OR (i.klient_id IS NULL AND (bc.customers_id = $1 OR lower(bc.email) = lower($2))))
        ORDER BY i.issue_date DESC, i.number DESC LIMIT 200`,
      [klient.id, klient.email, brand],
    ).catch(() => ({ rows: [] })),
  ]);
  return { termine: t.rows, sitzungen: s.rows, rechnungen: r.rows };
}

/** Verknüpft einen Rechnungskunden mit der Akte (billing_customers.customers_id). */
export async function verknuepfeRechnungskunde(billingCustomerId: string, klientId: string): Promise<void> {
  await pool.query(
    `UPDATE billing_customers SET customers_id = $2 WHERE id = $1 AND (customers_id IS NULL OR customers_id = $2)`,
    [billingCustomerId, klientId],
  );
}
