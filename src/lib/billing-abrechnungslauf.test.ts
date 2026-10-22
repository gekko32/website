// Rechnungswesen Stufe 3, T10b: Abrechnungsart je Klient, Entwurf je Sitzung, Monatslauf (K26–K29).
import { describe, expect, it } from 'vitest';
import { wirksameAbrechnungsart, vormonat, monatsende, planeMonatslauf, planeJeSitzung } from './billing-abrechnungslauf';
import type { Posten } from './billing-posten';
import { REGEL_STANDARD } from './billing-regeln';

const posten = (teil: Partial<Posten> = {}): Posten => ({
  id: 'p1', klientId: 'k1', klientName: 'K', herkunft: 'hand', datum: '2026-11-05', leistungKey: 'c', text: 'Coaching',
  menge: 1, einheit: 'Session', einzelpreis: 150, zustand: 'offen', invoiceId: null, notiz: null, auftragId: null,
  datumBis: null, autoEntwurf: true, ...teil,
});
const firma = { id: 'f', abrechnungsart: null, rechnung_an: 'firma' as const, rechnung_firma: 'ACME' };
const privat = { id: 'p', abrechnungsart: null, rechnung_an: 'person' as const, rechnung_firma: null };

describe('Abrechnungsart je Klient (K26)', () => {
  it('ohne eigene Einstellung: Firma monatlich, Privat je Sitzung (Voreinstellung aus den Regeln)', () => {
    expect(wirksameAbrechnungsart(firma, REGEL_STANDARD)).toBe('monatlich');
    expect(wirksameAbrechnungsart(privat, REGEL_STANDARD)).toBe('je_sitzung');
  });
  it('Voreinstellung folgt den Regeln', () => {
    const umgedreht = { ...REGEL_STANDARD, abrechnungsartFirma: 'je_sitzung' as const, abrechnungsartPrivat: 'monatlich' as const };
    expect(wirksameAbrechnungsart(firma, umgedreht)).toBe('je_sitzung');
    expect(wirksameAbrechnungsart(privat, umgedreht)).toBe('monatlich');
  });
  it('eigene Einstellung je Klient geht vor', () => {
    expect(wirksameAbrechnungsart({ ...privat, abrechnungsart: 'monatlich' }, REGEL_STANDARD)).toBe('monatlich');
    expect(wirksameAbrechnungsart({ ...firma, abrechnungsart: 'je_sitzung' }, REGEL_STANDARD)).toBe('je_sitzung');
  });
  it('„Firma“ ohne Firmennamen zählt als Privat', () => {
    expect(wirksameAbrechnungsart({ ...firma, rechnung_firma: null }, REGEL_STANDARD)).toBe('je_sitzung');
  });
});

describe('Monat', () => {
  it('Vormonat in deutscher Zeit, auch über den Jahreswechsel', () => {
    expect(vormonat(new Date('2026-12-01T05:00:00Z'))).toEqual({ jahr: 2026, monat: 11 });
    expect(vormonat(new Date('2027-01-01T05:00:00Z'))).toEqual({ jahr: 2026, monat: 12 });
    // 31.12. 23:30 UTC ist in Berlin schon der 1.1.
    expect(vormonat(new Date('2026-12-31T23:30:00Z'))).toEqual({ jahr: 2026, monat: 12 });
  });
  it('Monatsende', () => {
    expect(monatsende(2026, 2)).toBe('2026-02-28');
    expect(monatsende(2028, 2)).toBe('2028-02-29');
    expect(monatsende(2026, 11)).toBe('2026-11-30');
    expect(monatsende(2026, 12)).toBe('2026-12-31');
  });
});

describe('Monatslauf planen (K28, K29)', () => {
  const art = new Map([['f', 'monatlich'], ['p', 'je_sitzung']] as const);
  const wie = (id: string) => art.get(id as 'f' | 'p') ?? 'je_sitzung';

  it('je Monatskunde genau ein Entwurf mit allen offenen Posten bis Monatsende; je-Sitzung-Kunden nicht', () => {
    const plan = planeMonatslauf([
      posten({ id: 'a', klientId: 'f', datum: '2026-10-20' }),
      posten({ id: 'b', klientId: 'f', datum: '2026-11-30' }),
      posten({ id: 'c', klientId: 'f', datum: '2026-12-01' }),
      posten({ id: 'd', klientId: 'p', datum: '2026-11-10' }),
    ], wie, '2026-11-30', new Set());
    expect(plan).toEqual([{ klientId: 'f', postenIds: ['a', 'b'] }]);
  });

  it('Posten ohne Preis, ausgenommene und schon abgerechnete bleiben draußen', () => {
    const plan = planeMonatslauf([
      posten({ id: 'a', klientId: 'f', einzelpreis: null }),
      posten({ id: 'b', klientId: 'f', zustand: 'nicht_abrechnen' }),
      posten({ id: 'c', klientId: 'f', zustand: 'auf_entwurf' }),
    ], wie, '2026-11-30', new Set());
    expect(plan).toEqual([]);
  });

  it('K29: Klienten, für die dieser Monat schon gelaufen ist, kommen nicht noch einmal', () => {
    const plan = planeMonatslauf([posten({ id: 'a', klientId: 'f' })], wie, '2026-11-30', new Set(['f']));
    expect(plan).toEqual([]);
  });
});

describe('Entwurf je Sitzung (K27)', () => {
  const wie = (id: string) => (id === 'f' ? 'monatlich' : 'je_sitzung');

  it('jeder offene Posten mit Preis eines je-Sitzung-Kunden bekommt einen eigenen Entwurf', () => {
    expect(planeJeSitzung([
      posten({ id: 'a', klientId: 'p' }), posten({ id: 'b', klientId: 'p', datum: '2026-11-06' }),
      posten({ id: 'c', klientId: 'f' }),
    ], wie)).toEqual([{ klientId: 'p', postenIds: ['a'] }, { klientId: 'p', postenIds: ['b'] }]);
  });

  it('nicht für Posten ohne Preis oder nach verworfenem Entwurf (sonst käme er beim nächsten Öffnen sofort wieder)', () => {
    expect(planeJeSitzung([
      posten({ id: 'a', klientId: 'p', einzelpreis: null }),
      posten({ id: 'b', klientId: 'p', autoEntwurf: false }),
      posten({ id: 'c', klientId: 'p', zustand: 'nicht_abrechnen' }),
    ], wie)).toEqual([]);
  });
});
