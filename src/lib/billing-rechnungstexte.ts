// Rechnungstexte, die Gerald unter Einstellungen → Rechnungstexte pflegt (Wunsch 20.10.2026).
// Dieselben Schlüssel nutzt der Content Hub (Reiter Rechnungen) – es gibt nur eine Quelle.
import { getSiteSetting, setSiteSetting } from './website-db';

export type RechnungstextKey =
  | 'invoice_intro_text' | 'invoice_kleinunternehmer_notice' | 'invoice_outro_text'
  | 'invoice_email_subject' | 'invoice_email_body'
  | 'angebot_intro_text' | 'angebot_outro_text' | 'angebot_email_subject' | 'angebot_email_body'
  | 'mahnung_text_1' | 'mahnung_text_2' | 'mahnung_text_3' | 'mahnung_email_subject' | 'mahnung_email_body';

export const RECHNUNGSTEXT_STANDARD: Record<RechnungstextKey, string> = {
  invoice_intro_text: 'für folgende Leistungen stelle ich Ihnen in Rechnung:',
  invoice_kleinunternehmer_notice: 'Kein Ausweis der Umsatzsteuer aufgrund der Anwendung der Kleinunternehmerregelung gemäß § 19 UStG.',
  invoice_outro_text: 'Vielen Dank für Ihr Vertrauen!',
  invoice_email_subject: 'Rechnung {{number}}',
  // Stufe 4 (K70): Angebotstexte, Startwerte laut Spezifikation (Gerald 22.10.2026).
  angebot_intro_text: 'Vielen Dank für Ihre Anfrage. Gerne biete ich Ihnen an:',
  angebot_outro_text: 'Ich freue mich auf Ihre Rückmeldung.',
  angebot_email_subject: 'Angebot {{number}}',
  angebot_email_body: 'Sehr geehrte/r {{customer_name}},\n\nanbei erhalten Sie mein Angebot {{number}} über {{gross_amount}}, gültig bis {{valid_until}}.\n\nIch freue mich auf Ihre Rückmeldung.\n\nMit freundlichen Grüßen\n{{seller_name}}',
  // K165 (Handtest 01.11.2026, Freigabe Gerald): Mahnschreiben je Stufe in Ich-Form, Mail mit Anhängen.
  mahnung_text_1: 'sicher ist es im Alltag untergegangen: Die Rechnung Nr. {{number}} vom {{issue_date}} über {{gross_amount}} war am {{due_date}} fällig. Bitte überweisen Sie den Betrag bis zum {{frist}}. Falls Sie inzwischen gezahlt haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.',
  mahnung_text_2: 'trotz meiner Zahlungserinnerung vom {{vorige_mahnung}} habe ich für die Rechnung Nr. {{number}} noch keinen Zahlungseingang feststellen können. Bitte überweisen Sie den offenen Betrag zuzüglich Mahngebühr, zusammen {{gesamt}}, bis spätestens {{frist}}. Falls Sie inzwischen gezahlt haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.',
  mahnung_text_3: 'die Rechnung Nr. {{number}} ist trotz Zahlungserinnerung und Mahnung weiterhin offen. Dies ist meine letzte Mahnung. Geht der Gesamtbetrag von {{gesamt}} nicht bis zum {{frist}} bei mir ein, werde ich die Forderung ohne weitere Ankündigung gerichtlich geltend machen (gerichtliches Mahnverfahren). Die dadurch entstehenden Kosten gehen zu Ihren Lasten. Wenn Sie Schwierigkeiten mit der Zahlung haben, melden Sie sich bitte – über eine Ratenzahlung können wir sprechen.',
  mahnung_email_subject: '{{titel}} zur Rechnung {{number}}',
  mahnung_email_body: 'Guten Tag {{customer_name}},\n\nanbei {{titel_klein}} zur Rechnung {{number}} mit der Bitte um Zahlung von {{gesamt}} bis zum {{frist}}. Das Schreiben und die Rechnung finden Sie im Anhang.\n\nMit freundlichen Grüßen\n{{seller_name}}',
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
  { key: 'angebot_intro_text', label: 'Angebot: Einleitung', mehrzeilig: false, max: 500, pflicht: false,
    wirktIn: 'Steht auf jedem neuen Angebot über den Positionen (PDF und Versand).' },
  { key: 'angebot_outro_text', label: 'Angebot: Schlusstext', mehrzeilig: false, max: 500, pflicht: false,
    wirktIn: 'Steht auf jedem neuen Angebot unter den Positionen (PDF und Versand).' },
  { key: 'angebot_email_subject', label: 'Betreff der Angebots-E-Mail', mehrzeilig: false, max: 200, pflicht: false,
    wirktIn: 'Betreff der E-Mail, mit der ein Angebot verschickt wird. {{number}} = Angebotsnummer.' },
  { key: 'angebot_email_body', label: 'Text der Angebots-E-Mail', mehrzeilig: true, max: 4000, pflicht: false,
    wirktIn: 'Text der E-Mail beim Angebotsversand. Platzhalter: {{customer_name}}, {{number}}, {{gross_amount}}, {{valid_until}}, {{seller_name}}.' },
  { key: 'mahnung_text_1', label: 'Mahnwesen: Text der Zahlungserinnerung (Stufe 1)', mehrzeilig: true, max: 2000, pflicht: true,
    wirktIn: 'Haupttext des Schreibens (nach der Anrede). Platzhalter: {{number}}, {{issue_date}}, {{due_date}}, {{gross_amount}}, {{offen}}, {{gebuehr}}, {{gesamt}}, {{frist}}, {{vorige_mahnung}}.' },
  { key: 'mahnung_text_2', label: 'Mahnwesen: Text der 1. Mahnung (Stufe 2)', mehrzeilig: true, max: 2000, pflicht: true,
    wirktIn: 'Haupttext des Schreibens. Platzhalter wie bei Stufe 1.' },
  { key: 'mahnung_text_3', label: 'Mahnwesen: Text der letzten Mahnung (Stufe 3)', mehrzeilig: true, max: 2000, pflicht: true,
    wirktIn: 'Haupttext des Schreibens. Platzhalter wie bei Stufe 1.' },
  { key: 'mahnung_email_subject', label: 'Mahnwesen: Betreff der E-Mail', mehrzeilig: false, max: 200, pflicht: false,
    wirktIn: 'Betreff beim Versand per E-Mail. {{titel}} = Zahlungserinnerung / 1. Mahnung / Letzte Mahnung, {{number}} = Rechnungsnummer.' },
  { key: 'mahnung_email_body', label: 'Mahnwesen: Text der E-Mail', mehrzeilig: true, max: 4000, pflicht: false,
    wirktIn: 'Kurzes Anschreiben; Mahnschreiben und Rechnung hängen als PDF an. Platzhalter: {{customer_name}}, {{titel}}, {{titel_klein}}, {{number}}, {{gesamt}}, {{frist}}, {{seller_name}}.' },
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
