// Rechnungswesen Stufe 3, T12: Rechnungsnummer erst beim Festschreiben (K33–K35).
import { describe, expect, it } from 'vitest';
import { entwurfsKennung, istEntwurfsKennung, datenBeimFestschreiben, zahlungsreferenz } from './billing-nummer';

describe('Entwurfskennung (K33)', () => {
  it('erkennbar als Entwurf, keine Rechnungsnummer', () => {
    const k = entwurfsKennung();
    expect(k).toMatch(/^ENTWURF-[0-9A-F]{8}$/);
    expect(istEntwurfsKennung(k)).toBe(true);
    expect(k).not.toMatch(/^RE-/);
  });
  it('jede Kennung ist eindeutig', () => {
    const viele = new Set(Array.from({ length: 500 }, entwurfsKennung));
    expect(viele.size).toBe(500);
  });
  it('ältere Entwürfe mit echter Nummer gelten nicht als Kennung', () => {
    expect(istEntwurfsKennung('RE-2026-0007')).toBe(false);
  });
});

describe('Daten beim Festschreiben (K34, Grenzfall Dezember/Januar)', () => {
  it('Rechnungsdatum ist der Tag des Festschreibens, das Zahlungsziel bleibt gleich viele Tage', () => {
    expect(datenBeimFestschreiben('2026-12-28', '2027-01-11', new Date('2027-01-04T09:00:00Z')))
      .toEqual({ issueDate: '2027-01-04', dueDate: '2027-01-18', jahr: 2027 });
  });
  it('deutsche Zeit: kurz nach Mitternacht am 1.1. zählt schon das neue Jahr', () => {
    expect(datenBeimFestschreiben('2026-12-31', '2027-01-14', new Date('2026-12-31T23:30:00Z')).jahr).toBe(2027);
  });
  it('Zahlungsziel 0 Tage bleibt 0', () => {
    expect(datenBeimFestschreiben('2026-11-01', '2026-11-01', new Date('2026-11-05T10:00:00Z')))
      .toMatchObject({ issueDate: '2026-11-05', dueDate: '2026-11-05' });
  });
});

it('Zahlungsreferenz folgt der Nummer', () => {
  expect(zahlungsreferenz('RE-2027-0001')).toBe('RG2027-0001');
});
