import { pool, initBillingTables } from './website-db';
import { datenBeimFestschreiben, entwurfsKennung, istEntwurfsKennung, naechsteNummer, zahlungsreferenz } from './billing-nummer';
import { checkAndApplyTaxModeSwitch, resolveEffectiveTaxMode } from './tax-monitor';
import { canonicalInvoiceForHash, sha256Hex, type HashableLine } from './invoice-hash';
import { logBillingEvent, type BillingActor } from './billing-audit';
import { validateLeitwegId, formatLeitwegId } from './leitweg';
import { ladeAbsender } from './billing-absender';
import { initPostenTabelle, postenAbgerechnet } from './billing-posten';
import { ladeZahlungsziel } from './billing-regeln';
import { aktuellerEmpfaenger, AnschriftFehlt, fehlendeAngaben, kaeuferName, leseEmpfaenger, type Empfaenger } from './billing-empfaenger';
import type { PoolClient } from 'pg';

export { initBillingTables };

export interface Customer {
  id: string; brand: string; name: string; email: string;
  customerNumber?: string;
  company?: string; addressLine1?: string; city?: string;
  postalCode?: string; landIso: string; vatNumber?: string;
  sepaIban?: string; sepaBic?: string;
  leitwegId?: string;
  sepaMandateRef?: string; sepaMandateDate?: string;
  defaultLeitwegId?: string;
}

export async function createCustomer(p: {
  brand: string; name: string; email: string; company?: string;
  addressLine1?: string; city?: string; postalCode?: string;
  vatNumber?: string; leitwegId?: string;
  /** T015362: von E2E/Systemtests erzeugte Kunden werden markiert (Purge-Pfad). */
  isTestData?: boolean;
}): Promise<Customer> {
  await initBillingTables();
  const r = await pool.query(
    `INSERT INTO billing_customers (brand, name, email, company, address_line1, city, postal_code, vat_number, typ, leitweg_id, is_test_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Kunde',$9,$10)
     ON CONFLICT (brand, email, typ) DO UPDATE
       SET name=EXCLUDED.name, company=EXCLUDED.company,
           address_line1=EXCLUDED.address_line1, city=EXCLUDED.city,
           postal_code=EXCLUDED.postal_code, vat_number=EXCLUDED.vat_number,
           leitweg_id=EXCLUDED.leitweg_id,
           is_test_data = billing_customers.is_test_data OR EXCLUDED.is_test_data
     RETURNING *`,
    [p.brand, p.name, p.email, p.company??null, p.addressLine1??null,
     p.city??null, p.postalCode??null, p.vatNumber??null, p.leitwegId??null,
     p.isTestData ?? false]
  );
  return mapCustomer(r.rows[0]);
}

export async function setBillingCustomerLeitwegId(
  id: string,
  raw: string | null,
): Promise<{ ok: true; value: string | null } | { ok: false; reason: string }> {
  await initBillingTables();
  if (raw === null || raw === '') {
    await pool.query(`UPDATE billing_customers SET leitweg_id = NULL WHERE id = $1`, [id]);
    return { ok: true, value: null };
  }
  const v = validateLeitwegId(raw);
  if (!v.ok) return { ok: false, reason: v.reason ?? 'Format ungültig' };
  const value = formatLeitwegId(raw);
  const r = await pool.query(
    `UPDATE billing_customers SET leitweg_id = $1 WHERE id = $2 RETURNING id`,
    [value, id],
  );
  if (r.rowCount === 0) return { ok: false, reason: 'Kunde nicht gefunden' };
  return { ok: true, value };
}

export async function getCustomerByEmail(brand: string, email: string): Promise<Customer | null> {
  await initBillingTables();
  const r = await pool.query(`SELECT * FROM billing_customers WHERE brand=$1 AND email=$2`, [brand, email]);
  return r.rows[0] ? mapCustomer(r.rows[0]) : null;
}

export async function getCustomerById(brand: string, id: string): Promise<Customer | null> {
  await initBillingTables();
  const r = await pool.query(`SELECT * FROM billing_customers WHERE id=$1 AND brand=$2`, [id, brand]);
  return r.rows[0] ? mapCustomer(r.rows[0]) : null;
}

// Invoice / InvoiceLine moved to invoice-types.ts (G-CQ07) so invoice-pdf.ts
// can import the type without creating a static cycle. Re-export for backward
// compatibility with any external caller that imports these names here.
export type { Invoice, InvoiceLine } from './invoice-types';
import type { Invoice, InvoiceLine } from './invoice-types';

export async function createInvoice(params: {
  brand: string; customerId: string; issueDate: string; dueDays: number;
  /** Weglassen = zentrale Einstellung (resolveEffectiveTaxMode). Übergeben nur, wo eine
   *  bestehende Rechnung fortgeführt wird (z. B. Schlussrechnung zu einer Anzahlung). */
  taxMode?: 'kleinunternehmer' | 'regelbesteuerung';
  taxRate?: number; lines: InvoiceLine[]; notes?: string;
  servicePeriodStart?: string; servicePeriodEnd?: string;
  leitwegId?: string;
  currency?: string;
  supplyType?: string;
  kind?: 'regular' | 'prepayment' | 'final' | 'gutschrift';
  parentInvoiceId?: string;
  /** T015362: von E2E/Systemtests erzeugte Rechnungen werden markiert (Purge-Pfad). */
  isTestData?: boolean;
  /** N2: eigenes Zahlungsziel dieser Rechnung (gilt auch beim Festschreiben); sonst die Einstellung. */
  zahlungszielTage?: number;
}, db?: PoolClient): Promise<Invoice> {
  // `db`: laufende Transaktion des Aufrufers (Stufe 3 T10a: Posten sperren und Entwurf
  // anlegen gelingen zusammen oder gar nicht). Ohne `db` eigene Transaktion wie bisher.
  await initBillingTables();
  // Eine Steuerart für alle Rechnungswege (Befund R3, Gerald 19.10.2026):
  // sonst weist ein Kleinunternehmer womöglich USt aus und schuldet sie (§ 14c UStG).
  const taxMode = params.taxMode ?? await resolveEffectiveTaxMode(params.brand);
  // Reverse charge enforcement
  let p = params;
  const hasAeLines = (p.lines as Array<InvoiceLine & { taxCategory?: string }>)
    .some(l => l.taxCategory === 'AE');
  if (hasAeLines) {
    const customer = await getCustomerById(p.brand, p.customerId);
    if (!customer?.vatNumber) {
      throw new Error('Reverse charge (AE) requires a VAT ID on the customer');
    }
    if (!p.supplyType) p = { ...p, supplyType: 'eu_b2b_services' };
  }
  const currency = (p.currency ?? 'EUR').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`Invalid currency code: ${p.currency}`);
  let currencyRate: number | null = null;
  if (currency !== 'EUR') {
    const { fetchEcbRates, eurPer } = await import('./ecb-exchange-rates');
    const rates = await fetchEcbRates();
    currencyRate = eurPer(currency, rates);
  }
  // Stufe 3 T12: Entwürfe bekommen nur eine Kennung; die Nummer vergibt finalizeInvoice (K33–K35).
  const number = entwurfsKennung();
  const issueDate = new Date(p.issueDate);
  const dueDate = new Date(issueDate);
  dueDate.setDate(dueDate.getDate() + p.dueDays);

  const netAmount = p.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const taxRate   = taxMode === 'kleinunternehmer' ? 0 : (p.taxRate ?? 19);
  const taxAmount = Math.round(netAmount * (taxRate / 100) * 100) / 100;
  const grossAmount = netAmount + taxAmount;
  const netAmountEur  = currencyRate !== null ? Math.round(netAmount * currencyRate * 100) / 100 : netAmount;
  const grossAmountEur = currencyRate !== null ? Math.round(grossAmount * currencyRate * 100) / 100 : grossAmount;
  const paymentRef = null; // folgt der Nummer beim Festschreiben
  const kind = p.kind ?? 'regular';

  const client = db ?? await pool.connect();
  try {
    if (!db) await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO billing_invoices (brand, number, customer_id, issue_date, due_date,
         service_period_start, service_period_end, tax_mode, net_amount, tax_rate,
         tax_amount, gross_amount, notes, payment_reference, leitweg_id,
         currency, currency_rate, net_amount_eur, gross_amount_eur, supply_type,
         kind, parent_invoice_id, is_test_data, zahlungsziel_tage)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`,
      [p.brand, number, p.customerId, p.issueDate,
       dueDate.toISOString().split('T')[0],
       p.servicePeriodStart??null, p.servicePeriodEnd??null,
       taxMode, netAmount, taxRate, taxAmount, grossAmount,
       p.notes??null, paymentRef, p.leitwegId??null,
       currency, currencyRate, netAmountEur, grossAmountEur, p.supplyType??null,
       kind, p.parentInvoiceId??null, p.isTestData ?? false, p.zahlungszielTage ?? null]
    );
    const inv = r.rows[0];
    // Nacheinander, damit die Positionen in der gewählten Reihenfolge ihre id bekommen
    // (Anzeige, PDF und Prüfsumme ordnen nach id).
    for (const l of p.lines) {
      await client.query(
        `INSERT INTO billing_invoice_line_items (invoice_id,description,quantity,unit,unit_price,net_amount,is_test_data,
           leistung_von,leistung_bis,posten_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [inv.id, l.description, l.quantity, l.unit??null, l.unitPrice, l.quantity*l.unitPrice, p.isTestData ?? false,
         l.leistungVon ?? null, l.leistungBis ?? null, l.postenId ?? null]
      );
    }
    if (!db) await client.query('COMMIT');
    return mapInvoice(inv);
  } catch (e) {
    if (!db) await client.query('ROLLBACK');
    throw e;
  } finally {
    if (!db) client.release();
  }
}

export async function getInvoice(id: string): Promise<Invoice | null> {
  await initBillingTables();
  // T000375: paid_amount/paid_at existieren nur noch in v_billing_invoices_with_state.
  const r = await pool.query(`SELECT * FROM v_billing_invoices_with_state WHERE id=$1`, [id]);
  return r.rows[0] ? mapInvoice(r.rows[0]) : null;
}

export interface FinalizeOpts {
  actor?: BillingActor;
  pdfBlob?: Buffer;
  pdfMime?: string;
  invoiceInput?: InvoiceInput;
  /** Stufe 3 T11: Empfänger, der festgeschrieben wird (sonst heutiger Stand aus der Akte). */
  empfaenger?: Empfaenger;
  /**
   * Stufe 3 T12: PDF und E-Rechnung erst erzeugen, wenn Nummer und Rechnungsdatum feststehen
   * (innerhalb der Transaktion; scheitert es, wird auch die Nummer nicht verbraucht).
   * Ersetzt pdfBlob/invoiceInput.
   */
  dokumente?: (kopf: { number: string; issueDate: string; dueDate: string; paymentReference: string | null }) =>
    Promise<{ pdfBlob?: Buffer; invoiceInput?: InvoiceInput }>;
  /** Für Tests: „jetzt“ beim Festschreiben. */
  jetzt?: Date;
  /** N2: Zahlungsziel nur für diese Rechnung (0–365 Tage). */
  zahlungszielTage?: number;
}

export async function finalizeInvoice(id: string, opts: FinalizeOpts = {}): Promise<Invoice | null> {
  await initBillingTables();
  await initPostenTabelle();

  // Stufe 3 T11: Empfänger festhalten (K31, K32); ohne vollständige Anschrift kein Festschreiben.
  let empfaenger: Empfaenger | null = opts.empfaenger ?? null;
  const kopfVorab = (await pool.query(`SELECT brand, customer_id, klient_id::text AS klient_id, zahlungsziel_tage FROM billing_invoices WHERE id=$1 AND status='draft'`, [id])).rows[0];
  if (!empfaenger && kopfVorab) {
    empfaenger = await aktuellerEmpfaenger(kopfVorab.brand, kopfVorab.customer_id, { klientId: kopfVorab.klient_id });
  }
  // Prüfung L3 (B3, K38): Zahlungsziel aus der heutigen Einstellung – erst jetzt wird es eine Rechnung.
  // Vor der Transaktion gelesen, damit dort nur Rechnung und Zähler berührt werden.
  // N2: im Einzelfall eigenes Ziel (beim Versand gewählt oder beim Anlegen mitgegeben), sonst die Einstellung.
  const zielTage = opts.zahlungszielTage
    ?? (kopfVorab?.zahlungsziel_tage != null ? Number(kopfVorab.zahlungsziel_tage) : undefined)
    ?? (kopfVorab ? await ladeZahlungsziel(kopfVorab.brand) : undefined);
  if (empfaenger) {
    const fehlt = fehlendeAngaben(empfaenger);
    if (fehlt.length > 0) throw new AnschriftFehlt(fehlt);
  }

  const client = await pool.connect();
  let inv: Invoice;
  let hash: string;
  let pdfBytes: number | null = null;
  try {
    await client.query('BEGIN');
    // Stufe 3 T12: Nummer und Rechnungsdatum erst jetzt, im selben Zug wie das Festschreiben (K34, K35).
    // Ältere Entwürfe, die noch eine echte Nummer tragen, behalten sie samt Datum.
    const vorher = await client.query(
      `SELECT brand, number, issue_date::text AS issue_date, due_date::text AS due_date
         FROM billing_invoices WHERE id=$1 AND status='draft' FOR UPDATE`, [id]);
    if (!vorher.rows[0]) { await client.query('ROLLBACK'); return null; }
    let kopf: { number: string; issueDate: string | null; dueDate: string | null; paymentReference: string | null } =
      { number: vorher.rows[0].number, issueDate: null, dueDate: null, paymentReference: null };
    if (istEntwurfsKennung(vorher.rows[0].number)) {
      const d = datenBeimFestschreiben(vorher.rows[0].issue_date, vorher.rows[0].due_date, opts.jetzt ?? new Date(), zielTage);
      const number = await naechsteNummer(client, vorher.rows[0].brand, d.jahr);
      kopf = { number, issueDate: d.issueDate, dueDate: d.dueDate, paymentReference: zahlungsreferenz(number) };
    }
    const upd = await client.query(
      `UPDATE billing_invoices
         SET status='open', locked=true, finalized_at=now(), updated_at=now(), empfaenger=$2::jsonb,
             number=$3, issue_date=COALESCE($4::date, issue_date), due_date=COALESCE($5::date, due_date),
             payment_reference=COALESCE($6, payment_reference), zahlungsziel_tage=COALESCE($7, zahlungsziel_tage)
       WHERE id=$1 AND status='draft' RETURNING *`,
      [id, empfaenger ? JSON.stringify(empfaenger) : null, kopf.number, kopf.issueDate, kopf.dueDate, kopf.paymentReference, opts.zahlungszielTage ?? null]
    );
    if (!upd.rows[0]) { await client.query('ROLLBACK'); return null; }
    const row = upd.rows[0];
    inv = mapInvoice(row);
    // Stufe 3 T10a: Posten dieses Entwurfs sind jetzt abgerechnet (K23).
    await postenAbgerechnet(client, id);

    let pdfBlob = opts.pdfBlob;
    let invoiceInput = opts.invoiceInput;
    if (opts.dokumente) {
      const d = await opts.dokumente({
        number: inv.number, issueDate: row.issue_date instanceof Date ? isoTag(row.issue_date) : String(row.issue_date).slice(0, 10),
        dueDate: row.due_date instanceof Date ? isoTag(row.due_date) : String(row.due_date).slice(0, 10),
        paymentReference: (row.payment_reference as string | null) ?? null,
      });
      pdfBlob = d.pdfBlob;
      invoiceInput = d.invoiceInput;
    }

    if (invoiceInput) {
      const { generateFacturX } = await import('./einvoice/factur-x');
      const { generateXRechnung } = await import('./einvoice/xrechnung');
      const { embedFacturX } = await import('./pdf-a3-embed');
      const { createSidecarClient, sidecarBaseUrlFromEnv, SidecarUnavailableError } = await import('./einvoice/sidecar-client');

      const facturXXml = generateFacturX(invoiceInput);
      const xrechnungXml = invoiceInput.buyer.leitwegId ? generateXRechnung(invoiceInput) : null;

      let pdfA3: Buffer | undefined = pdfBlob;
      let validation: Awaited<ReturnType<ReturnType<typeof createSidecarClient>['validate']>> | null = null;

      if (pdfBlob && process.env.EINVOICE_SIDECAR_ENABLED === 'true') {
        try {
          pdfA3 = await embedFacturX(pdfBlob, facturXXml);
          const client = createSidecarClient(sidecarBaseUrlFromEnv());
          validation = await client.validate({ pdf: pdfA3 });
          if (!validation.ok && validation.errors.length > 0) {
            throw new Error(`E-invoice validation failed: ${validation.errors.join('; ')}`);
          }
        } catch (e) {
          if (e instanceof SidecarUnavailableError) throw new Error('E-invoice sidecar unavailable; finalization aborted.');
          throw e;
        }
      }

      await client.query(
        `UPDATE billing_invoices
             SET einvoice_validated_at=$2,
                 einvoice_validation_report=$3
           WHERE id=$1`,
        [id, validation ? new Date() : null, validation ? JSON.stringify(validation) : null]
      );
      const einvoiceDocs: [string, Buffer | string | null][] = [
        ['factur-x', facturXXml],
        ['xrechnung', xrechnungXml],
        ['pdf-a3', pdfA3 ?? null],
      ];
      for (const [fmt, content] of einvoiceDocs) {
        if (content == null) continue;
        await client.query(
          `INSERT INTO billing_invoice_documents (invoice_id, format, content)
           VALUES ($1, $2, $3::bytea)
           ON CONFLICT (invoice_id, format) DO UPDATE SET content = EXCLUDED.content`,
          [id, fmt, typeof content === 'string' ? Buffer.from(content, 'utf8') : content]
        );
      }
    }

    const linesR = await client.query(
      `SELECT id, description, quantity, unit_price, net_amount, unit,
              leistung_von::text AS leistung_von, leistung_bis::text AS leistung_bis
         FROM billing_invoice_line_items WHERE invoice_id=$1 ORDER BY id`,
      [id]
    );
    const lines: HashableLine[] = linesR.rows.map((l: Record<string, unknown>) => ({
      id: Number(l.id),
      description: l.description as string,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unit_price),
      netAmount: Number(l.net_amount),
      unit: (l.unit as string) ?? undefined,
      leistungVon: (l.leistung_von as string | null) ?? undefined,
      leistungBis: (l.leistung_bis as string | null) ?? undefined,
    }));
    hash = sha256Hex(canonicalInvoiceForHash({
      id: inv.id, number: inv.number, brand: inv.brand, customerId: inv.customerId,
      issueDate: inv.issueDate, dueDate: inv.dueDate,
      servicePeriodStart: inv.servicePeriodStart, servicePeriodEnd: inv.servicePeriodEnd,
      taxMode: inv.taxMode, netAmount: inv.netAmount,
      taxRate: inv.taxRate, taxAmount: inv.taxAmount, grossAmount: inv.grossAmount,
      empfaenger: (row.empfaenger as Record<string, unknown> | null) ?? null,
    }, lines));
    await client.query(
      `UPDATE billing_invoices
         SET hash_sha256=$2,
             pdf_mime=$3,
             pdf_size_bytes=$4
       WHERE id=$1`,
      [id, hash,
       opts.pdfMime ?? (pdfBlob ? 'application/pdf' : null),
       pdfBlob?.length ?? null]
    );
    if (pdfBlob) {
      await client.query(
        `INSERT INTO billing_invoice_documents (invoice_id, format, content)
         VALUES ($1, 'pdf', $2)
         ON CONFLICT (invoice_id, format) DO UPDATE SET content = EXCLUDED.content`,
        [id, pdfBlob]
      );
    }

    if (pdfBlob) {
      const { archiveBillingPdf } = await import('./billing-archive');
      const pdfPath = await archiveBillingPdf({
        brand: inv.brand,
        invoiceNumber: inv.number,
        filename: `${inv.number}.pdf`,
        content: pdfBlob,
      });
      if (pdfPath) {
        await client.query(`UPDATE billing_invoices SET pdf_path=$2 WHERE id=$1`, [id, pdfPath]);
      }
    }

    pdfBytes = pdfBlob?.length ?? null;
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  await checkAndApplyTaxModeSwitch(inv.brand, id);
  await logBillingEvent({
    invoiceId: id,
    action: 'finalize',
    actor: opts.actor,
    fromStatus: 'draft',
    toStatus: 'open',
    metadata: { hash, pdfBytes },
  });
  return inv;
}

import { recordPayment } from './invoice-payments';

export async function markInvoicePaid(
  id: string,
  p: { paidAt: string; paidAmount: number },
  actor?: BillingActor,
): Promise<Invoice | null> {
  await initBillingTables();
  const cur = await pool.query(
    `SELECT status FROM billing_invoices WHERE id=$1`, [id],
  );
  if (!cur.rows[0]) return null;
  if (cur.rows[0].status === 'paid') return getInvoice(id);
  if (cur.rows[0].status !== 'open' && cur.rows[0].status !== 'partially_paid') {
    return null;
  }

  const fromStatus = cur.rows[0].status;
  await recordPayment({
    invoiceId:  id,
    paidAt:     p.paidAt,
    amount:     p.paidAmount,
    method:     'legacy',
    recordedBy: actor?.userId ?? 'system',
    notes:      'markInvoicePaid shim',
  });
  const after = await getInvoice(id);
  await logBillingEvent({
    invoiceId: id,
    action: 'mark_paid',
    actor,
    fromStatus,
    toStatus: after?.status ?? 'paid',
    metadata: { paidAt: p.paidAt, paidAmount: p.paidAmount },
  });
  return after;
}

/** Kalendertag eines DATE-Werts (pg liefert Mitternacht in Ortszeit). */
function isoTag(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mapInvoice(row: Record<string, unknown>): Invoice {
  const toDate = (v: unknown) => v ? (v as Date).toISOString().split('T')[0] : undefined;
  return {
    id: row.id as string, brand: row.brand as string,
    number: row.number as string, status: row.status as string,
    customerId: row.customer_id as string,
    issueDate: toDate(row.issue_date)!,
    dueDate:   toDate(row.due_date)!,
    taxMode:   row.tax_mode as string,
    netAmount: Number(row.net_amount),
    taxRate:   Number(row.tax_rate),
    taxAmount: Number(row.tax_amount),
    grossAmount: Number(row.gross_amount),
    notes: (row.notes as string) ?? undefined,
    paymentReference: (row.payment_reference as string) ?? undefined,
    paidAt: toDate(row.paid_at),
    paidAmount: row.paid_amount ? Number(row.paid_amount) : undefined,
    locked: Boolean(row.locked),
    cancelledInvoiceId: (row.cancels_invoice_id as string) ?? undefined,
    servicePeriodStart: toDate(row.service_period_start),
    servicePeriodEnd: toDate(row.service_period_end),
    leitwegId: (row.leitweg_id as string) ?? undefined,
    currency: (row.currency as string) ?? 'EUR',
    currencyRate: row.currency_rate != null ? Number(row.currency_rate) : null,
    netAmountEur: row.net_amount_eur != null ? Number(row.net_amount_eur) : Number(row.net_amount),
    grossAmountEur: row.gross_amount_eur != null ? Number(row.gross_amount_eur) : Number(row.gross_amount),
    supplyType: (row.supply_type as string) ?? undefined,
    kind: ((row.kind as string) ?? 'regular') as 'regular' | 'prepayment' | 'final' | 'gutschrift',
    parentInvoiceId: (row.parent_invoice_id as string) ?? undefined,
  };
}

function mapCustomer(row: Record<string, unknown>): Customer {
  return {
    id: row.id as string, brand: row.brand as string,
    name: row.name as string, email: row.email as string,
    customerNumber: (row.customer_number as string) ?? undefined,
    company: (row.company as string) ?? undefined,
    addressLine1: (row.address_line1 as string) ?? undefined,
    city: (row.city as string) ?? undefined,
    postalCode: (row.postal_code as string) ?? undefined,
    landIso: (row.land_iso as string) ?? 'DE',
    vatNumber: (row.vat_number as string) ?? undefined,
    sepaIban: (row.sepa_iban as string) ?? undefined,
    sepaBic: (row.sepa_bic as string) ?? undefined,
    leitwegId: (row.leitweg_id as string) ?? undefined,
    sepaMandateRef: (row.sepa_mandate_ref as string) ?? undefined,
    sepaMandateDate: (() => {
      const md = row.sepa_mandate_date;
      if (md instanceof Date)
        return `${md.getFullYear()}-${String(md.getMonth() + 1).padStart(2, '0')}-${String(md.getDate()).padStart(2, '0')}`;
      return (md as string | null) ?? undefined;
    })(),
    defaultLeitwegId: (row.default_leitweg_id as string) ?? undefined,
  };
}

import type { EInvoiceInput } from './einvoice-types';
import type { InvoiceInput } from './einvoice/types';

/**
 * Loads a finalized invoice and assembles the EInvoiceInput payload used by
 * the e-invoice generators (Factur-X minimum, XRechnung CII, XRechnung UBL).
 * Seller data comes from the invoice settings (billing-absender), SELLER_* only as fallback.
 */
export async function getInvoiceForEInvoice(id: string): Promise<EInvoiceInput | null> {
  await initBillingTables();
  const r = await pool.query(
    `SELECT i.*, c.name AS c_name, c.email AS c_email, c.address_line1 AS c_addr,
            c.postal_code AS c_zip, c.city AS c_city, c.leitweg_id AS c_leitweg
       FROM billing_invoices i
       JOIN billing_customers c ON c.id = i.customer_id
      WHERE i.id = $1`,
    [id]
  );
  const row = r.rows[0];
  if (!row) return null;
  const lines = (
    await pool.query(
      // Datum als Text: ein DATE als JS-Date verrutscht je nach Zeitzone um einen Tag.
      `SELECT *, leistung_von::text AS leistung_von_text, leistung_bis::text AS leistung_bis_text
         FROM billing_invoice_line_items WHERE invoice_id = $1 ORDER BY id`,
      [id]
    )
  ).rows;

  const absender = await ladeAbsender(row.brand);
  const kopie = leseEmpfaenger(row.empfaenger);

  const toIsoDate = (v: unknown): string => {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'string') return v.slice(0, 10);
    return String(v);
  };

  return {
    invoice: {
      number: row.number,
      issueDate: toIsoDate(row.issue_date),
      dueDate: toIsoDate(row.due_date),
      grossAmount: Number(row.gross_amount),
      netAmount: Number(row.net_amount),
      taxAmount: Number(row.tax_amount),
      taxMode: row.tax_mode,
      taxRate: Number(row.tax_rate),
      paymentReference: row.payment_reference ?? undefined,
    },
    lines: lines.map((l) => ({
      description: l.description,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unit_price),
      unit: l.unit ?? 'C62',
      // Stufe 3 T10a: Leistungszeitraum der Position (BG-26).
      periodStart: l.leistung_von_text ?? undefined,
      periodEnd: l.leistung_bis_text ?? undefined,
    })),
    // Stufe 3 T11: festgeschriebener Empfänger (K31); ältere Rechnungen ohne Kopie wie bisher.
    customer: kopie ? {
      name: kaeuferName(kopie),
      email: kopie.email,
      addressLine1: kopie.addressLine1 ?? undefined,
      postalCode: kopie.postalCode ?? undefined,
      city: kopie.city ?? undefined,
      country: kopie.country,
      leitwegId: row.leitweg_id ?? row.c_leitweg ?? undefined,
    } : {
      name: row.c_name,
      email: row.c_email,
      addressLine1: row.c_addr ?? undefined,
      postalCode: row.c_zip ?? undefined,
      city: row.c_city ?? undefined,
      country: 'DE',
      leitwegId: row.c_leitweg ?? undefined,
    },
    // Stufe 3 T1b: Absender aus den Einstellungen, SELLER_* nur Rückfall.
    seller: {
      name:       absender.name || 'Unbekannt',
      address:    absender.address,
      postalCode: absender.postalCode,
      city:       absender.city,
      country:    absender.country,
      vatId:      absender.vatId,
      taxNumber:  absender.taxNumber || undefined,
      iban:       absender.iban || undefined,
      bic:        absender.bic || undefined,
      email:      absender.email || undefined,
      phone:      absender.phone || undefined,
    },
  };
}
