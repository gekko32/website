import { pool, getSiteSetting, setSiteSetting, initTaxMonitorTables } from './website-db';

export enum TaxThresholdStatus {
  Safe = 'safe',
  Warning = 'warning',
  Exceeded = 'exceeded',
  HardExceeded = 'hard',
}

export const THRESHOLD_KLEIN   = 25_000;
export const THRESHOLD_WARNING = 20_000;
export const THRESHOLD_HARD    = 100_000;

export async function getTaxMode(brand: string): Promise<'kleinunternehmer' | 'regelbesteuerung'> {
  const v = await getSiteSetting(brand, 'tax_mode');
  return v === 'regelbesteuerung' ? 'regelbesteuerung' : 'kleinunternehmer';
}

export async function setTaxMode(brand: string, mode: 'kleinunternehmer' | 'regelbesteuerung', opts?: {
  triggerInvoiceId?: string; yearRevenue?: number; notes?: string;
}): Promise<void> {
  await initTaxMonitorTables();
  const current = await getTaxMode(brand);
  if (current === mode) return;
  await setSiteSetting(brand, 'tax_mode', mode);
  await pool.query(
    `INSERT INTO tax_mode_changes (brand, from_mode, to_mode, trigger_invoice_id, year_revenue_at_change, notes)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [brand, current, mode, opts?.triggerInvoiceId??null, opts?.yearRevenue??null, opts?.notes??null]
  );
}

export async function getYearRevenue(brand: string, year: number): Promise<number> {
  await initTaxMonitorTables();
  const r = await pool.query(
    `SELECT COALESCE(SUM(net_amount), 0)::numeric AS total
     FROM billing_invoices
     WHERE brand=$1 AND EXTRACT(YEAR FROM issue_date)=$2
       AND status IN ('open','paid')`,
    [brand, year]
  );
  return Number(r.rows[0].total);
}

/**
 * Einstufung des Umsatzes im LAUFENDEN Jahr (Anzeige).
 * § 19 UStG ab 1.1.2025: „überstiegen“ = strikt größer.
 * - Warning:      nähert sich 25.000 € (betrifft das FOLGEJAHR)
 * - Exceeded:     > 25.000 € → dieses Jahr bleibt § 19, ab 1.1. Folgejahr Regelbesteuerung
 * - HardExceeded: > 100.000 € → Regelbesteuerung sofort
 */
export function checkThreshold(revenue: number): TaxThresholdStatus {
  if (revenue > THRESHOLD_HARD)     return TaxThresholdStatus.HardExceeded;
  if (revenue > THRESHOLD_KLEIN)    return TaxThresholdStatus.Exceeded;
  if (revenue >= THRESHOLD_WARNING) return TaxThresholdStatus.Warning;
  return TaxThresholdStatus.Safe;
}

/**
 * § 19 UStG in der Fassung ab 1.1.2025 (Gerald, 19.10.2026 – vorher galt hier
 * fälschlich 25.000 € im laufenden Jahr als Umstellungsgrund):
 * Kleinunternehmer bleibt, wessen Gesamtumsatz im VORJAHR 25.000 € nicht
 * überstieg und im LAUFENDEN Jahr 100.000 € nicht übersteigt.
 *
 * Die Plattform kennt nur ihre eigenen Rechnungen – die Summen sind also eine
 * Untergrenze des Gesamtumsatzes. Verletzt schon diese Untergrenze die Regel,
 * ist die Umstellung sicher richtig; deshalb wird nur dann automatisch
 * umgestellt. Liegen weitere Umsätze außerhalb der Plattform vor, muss die
 * Steuerart von Hand in den Einstellungen umgestellt werden.
 */
export function mussRegelbesteuern(vorjahr: number, laufend: number): boolean {
  return vorjahr > THRESHOLD_KLEIN || laufend > THRESHOLD_HARD;
}

export async function checkAndApplyTaxModeSwitch(brand: string, invoiceId: string | null): Promise<boolean> {
  const year = new Date().getFullYear();
  const [vorjahr, laufend] = await Promise.all([
    getYearRevenue(brand, year - 1),
    getYearRevenue(brand, year),
  ]);
  if (!mussRegelbesteuern(vorjahr, laufend)) return false;
  const current = await getTaxMode(brand);
  if (current !== 'kleinunternehmer') return false;
  const grund = vorjahr > THRESHOLD_KLEIN
    ? `Vorjahresumsatz ${vorjahr.toFixed(2)} € > ${THRESHOLD_KLEIN} €`
    : `Jahresumsatz ${laufend.toFixed(2)} € > ${THRESHOLD_HARD} €`;
  await setTaxMode(brand, 'regelbesteuerung', {
    triggerInvoiceId: invoiceId ?? undefined, yearRevenue: laufend,
    notes: `Automatischer Wechsel: ${grund} (§ 19 UStG ab 2025)`,
  });
  return true;
}

/**
 * Die eine gültige Steuerart für neue Rechnungen: wendet zuerst die
 * automatische Umstellung an und liest dann die Einstellung. Alle
 * Rechnungswege (Formular, Buchung, Schnittstelle) müssen hierüber gehen,
 * damit ein Kleinunternehmer nie versehentlich Umsatzsteuer ausweist (§ 14c UStG).
 */
export async function resolveEffectiveTaxMode(brand: string): Promise<'kleinunternehmer' | 'regelbesteuerung'> {
  await checkAndApplyTaxModeSwitch(brand, null);
  return getTaxMode(brand);
}

export async function getMonthlyBreakdown(brand: string, year: number): Promise<{
  month: number; net: number; cumulative: number; status: TaxThresholdStatus;
}[]> {
  const r = await pool.query(
    `SELECT EXTRACT(MONTH FROM issue_date)::int AS month, COALESCE(SUM(net_amount),0)::numeric AS net
     FROM billing_invoices
     WHERE brand=$1 AND EXTRACT(YEAR FROM issue_date)=$2
       AND status IN ('open','paid')
     GROUP BY month ORDER BY month`,
    [brand, year]
  );
  const byMonth = Object.fromEntries(r.rows.map((row: { month: number; net: string }) => [row.month, Number(row.net)]));
  let cumulative = 0;
  return Array.from({ length: 12 }, (_, i) => {
    cumulative += byMonth[i + 1] ?? 0;
    return { month: i + 1, net: byMonth[i + 1] ?? 0, cumulative, status: checkThreshold(cumulative) };
  });
}

export async function getUstvaExport(brand: string, year: number, quarter?: number): Promise<{
  period: string; taxMode: string; revenue0: number; revenue7: number; revenue19: number;
  tax7: number; tax19: number; totalTax: number;
}> {
  const monthRange = quarter
    ? { start: (quarter-1)*3+1, end: quarter*3 }
    : { start: 1, end: 12 };
  const r = await pool.query(
    `SELECT tax_rate, SUM(net_amount) AS net, SUM(tax_amount) AS tax
     FROM billing_invoices
     WHERE brand=$1 AND EXTRACT(YEAR FROM issue_date)=$2
       AND EXTRACT(MONTH FROM issue_date) BETWEEN $3 AND $4
       AND status IN ('open','paid')
     GROUP BY tax_rate`,
    [brand, year, monthRange.start, monthRange.end]
  );
  const period = quarter ? `Q${quarter}/${year}` : `${year}`;
  const byRate = Object.fromEntries(r.rows.map((row: {tax_rate:string;net:string;tax:string}) =>
    [row.tax_rate, { net: Number(row.net), tax: Number(row.tax) }]
  ));
  return {
    period,
    taxMode: await getTaxMode(brand),
    revenue0:  byRate['0']?.net  ?? 0,
    revenue7:  byRate['7']?.net  ?? 0,
    revenue19: byRate['19']?.net ?? 0,
    tax7:   byRate['7']?.tax  ?? 0,
    tax19:  byRate['19']?.tax ?? 0,
    totalTax: (byRate['7']?.tax ?? 0) + (byRate['19']?.tax ?? 0),
  };
}
