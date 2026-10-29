// Rechnungswesen Stufe 4, T15: Auftrag mit Angebot – geplante Positionen (K44–K46).
import { describe, expect, it } from 'vitest';
import { positionsZustand, postenAenderbar, postenLoeschbar, summenJeKlient, ZUSTAND_TEXT, type Posten } from './billing-posten';
import { planeMonatslauf, planeJeSitzung } from './billing-abrechnungslauf';
import { pruefeAuswahl } from './billing-entwurf';

const posten = (teil: Partial<Posten> = {}): Posten => ({
  id: 'p1', klientId: 'k1', klientName: 'K', herkunft: 'auftrag', datum: '2026-11-05', leistungKey: null, text: 'Workshop',
  menge: 1, einheit: 'Tag', einzelpreis: 800, zustand: 'geplant', invoiceId: null, notiz: null, auftragId: 'a1',
  datumBis: null, autoEntwurf: true, ...teil,
});

describe('Positionen eines Auftrags (K44, K45)', () => {
  it('mit Angebot und noch nicht beauftragt: geplant', () => {
    expect(positionsZustand({ modus: 'mit_angebot', stand: 'geplant' })).toBe('geplant');
    expect(positionsZustand({ modus: 'mit_angebot', stand: 'angeboten' })).toBe('geplant');
  });
  it('mit Angebot und beauftragt: offen', () => {
    expect(positionsZustand({ modus: 'mit_angebot', stand: 'beauftragt' })).toBe('offen');
  });
  it('K45: ohne Angebot wie bisher sofort offen', () => {
    expect(positionsZustand({ modus: 'ohne_angebot', stand: null })).toBe('offen');
  });
});

describe('Geplante Positionen sind keine offenen Posten (K44)', () => {
  it('änderbar und löschbar, Zustand heißt „in Vorbereitung (Angebot)“', () => {
    expect(postenAenderbar('geplant')).toBe(true);
    expect(postenLoeschbar('auftrag', 'geplant')).toBe(true);
    expect(ZUSTAND_TEXT.geplant).toBe('in Vorbereitung (Angebot)');
  });
  it('erscheinen nicht in der Übersicht offener Posten', () => {
    expect(summenJeKlient([posten()])).toEqual([]);
  });
  it('nicht im Monatslauf und nicht bei „je Sitzung“', () => {
    expect(planeMonatslauf([posten()], () => 'monatlich', '2026-11-30', new Set())).toEqual([]);
    expect(planeJeSitzung([posten()], () => 'je_sitzung')).toEqual([]);
  });
  it('nicht auf eine Rechnung wählbar', () => {
    expect(pruefeAuswahl([posten()], ['p1']).fehler).toMatch(/nicht offen|geplant/);
  });
});
