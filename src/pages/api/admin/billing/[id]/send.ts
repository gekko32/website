import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../../lib/auth';
import { finalizeInvoice, getCustomerById } from '../../../../../lib/native-billing';
import { generateInvoicePdf, type InvoicePdfSeller } from '../../../../../lib/invoice-pdf';
import { generateFacturX } from '../../../../../lib/einvoice/factur-x';
import { pool, getSiteSetting, initBillingTables } from '../../../../../lib/website-db';
import { ladeAbsender } from '../../../../../lib/billing-absender';
import { pruefeZahlungsziel } from '../../../../../lib/billing-regeln';
import { hatEchteEmail, pruefeVersandweg } from '../../../../../lib/billing-versand';
import { logBillingEvent } from '../../../../../lib/billing-audit';
import { aktuellerEmpfaenger, AnschriftFehlt, alsKunde, fehlendeAngaben, kaeuferName, kundennummerVon } from '../../../../../lib/billing-empfaenger';


export const POST: APIRoute = async ({ request, params , locals }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session || !isAdmin(session)) return new Response('Unauthorized', { status: 401 });
  await initBillingTables();
  const id = params.id as string;
  const brand = process.env.BRAND || 'mentolder';

  // Load invoice (must be draft)
  // N2: Zahlungsziel im Einzelfall aus der Prüfansicht; ohne Angabe gilt die Einstellung.
  const anfrage = await request.json().catch(() => ({})) as { zahlungszielTage?: unknown; versand?: unknown };
  let zahlungszielTage: number | undefined;
  if (anfrage.zahlungszielTage !== undefined && anfrage.zahlungszielTage !== null && anfrage.zahlungszielTage !== '') {
    const z = pruefeZahlungsziel(String(anfrage.zahlungszielTage));
    if (z.wert === null) return new Response(z.fehler ?? 'Zahlungsziel ungültig', { status: 400 });
    zahlungszielTage = z.wert;
  }

  const draftCheck = await pool.query(
    `SELECT * FROM billing_invoices WHERE id=$1 AND brand=$2 AND status='draft'`, [id, brand]
  );
  if (!draftCheck.rows[0]) return new Response('Not found or not draft', { status: 404 });

  // Absender aus einer Quelle (Stufe 3 T1b, billing-absender).
  const [absender, rechnungskunde, empfaenger] = await Promise.all([
    ladeAbsender(brand),
    getCustomerById(brand, draftCheck.rows[0].customer_id),
    aktuellerEmpfaenger(brand, draftCheck.rows[0].customer_id, { klientId: draftCheck.rows[0].klient_id ?? null }),
  ]);
  if (!rechnungskunde || !empfaenger) return new Response('Customer not found', { status: 404 });
  // Stufe 3 T11: heutiger Stand aus der Akte (K32), wird beim Festschreiben kopiert (K31).
  // Ohne vollständige Anschrift kein Festschreiben (Grenzfall), mit Hinweis, was fehlt.
  const fehlt = fehlendeAngaben(empfaenger);
  if (fehlt.length > 0) return new Response(new AnschriftFehlt(fehlt).message, { status: 422 });
  const customer = alsKunde(rechnungskunde, empfaenger);
  // Stufe 4 T14 (K58, K59): per E-Mail oder ohne E-Mail (Post/persönlich); ohne E-Mail-Adresse nur Post.
  const versand = pruefeVersandweg(anfrage.versand, empfaenger.email);
  if (versand.fehler) return new Response(versand.fehler, { status: 422 });

  if (!absender.city) {
    locals.requestLogger.warn({ brand }, '[billing/send] invoice_sender_city not configured');
  }
  const seller: InvoicePdfSeller = { ...absender };

  // Load email/pdf templates from site_settings
  const tmplKeys = ['invoice_email_subject','invoice_email_body','invoice_intro_text',
                    'invoice_kleinunternehmer_notice','invoice_outro_text'] as const;
  const tmplVals = await Promise.all(tmplKeys.map(k => getSiteSetting(brand, k)));
  const tmpl = Object.fromEntries(tmplKeys.map((k,i) => [k, tmplVals[i] ?? '']));

  // Load line items
  const linesR = await pool.query(
    `SELECT *, leistung_von::text AS leistung_von_text, leistung_bis::text AS leistung_bis_text
       FROM billing_invoice_line_items WHERE invoice_id=$1 ORDER BY id`, [id]
  );
  const lines = linesR.rows.map((l: Record<string, unknown>) => ({
    description: l.description as string,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unit_price),
    netAmount: Number(l.net_amount),
    unit: l.unit as string | undefined,
    // Stufe 3 T10a: Leistungsdatum je Position (PDF und E-Rechnung).
    leistungVon: (l.leistung_von_text as string | null) ?? undefined,
    leistungBis: (l.leistung_bis_text as string | null) ?? undefined,
  }));

  // Stufe 3 T12: PDF und E-Rechnung entstehen erst beim Festschreiben, wenn Nummer und
  // Rechnungsdatum feststehen (K34). Scheitert das, wird keine Nummer verbraucht (K35).
  const draftRow = draftCheck.rows[0];
  let xml = '';
  let pdf: Buffer | null = null;
  const erzeugeDokumente = async (kopf: { number: string; issueDate: string; dueDate: string; paymentReference: string | null }) => {
    const tempInvoice = {
      id: draftRow.id, brand: draftRow.brand, number: kopf.number,
      status: 'open', customerId: draftRow.customer_id,
      issueDate: kopf.issueDate,
      dueDate: kopf.dueDate,
      taxMode: draftRow.tax_mode, netAmount: Number(draftRow.net_amount),
      taxRate: Number(draftRow.tax_rate), taxAmount: Number(draftRow.tax_amount),
      grossAmount: Number(draftRow.gross_amount),
      notes: draftRow.notes ?? undefined,
      paymentReference: kopf.paymentReference ?? undefined,
      locked: true,
      servicePeriodStart: draftRow.service_period_start
        ? (draftRow.service_period_start as Date).toISOString().split('T')[0] : undefined,
      servicePeriodEnd: draftRow.service_period_end
        ? (draftRow.service_period_end as Date).toISOString().split('T')[0] : undefined,
      leitwegId: draftRow.leitweg_id ?? undefined,
      currency: (draftRow.currency as string) ?? 'EUR',
      currencyRate: draftRow.currency_rate != null ? Number(draftRow.currency_rate) : null,
      netAmountEur: draftRow.net_amount_eur != null ? Number(draftRow.net_amount_eur) : Number(draftRow.net_amount),
      grossAmountEur: draftRow.gross_amount_eur != null ? Number(draftRow.gross_amount_eur) : Number(draftRow.gross_amount),
      supplyType: (draftRow.supply_type as string) ?? undefined,
      kind: ((draftRow.kind as string) ?? 'regular') as 'regular' | 'prepayment' | 'final' | 'gutschrift',
      parentInvoiceId: (draftRow.parent_invoice_id as string) ?? undefined,
    };

    const invoiceInput = {
      number: tempInvoice.number,
      issueDate: tempInvoice.issueDate,
      dueDate: tempInvoice.dueDate,
      currency: 'EUR',
      taxMode: tempInvoice.taxMode as 'kleinunternehmer' | 'regelbesteuerung',
      servicePeriodStart: tempInvoice.servicePeriodStart,
      servicePeriodEnd: tempInvoice.servicePeriodEnd,
      paymentReference: tempInvoice.paymentReference,
      notes: tempInvoice.notes,
      lines: lines.map(l => ({
        description: l.description,
        quantity: l.quantity,
        unit: l.unit || 'C62',
        unitPrice: l.unitPrice,
        netAmount: l.netAmount,
        taxRate: tempInvoice.taxMode === 'kleinunternehmer' ? 0 : tempInvoice.taxRate,
        taxCategory: (tempInvoice.taxMode === 'kleinunternehmer' ? 'E' : 'S') as 'E' | 'S',
        periodStart: l.leistungVon,
        periodEnd: l.leistungBis,
      })),
      netTotal: tempInvoice.netAmount,
      taxTotal: tempInvoice.taxAmount,
      grossTotal: tempInvoice.grossAmount,
      seller: {
        name: seller.name,
        address: seller.address,
        postalCode: seller.postalCode,
        city: seller.city,
        country: seller.country,
        vatId: seller.vatId || undefined,
        taxNumber: seller.taxNumber || undefined,
        contactEmail: seller.email || 'noreply@mentolder.de',
        iban: seller.iban,
        bic: seller.bic || undefined,
      },
      buyer: {
        name: kaeuferName(empfaenger) || 'Unbekannt',
        email: hatEchteEmail(customer.email) ? customer.email : undefined,
        address: customer.addressLine1 || undefined,
        postalCode: customer.postalCode || undefined,
        city: customer.city || undefined,
        country: customer.landIso || 'DE',
        vatId: customer.vatNumber || undefined,
        leitwegId: draftRow.leitweg_id || customer.defaultLeitwegId || undefined,
      },
    };

    xml = generateFacturX(invoiceInput);
    const pdfCustomer = {
      name: customer.name,
      email: customer.email,
      company: customer.company,
      addressLine1: customer.addressLine1,
      city: customer.city,
      postalCode: customer.postalCode,
      country: customer.landIso ?? 'DE',
      vatNumber: customer.vatNumber,
      // Beleg-Design (K109): Kundennummer aus der Klientenakte.
      customerNumber: await kundennummerVon(draftCheck.rows[0].klient_id),
    };
    pdf = await generateInvoicePdf({
      invoice: tempInvoice, lines, customer: pdfCustomer, seller,
      templateTexts: {
        introText: tmpl.invoice_intro_text || undefined,
        kleinunternehmerNotice: tmpl.invoice_kleinunternehmer_notice || undefined,
        outroText: tmpl.invoice_outro_text || undefined,
      },
    });
    return { pdfBlob: pdf, invoiceInput };
  };

  // Finalize: Nummer vergeben, Dokumente erzeugen, Prüfsumme, PDF und Protokoll in einem Zug.
  const finalized = await finalizeInvoice(id, {
    actor: { userId: session.sub, email: session.email },
    pdfMime: 'application/pdf',
    dokumente: erzeugeDokumente,
    empfaenger,
    zahlungszielTage,
  }).catch((err: unknown) => {
    if (err instanceof AnschriftFehlt) return err;
    locals.requestLogger.error({ err }, '[billing/send] Festschreiben/PDF fehlgeschlagen');
    return new Error(err instanceof Error ? err.message : String(err));
  });
  if (finalized instanceof AnschriftFehlt) return new Response(finalized.message, { status: 422 });
  if (finalized instanceof Error) return new Response(`Festschreiben fehlgeschlagen, nichts verschickt, keine Nummer vergeben: ${finalized.message}`, { status: 500 });
  if (!finalized) return new Response('Failed to finalize invoice', { status: 409 });

  await pool.query(
    `INSERT INTO billing_invoice_documents (invoice_id, format, content)
     VALUES ($1, 'zugferd', $2::bytea)
     ON CONFLICT (invoice_id, format) DO UPDATE SET content = EXCLUDED.content`,
    [id, Buffer.from(xml, 'utf8')]
  );

  // Stufe 4 T14: ohne E-Mail – festgeschrieben ist sie; vermerken, PDF zum Drucken öffnen (K58).
  if (versand.weg === 'post') {
    await vermerkeVersand(id, 'post', session.email);
    return new Response(JSON.stringify({ ok: true, number: finalized.number, versand: 'post', pdfUrl: `/api/billing/invoice/${id}/pdf` }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Handtest 23.10.2026: Festschreiben und E-Mail sind getrennt. Die E-Mail (Empfänger, Betreff, Text
  // anpassbar) geht über /api/admin/billing/[id]/mail – auch später und erneut. Scheitert sie, bleibt
  // die Rechnung festgeschrieben.
  return new Response(JSON.stringify({ ok: true, number: finalized.number, versand: 'email', mail: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/** Versandweg und -zeitpunkt an der Rechnung (nicht Teil der Prüfsumme) und im Protokoll. */
async function vermerkeVersand(id: string, weg: 'email' | 'post', wer: string | undefined): Promise<void> {
  await pool.query('UPDATE billing_invoices SET versandweg=$2, versendet_am=now() WHERE id=$1', [id, weg]);
  await logBillingEvent({ invoiceId: id, action: 'versand', actor: { email: wer }, metadata: { weg } }).catch(() => {});
}
