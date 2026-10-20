import type { APIRoute } from 'astro';
import {
  getOrCreateCustomer,
  createBillingInvoice,
  createBillingQuote,
} from '../../../lib/stripe-billing';
import { holeLeistung } from '../../../lib/billing-leistungen';
import { isE2ETestRequest } from '../../../lib/e2e-marker';
import { getSession, isAdmin } from '../../../lib/auth';
import { createCustomer } from '../../../lib/native-billing';
import { getKlient, rechnungsempfaenger, verknuepfeRechnungskunde } from '../../../lib/klientenakte';

export const POST: APIRoute = async ({ request , locals }) => {
  // Nur für Admins (Befund R5, Gerald 19.10.2026): vorher legte diese Schnittstelle
  // ohne Anmeldung Rechnungskunden und Rechnungsentwürfe an.
  const session = await getSession(request.headers.get('cookie'));
  if (!session || !isAdmin(session)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    // T015362: Testkontext erkennen und auf den erzeugten Zeilen markieren,
    // damit der Purge-Pfad sie entfernen kann (fail-closed, siehe e2e-marker).
    const isTestData = isE2ETestRequest(request);
    const body = await request.json();
    const {
      notes, leistungsdatum, klientId,
      serviceKey, quantity, asQuote, sendEmail: shouldSendEmail,
    } = body;
    let { name, email, company } = body;

    // Rechnung aus der Klientenakte (Stufe 2): Empfänger und Anschrift kommen aus
    // der Akte (Person oder Firma), der Rechnungskunde wird mit der Akte verknüpft.
    let klient: Awaited<ReturnType<typeof getKlient>> = null;
    if (typeof klientId === 'string' && klientId) {
      klient = await getKlient(klientId);
      if (!klient) {
        return new Response(JSON.stringify({ error: 'Klientenakte nicht gefunden.' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
      const e = rechnungsempfaenger(klient);
      name = e.name; email = e.email; company = e.company ?? undefined;
    }

    if (!name || !email || !serviceKey) {
      return new Response(
        JSON.stringify({ error: 'name, email, and serviceKey required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const leistung = await holeLeistung(process.env.BRAND || 'mentolder', serviceKey);
    if (!leistung || !leistung.aktiv) {
      return new Response(
        JSON.stringify({ error: `Unknown service: ${serviceKey}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const brand = process.env.BRAND || 'mentolder';
    let customer: { id: string } | null;
    if (klient) {
      const e = rechnungsempfaenger(klient);
      customer = await createCustomer({
        brand, name: e.name, email: e.email, company: e.company ?? undefined,
        addressLine1: e.addressLine1 ?? undefined, postalCode: e.postalCode ?? undefined,
        city: e.city ?? undefined, vatNumber: e.vatNumber ?? undefined, isTestData,
      });
      await verknuepfeRechnungskunde(customer.id, klient.id);
    } else {
      customer = await getOrCreateCustomer({ brand, name, email, company, isTestData });
    }

    if (!customer) {
      return new Response(
        JSON.stringify({ error: 'Stripe customer could not be created. Is STRIPE_SECRET_KEY configured?' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const key = serviceKey as string;

    if (asQuote) {
      const quote = await createBillingQuote({
        customerId: customer.id,
        serviceKey: key,
        quantity: quantity || 1,
      });
      return new Response(
        JSON.stringify({ success: true, type: 'quote', data: quote }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const invoice = await createBillingInvoice({
      customerId: customer.id,
      serviceKey: key,
      quantity: quantity || 1,
      sendEmail: shouldSendEmail !== false,
      notes: typeof notes === 'string' ? notes : undefined,
      leistungsdatum: typeof leistungsdatum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(leistungsdatum) ? leistungsdatum : undefined,
      isTestData,
    });

    return new Response(
      JSON.stringify({ success: true, type: 'invoice', data: invoice }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    locals.requestLogger.error({ err }, 'Billing error:');
    return new Response(
      JSON.stringify({ error: 'Interner Serverfehler.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
