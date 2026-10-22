import { pool, initBillingTables } from './website-db';
import { logger } from './logger';
import {
  createCustomer as nativeCreateCustomer,
  createInvoice as nativeCreateInvoice,
  getCustomerById as nativeGetCustomerById,
} from './native-billing';
import { holeLeistung } from './billing-leistungen';
import { ladeZahlungsziel } from './billing-regeln';
import { leistungsdatumZeile } from './leistungszeitraum';

// Die feste Preisliste (SERVICES) ist seit Rechnungswesen Stufe 3 (20.10.2026)
// entfernt. Leistungen und Preise pflegt Gerald unter Admin → Leistungen
// (billing-leistungen.ts); der alte Stand liegt dort als STARTLISTE_CODE_2026_10.

// ---- Types ----
interface BillingCustomer {
  id: string;
  name: string;
  email: string;
}

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';

export interface BillingInvoice {
  id: string;
  number: string;
  date: string;
  dueDate: string;
  amountDue: number;
  amountPaid: number;
  amountRemaining: number;
  status: InvoiceStatus;
  statusLabel: string;
  hostedUrl: string | null;
  pdfUrl: string | null;
}

export interface AdminBillingInvoice extends BillingInvoice {
  customerName: string;
  customerEmail: string;
}

interface DraftInvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  currency: string;
  /** Stufe 3 T10a: „Leistung: 05.11.2026“, null bei Positionen ohne Datum. */
  leistung: string | null;
}

interface DraftInvoiceDetail extends AdminBillingInvoice {
  items: DraftInvoiceItem[];
  currency: string;
  subtotalExclTax: number;
  taxAmount: number;
  taxPercent: number;
}

interface FullInvoice extends AdminBillingInvoice {
  items: DraftInvoiceItem[];
  currency: string;
  subtotalExclTax: number;
  taxAmount: number;
  taxPercent: number;
}

const STATUS_LABELS: Record<string, string> = {
  draft:         'Entwurf',
  open:          'Offen',
  partially_paid: 'Teilbezahlt',
  paid:          'Bezahlt',
  void:          'Storniert',
  cancelled:     'Storniert',
  uncollectible: 'Überfällig',
};

function toDate(v: unknown): string {
  if (!v) return '';
  return (v as Date).toISOString().split('T')[0];
}

function mapRow(row: Record<string, unknown>): BillingInvoice {
  const gross = Number(row.gross_amount ?? 0);
  const paid  = Number(row.paid_amount ?? 0);
  const status = (row.status as string) === 'cancelled' ? 'void' : (row.status as string) as InvoiceStatus;
  return {
    id:              row.id as string,
    number:          (row.number as string) ?? '',
    date:            toDate(row.issue_date),
    dueDate:         toDate(row.due_date),
    amountDue:       gross,
    amountPaid:      paid,
    amountRemaining: gross - paid,
    status,
    statusLabel:     STATUS_LABELS[row.status as string] ?? 'Unbekannt',
    hostedUrl:       null,
    pdfUrl:          null,
  };
}

function mapAdminRow(row: Record<string, unknown>): AdminBillingInvoice {
  return {
    ...mapRow(row),
    customerName:  (row.customer_name as string)  ?? '',
    customerEmail: (row.customer_email as string) ?? '',
  };
}

// ---- Functions ----

export async function getOrCreateCustomer(params: {
  brand: string; name: string; email: string; company?: string;
  /** T015362: E2E/Systemtest-Kontext → is_test_data=true (Purge-Pfad). */
  isTestData?: boolean;
}): Promise<BillingCustomer> {
  const c = await nativeCreateCustomer({ brand: params.brand, name: params.name, email: params.email, company: params.company, isTestData: params.isTestData });
  return { id: c.id, name: c.name, email: c.email };
}

export async function getAllBillingInvoices(params?: {
  status?: string; perPage?: number;
}): Promise<AdminBillingInvoice[]> {
  await initBillingTables();
  const brand = process.env.BRAND || 'mentolder';
  const limit = params?.perPage ?? 200;
  const statusFilter = params?.status ? `AND i.status = '${params.status.replace(/'/g,"''")}'` : '';
  const r = await pool.query(
    `SELECT i.*, c.name AS customer_name, c.email AS customer_email
     FROM v_billing_invoices_with_state i
     JOIN billing_customers c ON c.id = i.customer_id AND c.brand = $1
     WHERE i.brand = $1 ${statusFilter}
     ORDER BY i.created_at DESC LIMIT $2`,
    [brand, limit]
  );
  return r.rows.map(mapAdminRow);
}

export async function getDraftInvoices(): Promise<AdminBillingInvoice[]> {
  await initBillingTables();
  const brand = process.env.BRAND || 'mentolder';
  const r = await pool.query(
    `SELECT i.*, c.name AS customer_name, c.email AS customer_email
     FROM v_billing_invoices_with_state i
     JOIN billing_customers c ON c.id = i.customer_id AND c.brand = $1
     WHERE i.brand = $1 AND i.status = 'draft'
     ORDER BY i.created_at DESC LIMIT 100`,
    [brand]
  );
  return r.rows.map(mapAdminRow);
}

export async function getCustomerInvoices(customerEmail: string): Promise<BillingInvoice[]> {
  await initBillingTables();
  const brand = process.env.BRAND || 'mentolder';
  const r = await pool.query(
    `SELECT i.* FROM v_billing_invoices_with_state i
     JOIN billing_customers c ON c.id = i.customer_id AND c.brand = $1
     WHERE i.brand = $1 AND c.email = $2
     ORDER BY i.created_at DESC LIMIT 50`,
    [brand, customerEmail]
  );
  return r.rows.map(mapRow);
}

export async function getDraftInvoiceDetail(invoiceId: string): Promise<DraftInvoiceDetail | null> {
  await initBillingTables();
  const brand = process.env.BRAND || 'mentolder';
  const r = await pool.query(
    `SELECT i.*, c.name AS customer_name, c.email AS customer_email
     FROM v_billing_invoices_with_state i
     JOIN billing_customers c ON c.id = i.customer_id AND c.brand = $1
     WHERE i.id = $2 AND i.brand = $1`,
    [brand, invoiceId]
  );
  if (!r.rows[0]) return null;
  const row = r.rows[0];
  const linesR = await pool.query(
    `SELECT *, leistung_von::text AS leistung_von_text, leistung_bis::text AS leistung_bis_text
       FROM billing_invoice_line_items WHERE invoice_id = $1 ORDER BY id`,
    [invoiceId]
  );
  const items: DraftInvoiceItem[] = linesR.rows.map((l: Record<string, unknown>) => ({
    id: String(l.id),
    description: l.description as string,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unit_price),
    amount: Number(l.net_amount),
    currency: 'EUR',
    leistung: leistungsdatumZeile({ leistungVon: l.leistung_von_text as string | null, leistungBis: l.leistung_bis_text as string | null }),
  }));
  const base = mapAdminRow(row);
  return {
    ...base,
    items,
    currency: 'EUR',
    subtotalExclTax: Number(row.net_amount ?? 0),
    taxAmount:       Number(row.tax_amount ?? 0),
    taxPercent:      Number(row.tax_rate ?? 0),
  };
}

export async function getFullInvoice(invoiceId: string): Promise<FullInvoice | null> {
  return getDraftInvoiceDetail(invoiceId);
}

/**
 * Creates a draft invoice in the native billing system for a single service line.
 *
 * This is the compatibility shim that callers from the booking-confirmation flow
 * (admin/inbox/[id]/action.ts → approve_booking) and the admin CreateInvoiceModal
 * use. The legacy name comes from the pre-2026 Stripe integration; today it
 * delegates to native-billing's `createInvoice`.
 *
 * Name, Preis (in Euro, wie native-billing ihn in `unit_price` speichert) und
 * Einheit kommen aus der gepflegten Leistung (billing-leistungen). The returned shape mirrors `BillingInvoice` so existing
 * callers (which read `id`, `number`, `amountDue`) keep working unchanged.
 */
export async function createBillingInvoice(params: {
  customerId: string;
  /** Schlüssel einer gepflegten Leistung (Admin → Leistungen). */
  serviceKey: string;
  quantity?: number;
  sendEmail?: boolean;
  /** Leistungsdatum (YYYY-MM-DD), z. B. Termin der Buchung; Pflichtangabe nach § 14 UStG. */
  leistungsdatum?: string;
  notes?: string;
  /** T015362: E2E/Systemtest-Kontext → is_test_data=true (Purge-Pfad). */
  isTestData?: boolean;
}): Promise<BillingInvoice> {
  const brand = process.env.BRAND || 'mentolder';
  // Stufe 3 T4: Preis, Name und Einheit aus der gepflegten Leistungstabelle (K1, K4).
  const service = await holeLeistung(brand, params.serviceKey);
  if (!service) throw new Error(`createBillingInvoice: unknown serviceKey "${params.serviceKey}"`);
  if (!service.aktiv) throw new Error(`createBillingInvoice: service "${params.serviceKey}" ist stillgelegt`);
  if (service.preis === null || service.preis <= 0) {
    throw new Error(`createBillingInvoice: service "${params.serviceKey}" has no chargeable price`);
  }
  const dueDays = await ladeZahlungsziel(brand);

  // Verify the customer exists in this brand to fail fast with a clear message
  // instead of a foreign-key violation deep inside the INSERT.
  const customer = await nativeGetCustomerById(brand, params.customerId);
  if (!customer) {
    throw new Error(`createBillingInvoice: customer ${params.customerId} not found for brand ${brand}`);
  }

  const quantity = params.quantity ?? 1;
  const unitPriceEur = service.preis;

  const inv = await nativeCreateInvoice({
    brand,
    customerId: params.customerId,
    issueDate: new Date().toISOString().split('T')[0],
    dueDays,
    // Steuerart kommt zentral aus der Einstellung (Befund R3) – vorher fest 19 % USt.
    lines: [{
      description: service.name,
      quantity,
      unitPrice: unitPriceEur,
      unit: service.einheit,
    }],
    servicePeriodStart: params.leistungsdatum,
    notes: params.notes,
    isTestData: params.isTestData,
  });

  return {
    id: inv.id,
    number: inv.number,
    date: inv.issueDate,
    dueDate: inv.dueDate,
    amountDue: inv.grossAmount,
    amountPaid: 0,
    amountRemaining: inv.grossAmount,
    status: 'draft',
    statusLabel: STATUS_LABELS.draft ?? 'Entwurf',
    hostedUrl: null,
    pdfUrl: null,
  };
}

export async function createBillingQuote(_params: unknown): Promise<unknown> {
  throw new Error('createBillingQuote: use native billing instead');
}

export async function createMonthlyDraftInvoices(_params: unknown): Promise<unknown[]> {
  logger.warn('[stripe-billing] createMonthlyDraftInvoices: native billing only');
  return [];
}

export async function updateDraftInvoiceItem(_itemId: string, _params: unknown): Promise<void> {
  logger.warn('[stripe-billing] updateDraftInvoiceItem: use native billing item routes');
}

export async function addDraftInvoiceItem(_invoiceId: string, _params: unknown): Promise<DraftInvoiceItem> {
  throw new Error('addDraftInvoiceItem: use native billing item routes instead');
}

export async function deleteDraftInvoiceItem(_itemId: string): Promise<void> {
  logger.warn('[stripe-billing] deleteDraftInvoiceItem: use native billing item routes');
}
