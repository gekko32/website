import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
const getSiteSetting = vi.fn();
const setSiteSetting = vi.fn();
const initTaxMonitorTables = vi.fn();

vi.mock('./website-db', () => ({
  pool: { query: (...a: unknown[]) => query(...a) },
  getSiteSetting: (...a: unknown[]) => getSiteSetting(...a),
  setSiteSetting: (...a: unknown[]) => setSiteSetting(...a),
  initTaxMonitorTables: (...a: unknown[]) => initTaxMonitorTables(...a),
}));

import {
  getTaxMode, setTaxMode, getYearRevenue, checkThreshold, TaxThresholdStatus,
  checkAndApplyTaxModeSwitch, getMonthlyBreakdown, getUstvaExport,
  mussRegelbesteuern, resolveEffectiveTaxMode, getSteuerHinweis, bestaetigeSteuerHinweis,
  THRESHOLD_KLEIN, THRESHOLD_HARD,
} from './tax-monitor';

beforeEach(() => {
  query.mockReset();
  getSiteSetting.mockReset();
  setSiteSetting.mockReset();
  initTaxMonitorTables.mockReset();
  initTaxMonitorTables.mockResolvedValue(undefined);
});

it('returns 0 revenue for an empty brand', async () => {
  query.mockResolvedValueOnce({ rows: [{ total: '0' }] });
  const r = await getYearRevenue('test-empty', 2025);
  expect(r).toBe(0);
});

it('classifies current-year revenue (§ 19 UStG ab 2025: „überstiegen“ = strikt größer)', () => {
  expect(checkThreshold(0)).toBe(TaxThresholdStatus.Safe);
  expect(checkThreshold(20000)).toBe(TaxThresholdStatus.Warning);
  expect(checkThreshold(25000)).toBe(TaxThresholdStatus.Warning);
  expect(checkThreshold(25000.01)).toBe(TaxThresholdStatus.Exceeded);
  expect(checkThreshold(100000)).toBe(TaxThresholdStatus.Exceeded);
  expect(checkThreshold(100001)).toBe(TaxThresholdStatus.HardExceeded);
});

describe('mussRegelbesteuern (§ 19 UStG ab 2025)', () => {
  it('bleibt Kleinunternehmer bei > 25.000 € im laufenden Jahr, wenn das Vorjahr darunter lag', () => {
    expect(mussRegelbesteuern(10000, 40000)).toBe(false);
    expect(mussRegelbesteuern(25000, 100000)).toBe(false);
  });
  it('Regelbesteuerung, wenn das Vorjahr 25.000 € überstieg', () => {
    expect(mussRegelbesteuern(25000.01, 0)).toBe(true);
  });
  it('Regelbesteuerung sofort, wenn das laufende Jahr 100.000 € übersteigt', () => {
    expect(mussRegelbesteuern(0, 100000.01)).toBe(true);
  });
});

describe('getTaxMode', () => {
  it('defaults to kleinunternehmer when the setting is unset', async () => {
    getSiteSetting.mockResolvedValueOnce(null);
    expect(await getTaxMode('mentolder')).toBe('kleinunternehmer');
  });

  it('defaults to kleinunternehmer for any value other than regelbesteuerung', async () => {
    getSiteSetting.mockResolvedValueOnce('garbage');
    expect(await getTaxMode('mentolder')).toBe('kleinunternehmer');
  });

  it('returns regelbesteuerung when explicitly set', async () => {
    getSiteSetting.mockResolvedValueOnce('regelbesteuerung');
    expect(await getTaxMode('mentolder')).toBe('regelbesteuerung');
  });
});

describe('setTaxMode', () => {
  it('is a no-op when the mode is unchanged', async () => {
    getSiteSetting.mockResolvedValueOnce('kleinunternehmer');
    await setTaxMode('mentolder', 'kleinunternehmer');
    expect(setSiteSetting).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(initTaxMonitorTables).toHaveBeenCalledTimes(1);
  });

  it('persists the switch and logs a tax_mode_changes row', async () => {
    getSiteSetting.mockResolvedValueOnce('kleinunternehmer');
    query.mockResolvedValueOnce({ rows: [] });
    await setTaxMode('mentolder', 'regelbesteuerung', {
      triggerInvoiceId: 'inv-1', yearRevenue: 30000, notes: 'manual',
    });
    expect(setSiteSetting).toHaveBeenCalledWith('mentolder', 'tax_mode', 'regelbesteuerung');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO tax_mode_changes/);
    expect(params).toEqual(['mentolder', 'kleinunternehmer', 'regelbesteuerung', 'inv-1', 30000, 'manual']);
  });

  it('defaults opts fields to null when omitted', async () => {
    getSiteSetting.mockResolvedValueOnce('kleinunternehmer');
    query.mockResolvedValueOnce({ rows: [] });
    await setTaxMode('mentolder', 'regelbesteuerung');
    const params = query.mock.calls[0][1] as unknown[];
    expect(params).toEqual(['mentolder', 'kleinunternehmer', 'regelbesteuerung', null, null, null]);
  });
});

describe('getYearRevenue', () => {
  it('queries with brand + year and casts total to a number', async () => {
    query.mockResolvedValueOnce({ rows: [{ total: '12345.67' }] });
    const r = await getYearRevenue('mentolder', 2026);
    expect(r).toBe(12345.67);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/FROM billing_invoices/);
    expect(params).toEqual(['mentolder', 2026]);
  });
});

describe('checkAndApplyTaxModeSwitch', () => {
  const umsatz = (vorjahr: number, laufend: number) => {
    const year = new Date().getFullYear();
    query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (/SUM\(net_amount\)/.test(sql)) {
        return { rows: [{ total: String(params[1] === year - 1 ? vorjahr : laufend) }] };
      }
      return { rows: [] };
    });
  };

  it('stellt NICHT um, wenn nur das laufende Jahr 25.000 € übersteigt (altes Recht)', async () => {
    umsatz(0, 30000);
    const out = await checkAndApplyTaxModeSwitch('mentolder', 'inv-1');
    expect(out).toBe(false);
    expect(setSiteSetting).not.toHaveBeenCalled();
    expect(getSiteSetting).not.toHaveBeenCalled();
  });

  it('stellt um, wenn der Vorjahresumsatz 25.000 € überstieg', async () => {
    umsatz(THRESHOLD_KLEIN + 1, 0);
    getSiteSetting
      .mockResolvedValueOnce('kleinunternehmer') // getTaxMode in checkAndApplyTaxModeSwitch
      .mockResolvedValueOnce('kleinunternehmer'); // getTaxMode in setTaxMode
    const out = await checkAndApplyTaxModeSwitch('mentolder', 'inv-1');
    expect(out).toBe(true);
    expect(setSiteSetting).toHaveBeenCalledWith('mentolder', 'tax_mode', 'regelbesteuerung');
    const insertCall = query.mock.calls.find((c) => /INSERT INTO tax_mode_changes/.test(c[0] as string));
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as unknown[];
    expect(params[3]).toBe('inv-1');
    expect(params[5]).toMatch(/Automatischer Wechsel: Vorjahresumsatz/);
  });

  it('K141: merkt sich die automatische Umstellung als Hinweis für den Admin', async () => {
    umsatz(THRESHOLD_KLEIN + 1, 0);
    getSiteSetting.mockResolvedValueOnce('kleinunternehmer').mockResolvedValueOnce('kleinunternehmer');
    await checkAndApplyTaxModeSwitch('mentolder', 'inv-1');
    const hinweis = setSiteSetting.mock.calls.find((c) => c[1] === 'tax_mode_hinweis');
    expect(hinweis).toBeDefined();
    expect(JSON.parse(hinweis![2] as string).grund).toMatch(/Vorjahresumsatz/);
  });

  it('stellt sofort um, wenn das laufende Jahr 100.000 € übersteigt', async () => {
    umsatz(0, THRESHOLD_HARD + 1);
    getSiteSetting.mockResolvedValueOnce('kleinunternehmer').mockResolvedValueOnce('kleinunternehmer');
    const out = await checkAndApplyTaxModeSwitch('mentolder', null);
    expect(out).toBe(true);
    const insertCall = query.mock.calls.find((c) => /INSERT INTO tax_mode_changes/.test(c[0] as string));
    expect((insertCall![1] as unknown[])[3]).toBeNull();
  });

  it('stellt nicht erneut um, wenn schon Regelbesteuerung gilt', async () => {
    umsatz(THRESHOLD_KLEIN + 1, THRESHOLD_HARD + 1);
    getSiteSetting.mockResolvedValueOnce('regelbesteuerung');
    const out = await checkAndApplyTaxModeSwitch('mentolder', 'inv-1');
    expect(out).toBe(false);
    expect(setSiteSetting).not.toHaveBeenCalled();
  });
});

describe('Steuer-Hinweis (K141)', () => {
  it('liest den Hinweis und verwirft kaputte Werte', async () => {
    getSiteSetting.mockResolvedValueOnce(JSON.stringify({ am: '2026-08-22T03:13:51Z', grund: 'Test' }));
    expect(await getSteuerHinweis('mentolder')).toEqual({ am: '2026-08-22T03:13:51Z', grund: 'Test' });
    getSiteSetting.mockResolvedValueOnce('kaputt');
    expect(await getSteuerHinweis('mentolder')).toBeNull();
    getSiteSetting.mockResolvedValueOnce('');
    expect(await getSteuerHinweis('mentolder')).toBeNull();
  });

  it('bestätigen leert den Hinweis', async () => {
    await bestaetigeSteuerHinweis('mentolder');
    expect(setSiteSetting).toHaveBeenCalledWith('mentolder', 'tax_mode_hinweis', '');
  });
});

describe('resolveEffectiveTaxMode', () => {
  it('liefert die Einstellung nach Anwendung der Regeln', async () => {
    query.mockImplementation(async () => ({ rows: [{ total: '0' }] }));
    getSiteSetting.mockResolvedValueOnce('kleinunternehmer');
    expect(await resolveEffectiveTaxMode('mentolder')).toBe('kleinunternehmer');
  });
});

describe('getMonthlyBreakdown', () => {
  it('builds all 12 months with cumulative revenue and threshold status', async () => {
    query.mockResolvedValueOnce({ rows: [
      { month: 1, net: '10000' },
      { month: 2, net: '11000' }, // cumulative 21000 -> Warning
      { month: 6, net: '5000' },  // cumulative 26000 -> Exceeded
    ] });
    const out = await getMonthlyBreakdown('mentolder', 2026);
    expect(out).toHaveLength(12);
    expect(out[0]).toEqual({ month: 1, net: 10000, cumulative: 10000, status: TaxThresholdStatus.Safe });
    expect(out[1].cumulative).toBe(21000);
    expect(out[1].status).toBe(TaxThresholdStatus.Warning);
    expect(out[5].cumulative).toBe(26000);
    expect(out[5].status).toBe(TaxThresholdStatus.Exceeded);
    // months without data carry forward the cumulative sum with net=0
    expect(out[2].net).toBe(0);
    expect(out[2].cumulative).toBe(21000);
    expect(out[11].net).toBe(0);
  });
});

describe('getUstvaExport', () => {
  it('computes yearly totals across all months when no quarter is given', async () => {
    query.mockResolvedValueOnce({ rows: [
      { tax_rate: '19', net: '1000', tax: '190' },
      { tax_rate: '7', net: '200', tax: '14' },
    ] });
    getSiteSetting.mockResolvedValueOnce('regelbesteuerung');
    const out = await getUstvaExport('mentolder', 2026);
    expect(out.period).toBe('2026');
    expect(out.taxMode).toBe('regelbesteuerung');
    expect(out.revenue19).toBe(1000);
    expect(out.revenue7).toBe(200);
    expect(out.revenue0).toBe(0);
    expect(out.tax19).toBe(190);
    expect(out.tax7).toBe(14);
    expect(out.totalTax).toBe(204);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/GROUP BY tax_rate/);
    expect(params).toEqual(['mentolder', 2026, 1, 12]);
  });

  it('scopes to a quarter and defaults missing rates to 0', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    getSiteSetting.mockResolvedValueOnce('kleinunternehmer');
    const out = await getUstvaExport('mentolder', 2026, 2);
    expect(out.period).toBe('Q2/2026');
    expect(out.taxMode).toBe('kleinunternehmer');
    expect(out.revenue0).toBe(0);
    expect(out.revenue7).toBe(0);
    expect(out.revenue19).toBe(0);
    expect(out.totalTax).toBe(0);
    const [, params] = query.mock.calls[0];
    expect(params).toEqual(['mentolder', 2026, 4, 6]);
  });
});
