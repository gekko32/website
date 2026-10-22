// Rechnungswesen Stufe 3, T12 (AE6): Entwürfe tragen nur eine Entwurfskennung (K33).
// Die Rechnungsnummer vergibt erst das Festschreiben (K34), und zwar in derselben
// Transaktion: Scheitert das Festschreiben, wird auch der Zähler zurückgenommen –
// so bleiben die Nummern lückenlos (K35).
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { initInvoiceCountersTable } from './portal-tools-db';

const PRAEFIX = 'ENTWURF-';

export function entwurfsKennung(): string {
  return PRAEFIX + randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}

export function istEntwurfsKennung(nummer: string | null | undefined): boolean {
  return typeof nummer === 'string' && nummer.startsWith(PRAEFIX);
}

/** Verwendungszweck zur Nummer (wie bisher: „RE-2027-0001“ → „RG2027-0001“). */
export const zahlungsreferenz = (nummer: string): string => nummer.replace('RE-', 'RG');

const tagBerlin = (d: Date): string => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });

/**
 * Rechnungsdatum ist der Tag des Festschreibens (deutsche Zeit). Zahlungsziel: `zielTage` aus
 * der heutigen Einstellung (K38), sonst so viele Tage wie im Entwurf. Nummer aus dem Jahr des Rechnungsdatums.
 */
export function datenBeimFestschreiben(
  entwurfDatum: string, entwurfFaellig: string, jetzt: Date, zielTage?: number,
): { issueDate: string; dueDate: string; jahr: number } {
  const tage = zielTage ?? Math.max(0, Math.round((Date.parse(entwurfFaellig) - Date.parse(entwurfDatum)) / 86_400_000));
  const issueDate = tagBerlin(jetzt);
  const faellig = new Date(`${issueDate}T00:00:00Z`);
  faellig.setUTCDate(faellig.getUTCDate() + tage);
  return { issueDate, dueDate: faellig.toISOString().slice(0, 10), jahr: Number(issueDate.slice(0, 4)) };
}

/** Nächste Nummer im Zähler, innerhalb der laufenden Transaktion `db` (Zeile bleibt bis zum Ende gesperrt). */
export async function naechsteNummer(db: Pick<PoolClient, 'query'>, brand: string, jahr: number, art: 'invoice' | 'gutschrift' | 'angebot' = 'invoice'): Promise<string> {
  await initInvoiceCountersTable();
  const r = await db.query(
    `INSERT INTO invoice_counters (brand, year, kind, counter)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (brand, year, kind)
     DO UPDATE SET counter = invoice_counters.counter + 1
     RETURNING counter`,
    [brand, jahr, art]);
  const n = Number(r.rows[0].counter);
  // Stufe 4 (K49): Angebote AN-Jahr-laufend, eigener Zähler.
  const praefix = art === 'gutschrift' ? 'GS' : art === 'angebot' ? 'AN' : 'RE';
  return `${praefix}-${jahr}-${String(n).padStart(4, '0')}`;
}
