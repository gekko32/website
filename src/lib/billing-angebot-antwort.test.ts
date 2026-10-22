// Rechnungswesen Stufe 4, T17: Antwort des Kunden (K52–K55).
import { describe, expect, it } from 'vitest';
import { pruefeAntwortDatum, gemaessAngebotText } from './billing-angebot';

describe('Antwortdatum', () => {
  it('zwischen Versand und heute', () => {
    expect(pruefeAntwortDatum('2026-11-20', '2026-11-12', '2026-11-25')).toEqual({ wert: '2026-11-20', fehler: null });
    expect(pruefeAntwortDatum('2026-11-12', '2026-11-12', '2026-11-25').wert).toBe('2026-11-12');
    expect(pruefeAntwortDatum('2026-11-26', '2026-11-12', '2026-11-25').fehler).toMatch(/Zukunft/);
    expect(pruefeAntwortDatum('2026-11-11', '2026-11-12', '2026-11-25').fehler).toMatch(/vor dem Versand/);
    expect(pruefeAntwortDatum('x', '2026-11-12', '2026-11-25').fehler).toMatch(/gültiges Datum/);
  });
});

describe('K53: Rechnung nennt das Angebot', () => {
  it('ein oder mehrere Angebote, ohne Doppel', () => {
    expect(gemaessAngebotText([])).toBeNull();
    expect(gemaessAngebotText(['AN-2026-0001'])).toBe('gemäß Angebot AN-2026-0001');
    expect(gemaessAngebotText(['AN-2026-0002', 'AN-2026-0001', 'AN-2026-0002'])).toBe('gemäß Angeboten AN-2026-0001, AN-2026-0002');
  });
});
