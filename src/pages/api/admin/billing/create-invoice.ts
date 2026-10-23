import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../lib/auth';
import { createInvoice, type InvoiceLine } from '../../../../lib/native-billing';
import { createCustomer } from '../../../../lib/native-billing';
import { isE2ETestRequest } from '../../../../lib/e2e-marker';
import { ladeZahlungsziel } from '../../../../lib/billing-regeln';
import { getKlient, rechnungsempfaenger, verknuepfeRechnungskunde } from '../../../../lib/klientenakte';
import { pool } from '../../../../lib/website-db';

export const POST: APIRoute = async ({ request , locals }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session || !isAdmin(session)) return new Response('Unauthorized', { status: 401 });

  try {
    // T015362: Testkontext erkennen und auf Kunde + Rechnung markieren
    // (fail-closed, siehe e2e-marker), damit der Purge-Pfad sie entfernen kann.
    const isTestData = isE2ETestRequest(request);
    const body = await request.json();
    const {
      klientId, lines, notes, servicePeriodStart, servicePeriodEnd, leitwegId,
      currency, supplyType, kind, parentInvoiceId,
      dueDays: dueDaysAnfrage, taxRate = 19
    } = body;

    // Stufe 4, B7 (K66): Rechnungen nur mit Klientenakte; Empfänger kommt aus der Akte.
    const klient = typeof klientId === 'string' && klientId ? await getKlient(klientId) : null;
    if (!klient) return new Response(JSON.stringify({ error: 'Rechnungen gibt es nur noch aus der Klientenakte (klientId fehlt). Fakturierung → Neue Rechnung → Klient wählen.' }), { status: 400 });
    if (!lines || !Array.isArray(lines)) {
      return new Response(JSON.stringify({ error: 'lines array required' }), { status: 400 });
    }

    const brand = process.env.BRAND || 'mentolder';
    // Prüfung Runde 1 (K38): ohne Angabe gilt das Zahlungsziel aus den Einstellungen.
    const dueDays = typeof dueDaysAnfrage === 'number' ? dueDaysAnfrage : await ladeZahlungsziel(brand);

    const e = rechnungsempfaenger(klient);
    const customer = await createCustomer({
      brand, name: e.name, email: e.email, company: e.company ?? undefined, addressLine1: e.addressLine1 ?? undefined,
      city: e.city ?? undefined, postalCode: e.postalCode ?? undefined, vatNumber: e.vatNumber ?? undefined, isTestData,
    });
    await verknuepfeRechnungskunde(customer.id, klient.id);

    const invoice = await createInvoice({
      brand,
      customerId: customer.id,
      issueDate: new Date().toISOString().split('T')[0],
      dueDays,
      // N2: ein ausdrücklich gewünschtes Zahlungsziel bleibt auch beim Festschreiben erhalten.
      zahlungszielTage: typeof dueDaysAnfrage === 'number' ? dueDays : undefined,
      // taxMode bewusst nicht aus der Anfrage: zentrale Einstellung (Befund R3).
      taxRate,
      lines: lines as InvoiceLine[],
      notes,
      servicePeriodStart,
      servicePeriodEnd,
      leitwegId,
      currency,
      supplyType,
      kind,
      parentInvoiceId,
      isTestData
    });

    await pool.query('UPDATE billing_invoices SET klient_id = $2 WHERE id = $1', [invoice.id, klient.id]);
    return new Response(JSON.stringify({ success: true, data: invoice }), { status: 200 });
  } catch (err: unknown) {
    locals.requestLogger.error({ err }, '[api/admin/billing/create-invoice]');
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};
