// Rechnungswesen Stufe 4, T16: PDF und E-Mail eines Angebots – dasselbe Briefbild wie Rechnungen.
import { generateInvoicePdf } from './invoice-pdf';
import { ladeAbsender } from './billing-absender';
import { ladeRechnungstexte } from './billing-rechnungstexte';
import { rechnungsZeitraum, type RechnungsZeile } from './billing-entwurf';
import { kaeuferName, kundennummerVon, type Empfaenger } from './billing-empfaenger';
import { postenBetrag } from './billing-posten';
import type { Angebot } from './billing-angebot';

export async function erzeugeAngebotsPdf(
  brand: string, a: Angebot, positionen: RechnungsZeile[], empfaenger: Empfaenger,
): Promise<Buffer> {
  const [absender, texte] = await Promise.all([ladeAbsender(brand), ladeRechnungstexte(brand)]);
  const zeitraum = positionen.length > 0 ? rechnungsZeitraum(positionen) : null;
  const netto = positionen.reduce((s, z) => Math.round((s + postenBetrag({ menge: z.quantity, einzelpreis: z.unitPrice })) * 100) / 100, 0);
  return generateInvoicePdf({
    invoice: {
      id: a.id, brand, number: a.number, status: a.status, customerId: a.customerId,
      issueDate: a.datum, dueDate: a.gueltigBis, taxMode: a.taxMode, netAmount: netto, taxRate: 0, taxAmount: 0,
      grossAmount: netto, locked: a.status !== 'entwurf', kind: 'regular', currency: 'EUR', currencyRate: null,
      netAmountEur: netto, grossAmountEur: netto,
      servicePeriodStart: zeitraum?.start, servicePeriodEnd: zeitraum?.end,
    },
    lines: positionen.map((z) => ({
      description: z.description, quantity: z.quantity, unitPrice: z.unitPrice, unit: z.unit,
      netAmount: postenBetrag({ menge: z.quantity, einzelpreis: z.unitPrice }),
      leistungVon: z.leistungVon, leistungBis: z.leistungBis ?? undefined,
    })),
    customer: {
      name: empfaenger.name, company: empfaenger.company ?? undefined, email: empfaenger.email,
      addressLine1: empfaenger.addressLine1 ?? undefined, postalCode: empfaenger.postalCode ?? undefined,
      city: empfaenger.city ?? undefined, country: empfaenger.country, vatNumber: empfaenger.vatNumber ?? undefined,
      customerNumber: await kundennummerVon(a.klientId),
    },
    seller: { ...absender },
    templateTexts: {
      introText: (a.status === 'entwurf' ? texte.angebot_intro_text : a.einleitung) || undefined,
      kleinunternehmerNotice: a.taxMode === 'kleinunternehmer' ? texte.invoice_kleinunternehmer_notice || undefined : undefined,
      outroText: (a.status === 'entwurf' ? texte.angebot_outro_text : a.schluss) || undefined,
    },
    angebot: { gueltigBis: a.gueltigBis },
  });
}

const fd = (iso: string) => iso.split('-').reverse().join('.');

/** Betreff und Text der Angebots-E-Mail aus den Einstellungen (K70). */
export async function angebotsMail(brand: string, a: Angebot, empfaenger: Empfaenger): Promise<{ betreff: string; text: string }> {
  const [texte, absender] = await Promise.all([ladeRechnungstexte(brand), ladeAbsender(brand)]);
  const vars: Record<string, string> = {
    number: a.number, gross_amount: a.brutto.toFixed(2).replace('.', ',') + ' €', valid_until: fd(a.gueltigBis),
    customer_name: empfaenger.company ? empfaenger.name : kaeuferName(empfaenger), seller_name: absender.name,
  };
  const ersetze = (t: string) => t.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');
  return { betreff: ersetze(texte.angebot_email_subject || 'Angebot {{number}}'), text: ersetze(texte.angebot_email_body) };
}
