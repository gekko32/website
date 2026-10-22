// Rechnungswesen Stufe 3, T1: Regeln, die Gerald selbst über Formularfelder pflegt
// (Spezifikation K17, K36, K39, K40). Gespeichert in site_settings, nie im Code.
import { getSiteSetting, setSiteSetting } from './website-db';

export type AusfallArt = 'prozent' | 'betrag';
export type Abrechnungsart = 'monatlich' | 'je_sitzung';

export interface Regeln {
  ausfallFristStunden: number;
  ausfallArt: AusfallArt;
  ausfallWert: number;
  abrechnungsartFirma: Abrechnungsart;
  abrechnungsartPrivat: Abrechnungsart;
  /** Stufe 4 (K70): Angebote gelten so viele Tage ab Versand (Vorschlag, im Einzelfall änderbar). */
  angebotGueltigTage: number;
}

/** Startwerte laut Entscheidung vom 20.10.2026 (24 h, voller Preis). */
export const REGEL_STANDARD: Regeln = {
  ausfallFristStunden: 24,
  ausfallArt: 'prozent',
  ausfallWert: 100,
  abrechnungsartFirma: 'monatlich',
  abrechnungsartPrivat: 'je_sitzung',
  angebotGueltigTage: 30,
};

export interface RegelFeld {
  key: string;
  prop: keyof Regeln;
  label: string;
  wirktIn: string;
}

export const REGEL_FELDER: readonly RegelFeld[] = [
  {
    key: 'regel_ausfall_frist_stunden', prop: 'ausfallFristStunden',
    label: 'Kostenfreie Absage bis … Stunden vor dem Termin',
    wirktIn: 'Erscheint in den AGB und beim Buchen; entscheidet, ob bei einer Absage ein Ausfallhonorar entsteht.',
  },
  {
    key: 'regel_ausfall_art', prop: 'ausfallArt',
    label: 'Ausfallhonorar als',
    wirktIn: 'Legt fest, ob das Ausfallhonorar ein Prozentsatz des Leistungspreises oder ein fester Betrag ist.',
  },
  {
    key: 'regel_ausfall_wert', prop: 'ausfallWert',
    label: 'Höhe des Ausfallhonorars',
    wirktIn: 'Erscheint in den AGB und beim Buchen; daraus wird jedes neue Ausfallhonorar berechnet.',
  },
  {
    key: 'regel_abrechnungsart_firma', prop: 'abrechnungsartFirma',
    label: 'Neue Firmenkunden abrechnen',
    wirktIn: 'Voreinstellung für neu angelegte Firmenkunden; in jeder Klientenakte änderbar.',
  },
  {
    key: 'regel_abrechnungsart_privat', prop: 'abrechnungsartPrivat',
    label: 'Neue Privatklienten abrechnen',
    wirktIn: 'Voreinstellung für neu angelegte Privatklienten; in jeder Klientenakte änderbar.',
  },
  {
    key: 'regel_angebot_gueltig_tage', prop: 'angebotGueltigTage',
    label: 'Angebote gültig für … Tage',
    wirktIn: 'Vorschlag für „gültig bis“ bei jedem neuen Angebot (im Angebot änderbar); danach gilt es als abgelaufen.',
  },
];

export interface RegelFehler { key: string; meldung: string }

function zahl(roh: string | undefined): number | null {
  const s = (roh ?? '').trim().replace(',', '.');
  if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

function abrechnungsart(roh: string | undefined): Abrechnungsart | null {
  return roh === 'monatlich' || roh === 'je_sitzung' ? roh : null;
}

/** Prüft Formulareingaben. Bei Fehlern ist `werte` null und nichts wird gespeichert. */
export function pruefeRegeln(form: Record<string, string | undefined>): { werte: Regeln | null; fehler: RegelFehler[] } {
  const fehler: RegelFehler[] = [];

  const frist = zahl(form.regel_ausfall_frist_stunden);
  if (frist === null || !Number.isInteger(frist) || frist < 0 || frist > 720) {
    fehler.push({ key: 'regel_ausfall_frist_stunden', meldung: 'Bitte eine ganze Zahl von 0 bis 720 Stunden eintragen.' });
  }

  const art = form.regel_ausfall_art === 'prozent' || form.regel_ausfall_art === 'betrag' ? form.regel_ausfall_art : null;
  if (art === null) {
    fehler.push({ key: 'regel_ausfall_art', meldung: 'Bitte „Prozent“ oder „fester Betrag“ wählen.' });
  }

  const wert = zahl(form.regel_ausfall_wert);
  if (wert === null || wert < 0) {
    fehler.push({ key: 'regel_ausfall_wert', meldung: 'Bitte einen Wert ab 0 eintragen.' });
  } else if (art === 'prozent' && wert > 100) {
    fehler.push({ key: 'regel_ausfall_wert', meldung: 'Mehr als 100 % des Preises ist nicht möglich.' });
  }

  const firma = abrechnungsart(form.regel_abrechnungsart_firma);
  if (firma === null) {
    fehler.push({ key: 'regel_abrechnungsart_firma', meldung: 'Bitte „monatlich“ oder „je Sitzung“ wählen.' });
  }
  const privat = abrechnungsart(form.regel_abrechnungsart_privat);
  if (privat === null) {
    fehler.push({ key: 'regel_abrechnungsart_privat', meldung: 'Bitte „monatlich“ oder „je Sitzung“ wählen.' });
  }

  // Stufe 4 (K70); fehlt das Feld (ältere Aufrufe), gilt der Startwert.
  const gueltig = form.regel_angebot_gueltig_tage === undefined ? REGEL_STANDARD.angebotGueltigTage : zahl(form.regel_angebot_gueltig_tage);
  if (gueltig === null || !Number.isInteger(gueltig) || gueltig < 1 || gueltig > 365) {
    fehler.push({ key: 'regel_angebot_gueltig_tage', meldung: 'Bitte eine ganze Zahl von 1 bis 365 Tagen eintragen.' });
  }

  if (fehler.length > 0) return { werte: null, fehler };
  return {
    werte: {
      ausfallFristStunden: frist!,
      ausfallArt: art!,
      ausfallWert: wert!,
      abrechnungsartFirma: firma!,
      abrechnungsartPrivat: privat!,
      angebotGueltigTage: gueltig!,
    },
    fehler,
  };
}

/** Ausfallhonorar in Euro, auf Cent gerundet. */
export function ausfallBetrag(regeln: Regeln, leistungspreis: number): number {
  const betrag = regeln.ausfallArt === 'betrag' ? regeln.ausfallWert : (leistungspreis * regeln.ausfallWert) / 100;
  return Math.round(betrag * 100) / 100;
}

/** Werte für die Platzhalter {{regeln.*}} in AGB und Buchungshinweis (T2, K37, K38). */
export function regelTokenWerte(regeln: Regeln, zahlungszielTage: number): { ausfallFrist: string; ausfallHoehe: string; zahlungsziel: string } {
  const zahlDe = (n: number, stellen: number) =>
    n.toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen });
  let ausfallHoehe: string;
  if (regeln.ausfallArt === 'betrag') ausfallHoehe = `von ${zahlDe(regeln.ausfallWert, 2)} €`;
  else if (regeln.ausfallWert === 100) ausfallHoehe = 'des vereinbarten Preises';
  else ausfallHoehe = `von ${zahlDe(regeln.ausfallWert, Number.isInteger(regeln.ausfallWert) ? 0 : 2)} % des vereinbarten Preises`;
  return {
    ausfallFrist: String(regeln.ausfallFristStunden),
    ausfallHoehe,
    zahlungsziel: String(zahlungszielTage),
  };
}

/** Zahlungsziel in Tagen: ganze Zahl 0–365 (K39). */
export function pruefeZahlungsziel(roh: string | null | undefined): { wert: number | null; fehler: string | null } {
  const s = (roh ?? '').trim();
  if (!/^\d+$/.test(s) || Number(s) > 365) {
    return { wert: null, fehler: 'Bitte als Zahlungsziel eine ganze Zahl von 0 bis 365 Tagen eintragen.' };
  }
  return { wert: Number(s), fehler: null };
}

/** Zahlungsziel aus Einstellungen → Rechnungen; ohne gültigen Wert 14 Tage. */
export async function ladeZahlungsziel(brand: string): Promise<number> {
  try {
    return pruefeZahlungsziel(await getSiteSetting(brand, 'invoice_payment_days')).wert ?? 14;
  } catch {
    return 14;
  }
}

/** Platzhalter-Werte direkt aus den Einstellungen; ohne Datenbank die Startwerte. */
export async function ladeRegelTokenWerte(brand: string): Promise<ReturnType<typeof regelTokenWerte>> {
  try {
    const [regeln, zahlungsziel] = await Promise.all([ladeRegeln(brand), ladeZahlungsziel(brand)]);
    return regelTokenWerte(regeln, zahlungsziel);
  } catch {
    return regelTokenWerte(REGEL_STANDARD, 14);
  }
}

/** Liest die Regeln; fehlende oder kaputte Werte fallen auf den Startwert zurück. */
export async function ladeRegeln(brand: string): Promise<Regeln> {
  const roh = await Promise.all(REGEL_FELDER.map((f) => getSiteSetting(brand, f.key)));
  const form: Record<string, string | undefined> = {};
  REGEL_FELDER.forEach((f, i) => { form[f.key] = roh[i] ?? String(REGEL_STANDARD[f.prop]); });
  const { werte } = pruefeRegeln(form);
  if (werte) return werte;
  // Einzelne kaputte Werte: Feld für Feld auf Standard zurückfallen.
  const ergebnis: Regeln = { ...REGEL_STANDARD };
  for (const f of REGEL_FELDER) {
    const einzeln = pruefeRegeln({ ...formAus(REGEL_STANDARD), [f.key]: form[f.key] });
    if (einzeln.werte) (ergebnis as unknown as Record<string, unknown>)[f.prop] = einzeln.werte[f.prop];
  }
  return ergebnis;
}

/** Regeln als Formularwerte (für Vorbelegung und Rückfall). */
export function formAus(regeln: Regeln): Record<string, string> {
  return Object.fromEntries(REGEL_FELDER.map((f) => [f.key, String(regeln[f.prop])]));
}

export async function speichereRegeln(brand: string, regeln: Regeln): Promise<void> {
  const form = formAus(regeln);
  await Promise.all(REGEL_FELDER.map((f) => setSiteSetting(brand, f.key, form[f.key])));
}
