// K165 (Handtest 01.11.2026, F10/F11): Zahlen des Mahnwesens, die Gerald unter Einstellungen → Regeln
// (Abschnitt „Mahnwesen“) selbst pflegt. Die Schlüssel invoice_dunning_* gab es schon (ohne Oberfläche);
// neu ist die Frist. Startwerte laut Entscheidung 01.11.2026: Gebühren 0 / 2,50 / 2,50 €, keine Zinsen,
// Frist 10 Tage, nächste Stufe frühestens nach 14 Tagen.
import { getSiteSetting, setSiteSetting } from './website-db';

export interface MahnEinstellungen {
  gebuehr1: number; gebuehr2: number; gebuehr3: number;
  /** Verzugszinsen in Prozent im Jahr; 0 = keine. */
  zinsenProzent: number;
  /** Zahlungsfrist im Mahnschreiben: so viele Tage nach dem Versand. */
  fristTage: number;
  /** Nächste Mahnstufe frühestens nach so vielen Tagen. */
  abstandTage: number;
  /** N32: Vorschlag für die Mahnpause beim Verwerfen einer Mahnung (Tage ab heute). */
  pauseTage: number;
}

export const MAHN_STANDARD: MahnEinstellungen = {
  gebuehr1: 0, gebuehr2: 2.5, gebuehr3: 2.5, zinsenProzent: 0, fristTage: 10, abstandTage: 14, pauseTage: 14,
};

const SCHLUESSEL: Record<keyof MahnEinstellungen, string> = {
  gebuehr1: 'invoice_dunning_fee_1', gebuehr2: 'invoice_dunning_fee_2', gebuehr3: 'invoice_dunning_fee_3',
  zinsenProzent: 'invoice_dunning_interest_pa', fristTage: 'invoice_dunning_frist_tage', abstandTage: 'invoice_dunning_interval_days',
  pauseTage: 'invoice_dunning_pause_tage',
};

export const MAHN_FELDER: readonly { prop: keyof MahnEinstellungen; key: string; label: string; einheit: string; ganz: boolean; max: number }[] = [
  { prop: 'gebuehr1', key: SCHLUESSEL.gebuehr1, label: 'Gebühr Zahlungserinnerung (Stufe 1)', einheit: '€', ganz: false, max: 100 },
  { prop: 'gebuehr2', key: SCHLUESSEL.gebuehr2, label: 'Gebühr 1. Mahnung (Stufe 2)', einheit: '€', ganz: false, max: 100 },
  { prop: 'gebuehr3', key: SCHLUESSEL.gebuehr3, label: 'Gebühr letzte Mahnung (Stufe 3)', einheit: '€', ganz: false, max: 100 },
  { prop: 'zinsenProzent', key: SCHLUESSEL.zinsenProzent, label: 'Verzugszinsen (0 = keine)', einheit: '% im Jahr', ganz: false, max: 20 },
  { prop: 'fristTage', key: SCHLUESSEL.fristTage, label: 'Zahlungsfrist im Mahnschreiben', einheit: 'Tage nach Versand', ganz: true, max: 60 },
  { prop: 'abstandTage', key: SCHLUESSEL.abstandTage, label: 'Nächste Stufe frühestens nach', einheit: 'Tagen', ganz: true, max: 90 },
  { prop: 'pauseTage', key: SCHLUESSEL.pauseTage, label: 'Mahnpause beim Verwerfen (Vorschlag)', einheit: 'Tage', ganz: true, max: 365 },
];

export async function ladeMahnEinstellungen(brand: string): Promise<MahnEinstellungen> {
  const werte = await Promise.all(MAHN_FELDER.map((f) => getSiteSetting(brand, f.key)));
  const e = { ...MAHN_STANDARD };
  MAHN_FELDER.forEach((f, i) => {
    const n = Number(werte[i]);
    if (werte[i] !== null && werte[i] !== '' && Number.isFinite(n) && n >= 0) e[f.prop] = n;
  });
  return e;
}

/** Prüft die Eingaben (Komma oder Punkt). Bei Fehlern ist `werte` null und nichts wird gespeichert. */
export function pruefeMahnEinstellungen(form: Record<string, string | undefined>): {
  werte: MahnEinstellungen | null; fehler: { key: string; meldung: string }[];
} {
  const fehler: { key: string; meldung: string }[] = [];
  const werte = { ...MAHN_STANDARD };
  for (const f of MAHN_FELDER) {
    const roh = (form[f.key] ?? '').trim().replace(',', '.');
    const n = Number(roh);
    if (roh === '' || !/^\d+(\.\d{1,2})?$/.test(roh) || n > f.max || (f.ganz && !Number.isInteger(n)) || ((f.prop === 'fristTage' || f.prop === 'pauseTage') && n < 1)) {
      fehler.push({ key: f.key, meldung: f.ganz ? `Bitte eine ganze Zahl bis ${f.max} eintragen.` : `Bitte eine Zahl von 0 bis ${f.max} eintragen (z. B. 2,50).` });
    } else werte[f.prop] = n;
  }
  return fehler.length > 0 ? { werte: null, fehler } : { werte, fehler };
}

export async function speichereMahnEinstellungen(brand: string, e: MahnEinstellungen): Promise<void> {
  await Promise.all(MAHN_FELDER.map((f) => setSiteSetting(brand, f.key, String(e[f.prop]))));
}

/** Gebühr für eine Stufe (1–3). */
export function gebuehrFuer(e: MahnEinstellungen, stufe: number): number {
  return stufe <= 1 ? e.gebuehr1 : stufe === 2 ? e.gebuehr2 : e.gebuehr3;
}

/** Frist als ISO-Datum: Versanddatum + fristTage (Europe/Berlin). */
export function fristDatum(e: MahnEinstellungen, ab: Date): string {
  const d = new Date(ab.getTime() + e.fristTage * 86_400_000);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
}

/** Bezeichnung einer Stufe für Seiten, Betreff und PDF-Titel. */
export function stufenName(stufe: number): string {
  return stufe <= 1 ? 'Zahlungserinnerung' : stufe === 2 ? '1. Mahnung' : 'Letzte Mahnung';
}
