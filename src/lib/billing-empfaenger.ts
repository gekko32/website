// Rechnungswesen Stufe 3, T11 (AE5): Beim Festschreiben speichert die Rechnung eine Kopie
// des Empfängers (billing_invoices.empfaenger). Danach lesen PDF, E-Rechnung, Druckansicht,
// Mahnung und Gutschrift nur noch die Kopie (K31). Bis dahin gilt die aktuelle Anschrift
// aus der Klientenakte (K32). Ältere Rechnungen ohne Kopie lesen weiter den Rechnungskunden.
import { pool } from './website-db';
import { getKlient, rechnungsempfaenger, type Klient } from './klientenakte';
import type { Customer } from './native-billing';

export interface Empfaenger {
  /** Person (bei Firmen: z. Hd.) */
  name: string;
  company: string | null;
  email: string;
  addressLine1: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  vatNumber: string | null;
}

type KundeTeil = Pick<Customer, 'name' | 'email' | 'company' | 'addressLine1' | 'postalCode' | 'city' | 'landIso' | 'vatNumber'>;
type AkteTeil = Parameters<typeof rechnungsempfaenger>[0];

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

export function empfaengerAusKunde(c: KundeTeil): Empfaenger {
  return {
    name: c.name, company: text(c.company), email: c.email, addressLine1: text(c.addressLine1),
    postalCode: text(c.postalCode), city: text(c.city), country: c.landIso || 'DE', vatNumber: text(c.vatNumber),
  };
}

/** K32: Ist der Rechnungskunde mit einer Akte verknüpft, gilt deren heutiger Stand. */
export function empfaengerMitAkte(c: KundeTeil, klient: AkteTeil | null): Empfaenger {
  if (!klient) return empfaengerAusKunde(c);
  const e = rechnungsempfaenger(klient);
  return {
    name: e.name, company: text(e.company), email: e.email, addressLine1: text(e.addressLine1),
    postalCode: text(e.postalCode), city: text(e.city), country: c.landIso || 'DE', vatNumber: text(e.vatNumber),
  };
}

/** Grenzfall Spezifikation: ohne vollständige Anschrift ist Festschreiben nicht möglich. */
export function fehlendeAngaben(e: Empfaenger): string[] {
  const fehlt: string[] = [];
  if (!text(e.name) && !text(e.company)) fehlt.push('Name');
  if (!text(e.addressLine1)) fehlt.push('Straße und Hausnummer');
  if (!text(e.postalCode)) fehlt.push('PLZ');
  if (!text(e.city)) fehlt.push('Ort');
  return fehlt;
}

/** Name des Käufers für die E-Rechnung (BT-44): die Firma, sonst die Person. */
export const kaeuferName = (e: Empfaenger): string => e.company || e.name;

/** Kopie aus der Datenbank lesen; null bei Rechnungen ohne Kopie. */
export function leseEmpfaenger(v: unknown): Empfaenger | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== 'string' || typeof o.email !== 'string') return null;
  return {
    name: o.name, company: text(o.company), email: o.email, addressLine1: text(o.addressLine1),
    postalCode: text(o.postalCode), city: text(o.city), country: text(o.country) ?? 'DE', vatNumber: text(o.vatNumber),
  };
}

/** Kunde mit den Angaben der Kopie, für Stellen, die einen Customer erwarten (PDF, Mahnung). */
export function alsKunde<T extends KundeTeil>(c: T, e: Empfaenger): T {
  return {
    ...c, name: e.name, company: e.company ?? undefined, email: e.email, addressLine1: e.addressLine1 ?? undefined,
    postalCode: e.postalCode ?? undefined, city: e.city ?? undefined, landIso: e.country, vatNumber: e.vatNumber ?? undefined,
  };
}

// ── Datenbank ───────────────────────────────────────────────────────────────

/**
 * Heutiger Empfänger eines Rechnungskunden: aus der verknüpften Akte, sonst aus dem Rechnungskunden.
 * `ohneAkte`: nur der Rechnungskunde (ältere festgeschriebene Rechnungen ohne Kopie, wie bisher).
 */
export async function aktuellerEmpfaenger(
  brand: string, billingCustomerId: string, opts: { ohneAkte?: boolean; klientId?: string | null } = {},
): Promise<Empfaenger | null> {
  const { rows } = await pool.query(
    `SELECT name, email, company, address_line1, postal_code, city, land_iso, vat_number, customers_id::text AS customers_id
       FROM billing_customers WHERE id = $1 AND brand = $2`, [billingCustomerId, brand]);
  const r = rows[0];
  if (!r) return null;
  const kunde: KundeTeil = {
    name: r.name, email: r.email, company: r.company ?? undefined, addressLine1: r.address_line1 ?? undefined,
    postalCode: r.postal_code ?? undefined, city: r.city ?? undefined, landIso: r.land_iso ?? 'DE', vatNumber: r.vat_number ?? undefined,
  };
  // Prüfung L3 (B2): die Akte der Rechnung geht vor der Verknüpfung des Rechnungskunden.
  const akteId = opts.klientId ?? r.customers_id;
  const klient: Klient | null = akteId && !opts.ohneAkte ? await getKlient(akteId).catch(() => null) : null;
  return empfaengerMitAkte(kunde, klient);
}

/**
 * Empfänger einer Rechnung: die festgeschriebene Kopie (K31); bei Entwürfen der heutige
 * Stand aus der Akte (K32); bei älteren festgeschriebenen Rechnungen ohne Kopie wie bisher
 * der Rechnungskunde.
 */
export async function empfaengerDerRechnung(invoiceId: string): Promise<Empfaenger | null> {
  const { rows } = await pool.query('SELECT brand, customer_id, empfaenger, locked, klient_id::text AS klient_id FROM billing_invoices WHERE id = $1', [invoiceId]);
  const r = rows[0];
  if (!r) return null;
  return leseEmpfaenger(r.empfaenger) ?? aktuellerEmpfaenger(r.brand, r.customer_id, { ohneAkte: r.locked === true, klientId: r.klient_id });
}

export class AnschriftFehlt extends Error {
  constructor(public fehlt: string[]) {
    super(`Festschreiben nicht möglich: In der Rechnungsanschrift fehlt ${fehlt.join(', ')}. Bitte in der Klientenakte ergänzen.`);
    this.name = 'AnschriftFehlt';
  }
}
