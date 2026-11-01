import { pool, initBillingTables } from './website-db';
import { getInvoice, getCustomerById, type Invoice, type Customer } from './native-billing';
import { alsKunde, leseEmpfaenger } from './billing-empfaenger';
import { generateDunningPdf, type InvoicePdfCustomer, type InvoicePdfSeller } from './invoice-pdf';
import { archiveBillingPdf } from './billing-archive';
import { ladeAbsender } from './billing-absender';
import { logBillingEvent } from './billing-audit';
import { mahnungsDateiname } from './beleg-dateiname';
import { ladeMahnEinstellungen, gebuehrFuer } from './mahn-einstellungen';

export interface PendingDunning {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  level: number;
  customerEmail: string;
  customerName: string;
  outstanding: number;
  feeAmount: number;
  interestAmount: number;
  pdfPath: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function buildDunningPdf(params: {
  brand: string;
  invoice: Invoice;
  customer: Customer;
  level: number;
  outstanding: number;
  feeAmount: number;
  interestAmount: number;
  /** Beleg-Design (K109): Kundennummer aus der Klientenakte. */
  kundennummer?: string | null;
  /** K165: Stufentext (Platzhalter ersetzt), feste Frist und Datum des Schreibens. */
  haupttext?: string; frist?: string; datum?: Date;
}): Promise<Buffer> {
  // Prüfung Runde 1 (K36, K36a): Absender aus derselben Quelle wie alle Rechnungen.
  const absender = await ladeAbsender(params.brand);

  const customer: InvoicePdfCustomer = {
    name: params.customer.name,
    company: params.customer.company,
    addressLine1: params.customer.addressLine1,
    city: params.customer.city,
    postalCode: params.customer.postalCode,
    country: params.customer.landIso,
    email: params.customer.email,
    // Beleg-Design (K109): Kundennummer aus der Klientenakte (kommt mit der Abfrage der Rechnung).
    customerNumber: params.kundennummer ?? undefined,
  };

  const seller: InvoicePdfSeller = { ...absender, name: absender.name || params.brand };

  return generateDunningPdf({
    dunning: {
      id: '', // not needed for PDF
      invoiceId: params.invoice.id,
      brand: params.brand,
      level: params.level,
      generatedAt: (params.datum ?? new Date()).toISOString(),
      feeAmount: params.feeAmount,
      interestAmount: params.interestAmount,
      outstandingAtGeneration: params.outstanding,
    },
    invoice: params.invoice,
    customer,
    seller,
    haupttext: params.haupttext,
    frist: params.frist,
  });
}

export async function runDunningDetection(brand: string): Promise<{ generated: number; skipped: number }> {
  await initBillingTables();
  // K165 (01.11.2026): Gebühren, Zinsen und Abstand aus Einstellungen → Regeln (Abschnitt Mahnwesen).
  const mahn = await ladeMahnEinstellungen(brand);
  const intervalDays = mahn.abstandTage;
  const interestPa = mahn.zinsenProzent;
  const rows = await pool.query<{
    id: string;
    number: string;
    status: string;
    dunning_level: number;
    due_date: Date;
    last_dunning_at: Date | null;
    gross_amount: number;
    paid_amount: number | null;
    customer_id: string;
    empfaenger: unknown;
    kundennummer: string | null;
    issue_date: string;
    vorige_sent_at: Date | null;
    vorige_frist: string | null;
    pause_bis: string | null;
  }>(
    // T000375 (View-Migration): paid_amount/dunning_level/last_dunning_at sind
    // keine Spalten von billing_invoices mehr, sondern werden von
    // v_billing_invoices_with_state aus billing_invoice_payments bzw.
    // billing_invoice_dunnings berechnet.
    `SELECT id, number, status, dunning_level, due_date, last_dunning_at, gross_amount, paid_amount, customer_id,
            issue_date::text AS issue_date,
            (SELECT b.empfaenger FROM billing_invoices b WHERE b.id = v.id) AS empfaenger,
            (SELECT c.customer_number FROM billing_invoices b JOIN customers c ON c.id = b.klient_id WHERE b.id = v.id) AS kundennummer,
            -- Prüfung G1 (01.11.2026): Versand und Frist der letzten Stufe.
            (SELECT d.sent_at FROM billing_invoice_dunnings d WHERE d.invoice_id = v.id ORDER BY d.level DESC LIMIT 1) AS vorige_sent_at,
            (SELECT d.frist::text FROM billing_invoice_dunnings d WHERE d.invoice_id = v.id ORDER BY d.level DESC LIMIT 1) AS vorige_frist,
            -- N32 (01.11.2026): nach „Mahnung verwerfen“ bis zu diesem Tag nicht mahnen.
            (SELECT p.bis::text FROM billing_mahnpausen p WHERE p.invoice_id = v.id) AS pause_bis
       FROM v_billing_invoices_with_state v
      WHERE brand=$1
        AND status IN ('open','partially_paid','overdue','dunning_1','dunning_2')
        -- N33 (01.11.2026): beendete Mahnverfahren (abgeschrieben, übergeben, eingestellt) nicht weiter mahnen.
        AND NOT EXISTS (SELECT 1 FROM billing_mahnabschluss a WHERE a.invoice_id = v.id)
        AND locked=true`,
    [brand]
  );

  let generated = 0;
  let skipped = 0;
  for (const row of rows.rows) {
    const dueDate = new Date(row.due_date);
    const outstanding = round2(Number(row.gross_amount) - Number(row.paid_amount ?? 0));
    if (outstanding <= 0) { skipped++; continue; }
    const daysOverdue = Math.floor((Date.now() - dueDate.getTime()) / 86_400_000);
    if (daysOverdue <= 0) { skipped++; continue; }

    const nextLevel = Math.min(3, Number(row.dunning_level ?? 0) + 1);
    // Prüfung G1 (01.11.2026): Die nächste Stufe erst, wenn die vorige VERSCHICKT ist, ihre Frist abgelaufen ist
    // und der Abstand seit dem Versand erreicht ist – sonst hieße es „trotz meiner Zahlungserinnerung“, obwohl
    // keine rausging. Ohne vorige Stufe zählt nur die Fälligkeit.
    const hatVorige = Number(row.dunning_level ?? 0) > 0;
    const vorigeVerschickt = !hatVorige || !!row.vorige_sent_at;
    const heuteBerlin = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    if (row.pause_bis && row.pause_bis >= heuteBerlin) { skipped++; continue; }
    const fristVorbei = !row.vorige_frist || heuteBerlin > row.vorige_frist;
    const abstandErreicht = !hatVorige || !row.vorige_sent_at
      || (Date.now() - new Date(row.vorige_sent_at).getTime()) / 86_400_000 >= intervalDays;
    if (!vorigeVerschickt || !fristVorbei || !abstandErreicht || Number(row.dunning_level ?? 0) >= 3) { skipped++; continue; }

    const invoice = await getInvoice(row.id);
    if (!invoice) { skipped++; continue; }
    const rechnungskunde = await getCustomerById(brand, row.customer_id);
    if (!rechnungskunde) { skipped++; continue; }
    // Stufe 3 T11: Mahnung an den Empfänger, der auf der Rechnung steht (K31).
    const kopie = leseEmpfaenger(row.empfaenger);
    const customer = kopie ? alsKunde(rechnungskunde, kopie) : rechnungskunde;

    const feeAmount = gebuehrFuer(mahn, nextLevel);
    const interestAmount = round2(outstanding * daysOverdue * interestPa / 100 / 365);
    const pdf = await buildDunningPdf({
      brand,
      invoice,
      customer,
      kundennummer: row.kundennummer,
      level: nextLevel,
      outstanding,
      feeAmount,
      interestAmount,
    });
    // K119: sprechender Name auch in der Ablage.
    const dateiname = mahnungsDateiname({
      stufe: nextLevel, datum: new Date(), rechnungsnummer: invoice.number, rechnungsdatum: row.issue_date ?? invoice.issueDate,
      kundennummer: row.kundennummer, empfaenger: customer,
    });
    const pdfPath = await archiveBillingPdf({
      brand,
      invoiceNumber: invoice.number,
      filename: dateiname,
      content: pdf,
    }) ?? `Billing/${brand}/${invoice.number}/${dateiname}`;

    try {
      await pool.query(
        `INSERT INTO billing_invoice_dunnings
           (invoice_id, brand, level, fee_amount, interest_amount, outstanding_at_generation, pdf_path)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [invoice.id, brand, nextLevel, feeAmount, interestAmount, outstanding, pdfPath]
      );
    } catch {
      skipped++;
      continue;
    }

    // T000375: dunning_level/last_dunning_at liegen seit der View-Migration in
    // billing_invoice_dunnings (Zeile oben), nicht mehr auf billing_invoices —
    // hier wird nur noch der Status fortgeschrieben.
    await pool.query(
      `UPDATE billing_invoices
          SET status=$2, updated_at=now()
        WHERE id=$1`,
      [invoice.id, `dunning_${nextLevel}`]
    );
    await logBillingEvent({
      invoiceId: invoice.id,
      action: 'dunning_generated',
      fromStatus: invoice.status,
      toStatus: `dunning_${nextLevel}`,
      metadata: { level: nextLevel, feeAmount, interestAmount, pdfPath },
    });
    generated++;
  }

  return { generated, skipped };
}

export async function listPendingDunnings(brand: string): Promise<PendingDunning[]> {
  await initBillingTables();
  const r = await pool.query(
    `SELECT d.id, d.invoice_id, d.level, d.outstanding_at_generation, d.fee_amount, d.interest_amount, d.pdf_path,
            i.number AS invoice_number,
            -- Stufe 3 T11: Empfänger der Rechnung (Kopie), ältere Rechnungen wie bisher
            COALESCE(i.empfaenger->>'email', c.email) AS customer_email,
            COALESCE(i.empfaenger->>'name', c.name) AS customer_name
       FROM billing_invoice_dunnings d
       JOIN billing_invoices i ON i.id = d.invoice_id
       JOIN billing_customers c ON c.id = i.customer_id
      WHERE d.brand=$1 AND d.sent_at IS NULL AND i.status NOT IN ('cancelled','paid')
      ORDER BY d.generated_at ASC`,
    [brand]
  );
  return r.rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    invoiceId: row.invoice_id as string,
    invoiceNumber: row.invoice_number as string,
    level: Number(row.level),
    customerEmail: row.customer_email as string,
    customerName: row.customer_name as string,
    outstanding: Number(row.outstanding_at_generation),
    feeAmount: Number(row.fee_amount),
    interestAmount: Number(row.interest_amount),
    pdfPath: row.pdf_path as string,
  }));
}

// K164/K165 (Handtest 01.11.2026): Versand nur noch über die Prüfseite – siehe mahnung-versand.ts
// (sendeMahnungPerMail, vermerkeMahnungPerPost, mahnschreibenPdf). Die alte Mail mit reiner Text-Tabelle entfällt.
