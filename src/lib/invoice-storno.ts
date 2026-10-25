import { pool, initBillingTables, getNextInvoiceNumber } from './website-db';
import { getCustomerById, type Invoice } from './native-billing';
import { addBooking } from './eur-bookkeeping';
import { generateInvoicePdf, type InvoicePdfSeller } from './invoice-pdf';
import { archiveBillingPdf } from './billing-archive';
import { ladeAbsender } from './billing-absender';
import { logBillingEvent, type BillingActor } from './billing-audit';
import { gibPostenFrei, initPostenTabelle } from './billing-posten';
import { alsKunde, leseEmpfaenger, kundennummerDerRechnung } from './billing-empfaenger';

function iso(d: Date): string {
  return d.toISOString().split('T')[0];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function createCreditNote(invoiceId: string, reason: string, actor?: BillingActor): Promise<Invoice | null> {
  await initBillingTables();
  await initPostenTabelle();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const invR = await client.query(`SELECT * FROM billing_invoices WHERE id=$1 FOR UPDATE`, [invoiceId]);
    const orig = invR.rows[0];
    if (!orig) { await client.query('ROLLBACK'); return null; }
    if (orig.status === 'draft' || orig.status === 'cancelled') throw new Error('invoice cannot be cancelled');
    if (orig.kind === 'gutschrift') throw new Error('credit note cannot be cancelled again');
    // T000375 (View-Migration): paid_amount ist keine Spalte von billing_invoices
    // mehr, sondern ergibt sich aus der Summe der billing_invoice_payments.
    const paidR = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid_amount
         FROM billing_invoice_payments
        WHERE invoice_id = $1`,
      [invoiceId]
    );
    const origPaid = Number(paidR.rows[0].paid_amount);

    const number = await getNextInvoiceNumber(orig.brand, 'gutschrift');
    const issueDate = iso(new Date());
    const dueDate = issueDate;
    const ins = await client.query(
      `INSERT INTO billing_invoices
         (brand, number, status, customer_id, issue_date, due_date, tax_mode,
          net_amount, tax_rate, tax_amount, gross_amount, notes, payment_reference,
          locked, cancels_invoice_id, kind, parent_invoice_id,
          currency, currency_rate, net_amount_eur, gross_amount_eur, supply_type, empfaenger, klient_id)
       VALUES
         ($1,$2,'open',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,$13,'gutschrift',$14,$15,$16,$17,$18,$19,$20::jsonb,$21::uuid)
       RETURNING *`,
      [
        orig.brand,
        number,
        orig.customer_id,
        issueDate,
        dueDate,
        orig.tax_mode,
        -Number(orig.net_amount),
        Number(orig.tax_rate),
        -Number(orig.tax_amount),
        -Number(orig.gross_amount),
        `Storno für ${orig.number}: ${reason}`,
        `GS-${number}`,
        orig.id,
        orig.parent_invoice_id ?? null,
        orig.currency ?? 'EUR',
        orig.currency_rate ?? null,
        orig.net_amount_eur != null ? -Number(orig.net_amount_eur) : -Number(orig.net_amount),
        orig.gross_amount_eur != null ? -Number(orig.gross_amount_eur) : -Number(orig.gross_amount),
        orig.supply_type ?? null,
        // Stufe 3 T11: die Gutschrift geht an denselben Empfänger wie die Rechnung.
        orig.empfaenger ? JSON.stringify(orig.empfaenger) : null,
        // Prüfung L3 Runde 2 (N1): die Gutschrift steht in derselben Akte wie die Rechnung.
        orig.klient_id ?? null,
      ]
    );
    const credit = ins.rows[0];

    const linesR = await client.query(
      `SELECT description, quantity, unit, unit_price, net_amount, leistung_von, leistung_bis
         FROM billing_invoice_line_items WHERE invoice_id=$1 ORDER BY id`,
      [orig.id]
    );
    for (const line of linesR.rows) {
      await client.query(
        `INSERT INTO billing_invoice_line_items
           (invoice_id, description, quantity, unit, unit_price, net_amount, leistung_von, leistung_bis)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [credit.id, line.description, -Number(line.quantity), line.unit ?? null, Number(line.unit_price), -Number(line.net_amount),
         line.leistung_von ?? null, line.leistung_bis ?? null]
      );
    }

    // Erst nach den Positionen sperren: Der GoBD-Schutz lässt keine Positionen an einer
    // gesperrten Rechnung zu (Prüfung T10a gegen echtes Postgres: Storno brach hier ab).
    await client.query(`UPDATE billing_invoices SET locked=true WHERE id=$1`, [credit.id]);
    await client.query(`UPDATE billing_invoices SET status='cancelled', updated_at=now() WHERE id=$1`, [orig.id]);
    // Stufe 3 T10a: Die Posten der stornierten Rechnung sind wieder offen (K25).
    await gibPostenFrei(client, orig.id, 'abgerechnet');
    await client.query('COMMIT');

    if (origPaid > 0 && Number(orig.gross_amount) !== 0) {
      await addBooking({
        brand: orig.brand,
        bookingDate: issueDate,
        type: 'income',
        category: 'storno',
        description: `Storno ${orig.number}`,
        netAmount: -round2(origPaid * Number(orig.net_amount) / Number(orig.gross_amount)),
        vatAmount: -round2(origPaid * Number(orig.tax_amount) / Number(orig.gross_amount)),
        invoiceId: credit.id,
        belegnummer: number,
        taxMode: orig.tax_mode,
      });
    }

    await logBillingEvent({
      invoiceId: orig.id,
      action: 'storno',
      actor,
      fromStatus: orig.status,
      toStatus: 'cancelled',
      reason,
      metadata: { creditNoteNumber: number, creditNoteId: credit.id },
    });

    return {
      id: credit.id,
      brand: credit.brand,
      number: credit.number,
      status: credit.status,
      customerId: credit.customer_id,
      issueDate: iso(credit.issue_date),
      dueDate: iso(credit.due_date),
      taxMode: credit.tax_mode,
      netAmount: Number(credit.net_amount),
      taxRate: Number(credit.tax_rate),
      taxAmount: Number(credit.tax_amount),
      grossAmount: Number(credit.gross_amount),
      notes: credit.notes ?? undefined,
      paymentReference: credit.payment_reference ?? undefined,
      paidAmount: Number(credit.paid_amount ?? 0) || undefined,
      locked: Boolean(credit.locked),
      cancelledInvoiceId: credit.cancels_invoice_id ?? undefined,
      kind: credit.kind ?? 'gutschrift',
      parentInvoiceId: credit.parent_invoice_id ?? undefined,
      currency: credit.currency ?? 'EUR',
      currencyRate: credit.currency_rate != null ? Number(credit.currency_rate) : null,
      netAmountEur: credit.net_amount_eur != null ? Number(credit.net_amount_eur) : Number(credit.net_amount),
      grossAmountEur: credit.gross_amount_eur != null ? Number(credit.gross_amount_eur) : Number(credit.gross_amount),
      supplyType: credit.supply_type ?? undefined,
    };
  } catch (e) {
    // Stufe 3 T10a: bei Fehler nichts halb speichern (vorher blieb die Transaktion offen).
    try { await client.query('ROLLBACK'); } catch { /* Verbindung ohnehin unbrauchbar */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function generateCreditNotePdf(invoiceId: string): Promise<Buffer | null> {
  // T000375: paid_amount/paid_at sind nur noch ueber die View verfuegbar.
  const invR = await pool.query(`SELECT * FROM v_billing_invoices_with_state WHERE id=$1`, [invoiceId]);
  const inv = invR.rows[0];
  if (!inv) return null;
  const rechnungskunde = await getCustomerById(inv.brand, inv.customer_id);
  if (!rechnungskunde) return null;
  // Stufe 3 T11: Empfänger der Gutschrift aus ihrer Kopie (View enthält die Spalte nicht).
  const kopie = leseEmpfaenger((await pool.query('SELECT empfaenger FROM billing_invoices WHERE id=$1', [invoiceId])).rows[0]?.empfaenger);
  const customer = kopie ? alsKunde(rechnungskunde, kopie) : rechnungskunde;
  const linesR = await pool.query(`SELECT * FROM billing_invoice_line_items WHERE invoice_id=$1 ORDER BY id`, [invoiceId]);
  // Prüfung Runde 1 (K36, K36a): Absender aus derselben Quelle wie alle Rechnungen.
  const absender = await ladeAbsender(inv.brand);

  const seller: InvoicePdfSeller = { ...absender, name: absender.name || inv.brand };
  const pdf = await generateInvoicePdf({
    invoice: {
      id: inv.id, brand: inv.brand, number: inv.number, status: inv.status,
      customerId: inv.customer_id, issueDate: iso(inv.issue_date), dueDate: iso(inv.due_date),
      taxMode: inv.tax_mode, netAmount: Number(inv.net_amount), taxRate: Number(inv.tax_rate),
      taxAmount: Number(inv.tax_amount), grossAmount: Number(inv.gross_amount),
      notes: inv.notes ?? undefined, paymentReference: inv.payment_reference ?? undefined,
      paidAmount: Number(inv.paid_amount ?? 0) || undefined, locked: Boolean(inv.locked),
      kind: inv.kind ?? 'gutschrift', currency: inv.currency ?? 'EUR',
      currencyRate: inv.currency_rate != null ? Number(inv.currency_rate) : null,
      netAmountEur: inv.net_amount_eur != null ? Number(inv.net_amount_eur) : Number(inv.net_amount),
      grossAmountEur: inv.gross_amount_eur != null ? Number(inv.gross_amount_eur) : Number(inv.gross_amount),
      // Prüfung B10: Reverse-Charge-/Export-Hinweis auch auf der Gutschrift.
      supplyType: inv.supply_type ?? undefined,
    },
    lines: linesR.rows.map((l: Record<string, unknown>) => ({
      description: l.description as string,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unit_price),
      netAmount: Number(l.net_amount),
      unit: (l.unit as string) ?? undefined,
    })),
    customer: {
      name: customer.name,
      company: customer.company,
      addressLine1: customer.addressLine1,
      postalCode: customer.postalCode,
      city: customer.city,
      country: customer.landIso ?? 'DE',
      vatNumber: customer.vatNumber,
      email: customer.email,
      customerNumber: await kundennummerDerRechnung(invoiceId),
    },
    seller,
    templateTexts: { title: 'GUTSCHRIFT' },
  });
  const pdfPath = await archiveBillingPdf({
    brand: inv.brand,
    invoiceNumber: inv.number,
    filename: `${inv.number}.pdf`,
    content: pdf,
  });
  await pool.query(
    `UPDATE billing_invoices SET pdf_mime='application/pdf', pdf_size_bytes=$2, pdf_path=COALESCE($3, pdf_path) WHERE id=$1`,
    [invoiceId, pdf.length, pdfPath]
  );
  await pool.query(
    `INSERT INTO billing_invoice_documents (invoice_id, format, content)
     VALUES ($1, 'pdf', $2)
     ON CONFLICT (invoice_id, format) DO UPDATE SET content = EXCLUDED.content`,
    [invoiceId, pdf]
  );
  return pdf;
}
