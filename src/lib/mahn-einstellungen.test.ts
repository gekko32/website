import { describe, it, expect, vi } from 'vitest';

vi.mock('./website-db', () => ({ getSiteSetting: vi.fn(), setSiteSetting: vi.fn() }));

import { MAHN_STANDARD, pruefeMahnEinstellungen, gebuehrFuer, fristDatum, stufenName } from './mahn-einstellungen';

const gueltig = {
  invoice_dunning_fee_1: '0', invoice_dunning_fee_2: '2,50', invoice_dunning_fee_3: '2.5',
  invoice_dunning_interest_pa: '0', invoice_dunning_frist_tage: '10', invoice_dunning_interval_days: '14',
  invoice_dunning_pause_tage: '14',
};

describe('Mahnwesen-Einstellungen (K165)', () => {
  it('Startwerte laut Entscheidung 01.11.2026', () => {
    expect(MAHN_STANDARD).toEqual({ gebuehr1: 0, gebuehr2: 2.5, gebuehr3: 2.5, zinsenProzent: 0, fristTage: 10, abstandTage: 14, pauseTage: 14 });
  });

  it('nimmt Komma und Punkt, lehnt Unsinn ab', () => {
    expect(pruefeMahnEinstellungen(gueltig).werte).toEqual(MAHN_STANDARD);
    for (const [k, v] of [['invoice_dunning_fee_2', '-1'], ['invoice_dunning_frist_tage', '0'], ['invoice_dunning_frist_tage', '2,5'],
      ['invoice_dunning_interest_pa', 'abc'], ['invoice_dunning_fee_3', ''], ['invoice_dunning_pause_tage', '0']]) {
      const r = pruefeMahnEinstellungen({ ...gueltig, [k]: v });
      expect(r.werte).toBeNull();
      expect(r.fehler[0].key).toBe(k);
    }
  });

  it('Gebühr je Stufe, Frist als Datum, Stufennamen', () => {
    expect([1, 2, 3].map((s) => gebuehrFuer(MAHN_STANDARD, s))).toEqual([0, 2.5, 2.5]);
    expect(fristDatum(MAHN_STANDARD, new Date('2026-11-01T10:00:00Z'))).toBe('2026-11-11');
    expect([1, 2, 3].map(stufenName)).toEqual(['Zahlungserinnerung', '1. Mahnung', 'Letzte Mahnung']);
  });
});
