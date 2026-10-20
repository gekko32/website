// Rechnungstexte, die Gerald unter Einstellungen → Rechnungstexte pflegt (Wunsch 20.10.2026).
// Dieselben Schlüssel nutzt der Content Hub (Reiter Rechnungen) – es gibt nur eine Quelle.
import { getSiteSetting, setSiteSetting } from './website-db';

export type RechnungstextKey =
  | 'invoice_intro_text' | 'invoice_kleinunternehmer_notice' | 'invoice_outro_text'
  | 'invoice_email_subject' | 'invoice_email_body';

export const RECHNUNGSTEXT_STANDARD: Record<RechnungstextKey, string> = {
  invoice_intro_text: 'für folgende Leistungen stelle ich Ihnen in Rechnung:',
  invoice_kleinunternehmer_notice: 'Kein Ausweis der Umsatzsteuer aufgrund der Anwendung der Kleinunternehmerregelung gemäß § 19 UStG.',
  invoice_outro_text: 'Vielen Dank für Ihr Vertrauen!',
  invoice_email_subject: 'Rechnung {{number}}',
  invoice_email_body: 'Sehr geehrte/r {{customer_name}},\n\nanbei erhalten Sie Rechnung {{number}} über {{gross_amount}} €.\n\nBitte überweisen Sie den Betrag bis {{due_date}} unter Angabe des Verwendungszwecks „{{payment_reference}}“.\n\nMit freundlichen Grüßen\n{{seller_name}}',
};

export interface RechnungstextFeld {
  key: RechnungstextKey; label: string; wirktIn: string; mehrzeilig: boolean; max: number; pflicht: boolean;
}

export const RECHNUNGSTEXT_FELDER: readonly RechnungstextFeld[] = [
  { key: 'invoice_intro_text', label: 'Einleitung (vor den Positionen)', mehrzeilig: false, max: 500, pflicht: false,
    wirktIn: 'Steht auf jeder neuen Rechnung über der Positionsliste (PDF und Versand).' },
  { key: 'invoice_kleinunternehmer_notice', label: 'Kleinunternehmer-Hinweis (§ 19 UStG)', mehrzeilig: false, max: 500, pflicht: true,
    wirktIn: 'Pflichtangabe auf jeder Rechnung ohne Umsatzsteuer: PDF, Versand und Druckansicht.' },
  { key: 'invoice_outro_text', label: 'Schlusstext', mehrzeilig: false, max: 500, pflicht: false,
    wirktIn: 'Steht auf jeder neuen Rechnung unter den Positionen (PDF und Versand).' },
  { key: 'invoice_email_subject', label: 'Betreff der Rechnungs-E-Mail', mehrzeilig: false, max: 200, pflicht: false,
    wirktIn: 'Betreff der E-Mail, mit der eine Rechnung verschickt wird. {{number}} = Rechnungsnummer.' },
  { key: 'invoice_email_body', label: 'Text der Rechnungs-E-Mail', mehrzeilig: true, max: 4000, pflicht: false,
    wirktIn: 'Text der E-Mail beim Rechnungsversand. Platzhalter: {{customer_name}}, {{number}}, {{gross_amount}}, {{due_date}}, {{payment_reference}}, {{seller_name}}.' },
];

export function pruefeRechnungstexte(form: Partial<Record<RechnungstextKey, string>>): {
  werte: Record<RechnungstextKey, string> | null; fehler: { key: string; meldung: string }[];
} {
  const fehler: { key: string; meldung: string }[] = [];
  const werte = {} as Record<RechnungstextKey, string>;
  for (const f of RECHNUNGSTEXT_FELDER) {
    const wert = (form[f.key] ?? '').trim();
    if (f.pflicht && wert === '') fehler.push({ key: f.key, meldung: 'Dieser Text ist Pflicht und darf nicht leer sein.' });
    else if (wert.length > f.max) fehler.push({ key: f.key, meldung: `Höchstens ${f.max} Zeichen.` });
    werte[f.key] = wert;
  }
  return fehler.length > 0 ? { werte: null, fehler } : { werte, fehler };
}

export async function ladeRechnungstexte(brand: string): Promise<Record<RechnungstextKey, string>> {
  const roh = await Promise.all(RECHNUNGSTEXT_FELDER.map((f) => getSiteSetting(brand, f.key)));
  const werte = {} as Record<RechnungstextKey, string>;
  RECHNUNGSTEXT_FELDER.forEach((f, i) => { werte[f.key] = roh[i] ?? RECHNUNGSTEXT_STANDARD[f.key]; });
  return werte;
}

export async function speichereRechnungstexte(brand: string, werte: Record<RechnungstextKey, string>): Promise<void> {
  await Promise.all(RECHNUNGSTEXT_FELDER.map((f) => setSiteSetting(brand, f.key, werte[f.key])));
}
