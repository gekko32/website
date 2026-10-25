// Rechnungswesen Stufe 3, T1b: Absenderdaten der Rechnung aus EINER Quelle –
// den Einstellungen unter /admin/einstellungen/rechnungen (Spezifikation K36, K36a).
// Server-Variablen SELLER_* sind nur noch Rückfall, falls ein Feld leer ist.
// USt-IdNr. (öffentlich, Impressum + Rechnung) und Steuernummer (nur Rechnung)
// sind getrennt; eine Steuernummer erscheint nie als USt-IdNr.
import { getSiteSetting } from './website-db';

export const ABSENDER_KEYS = [
  'invoice_sender_name', 'invoice_sender_street', 'invoice_sender_city', 'invoice_sender_phone',
  'invoice_bank_iban', 'invoice_bank_bic', 'invoice_bank_name', 'invoice_vat_id', 'invoice_tax_number',
  // Beleg-Design (K111): Inhaber – Fußzeile und Ansprechpartner.
  'invoice_manager',
] as const;

export type AbsenderEinstellungen = Partial<Record<(typeof ABSENDER_KEYS)[number], string | null>>;

export interface Absender {
  name: string; address: string; postalCode: string; city: string; country: string;
  vatId: string; taxNumber: string;
  iban: string; bic: string; bankName: string; email: string; phone: string; website: string;
  /** Beleg-Design (K111): „Inhaber: …“ in der Fußzeile, Ansprechpartner im Infoblock. */
  inhaber: string;
}

export function normalisiereUstId(roh: string | null | undefined): string {
  return (roh ?? '').replace(/\s+/g, '').toUpperCase();
}

/** Deutsche USt-IdNr.: DE + 9 Ziffern. */
export function ustIdGueltig(roh: string | null | undefined): boolean {
  return /^DE\d{9}$/.test(normalisiereUstId(roh));
}

type Env = Record<string, string | undefined>;

export function absenderAus(s: AbsenderEinstellungen, env: Env = process.env): Absender {
  const feld = (k: (typeof ABSENDER_KEYS)[number]) => (s[k] ?? '').trim();

  // „PLZ Ort“ steht in einem Feld; ohne erkennbare PLZ bleibt alles Ort.
  const ortFeld = feld('invoice_sender_city');
  const m = ortFeld.match(/^(\d{4,5})\s+(.+)$/);
  const postalCode = ortFeld ? (m ? m[1] : '') : (env.SELLER_POSTAL_CODE ?? '');
  const city = ortFeld ? (m ? m[2] : ortFeld) : (env.SELLER_CITY ?? '');

  const ustRoh = feld('invoice_vat_id');
  const vatId = ustIdGueltig(ustRoh) ? normalisiereUstId(ustRoh)
    : ustIdGueltig(env.SELLER_VAT_ID) ? normalisiereUstId(env.SELLER_VAT_ID) : '';
  // Steht im USt-IdNr.-Feld etwas anderes (alte Daten: Steuernummer), gilt es als Steuernummer.
  const taxNumber = feld('invoice_tax_number')
    || (ustRoh && !ustIdGueltig(ustRoh) ? ustRoh : '')
    || (env.SELLER_TAX_NUMBER ?? '');

  return {
    name: feld('invoice_sender_name') || env.SELLER_NAME || env.BRAND_NAME || '',
    address: feld('invoice_sender_street') || env.SELLER_ADDRESS || '',
    postalCode,
    city,
    country: env.SELLER_COUNTRY || 'DE',
    vatId,
    taxNumber,
    iban: feld('invoice_bank_iban') || env.SELLER_IBAN || '',
    bic: feld('invoice_bank_bic') || env.SELLER_BIC || '',
    bankName: feld('invoice_bank_name'),
    email: env.SELLER_EMAIL || env.CONTACT_EMAIL || '',
    phone: feld('invoice_sender_phone') || env.SELLER_PHONE || '',
    website: env.LEGAL_WEBSITE || env.PROD_DOMAIN || '',
    inhaber: feld('invoice_manager'),
  };
}

export async function ladeAbsender(brand: string): Promise<Absender> {
  const werte = await Promise.all(ABSENDER_KEYS.map((k) => getSiteSetting(brand, k)));
  const s: AbsenderEinstellungen = {};
  ABSENDER_KEYS.forEach((k, i) => { s[k] = werte[i]; });
  return absenderAus(s);
}

/** Pflichtangabe nach § 14 Abs. 4 Nr. 2 UStG: USt-IdNr. oder Steuernummer. */
export function steuerangabeFuerRechnung(a: Pick<Absender, 'vatId' | 'taxNumber'>): { label: string; wert: string } | null {
  if (a.vatId) return { label: 'USt-IdNr.', wert: a.vatId };
  if (a.taxNumber) return { label: 'Steuernummer', wert: a.taxNumber };
  return null;
}

/** Prüfung beim Speichern: Ins USt-IdNr.-Feld darf nur eine gültige USt-IdNr. */
export function pruefeSteuerangaben(ustId: string, _steuernummer: string): { key: string; meldung: string }[] {
  if (ustId.trim() === '' || ustIdGueltig(ustId)) return [];
  return [{
    key: 'invoice_vat_id',
    meldung: 'Das ist keine USt-IdNr. (DE + 9 Ziffern). Eine Steuernummer gehört in das Feld „Steuernummer“, sie erscheint nur auf Rechnungen.',
  }];
}
