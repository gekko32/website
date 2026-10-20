// Rechnungswesen Stufe 3, T5: Abrechnungsposten (K2, K11, K14, K16).
import { describe, expect, it } from 'vitest';
import { pruefeSitzung, summenJeKlient, postenBetrag, type Posten } from './billing-posten';
import type { Leistung } from './billing-leistungen';

const leistung = (teil: Partial<Leistung> = {}): Leistung => ({
  key: 'coaching-session', kategorieId: 'fuehrungskraefte', name: 'Coaching 90 Min.', beschreibung: '',
  preis: 150, nachVereinbarung: false, einheit: 'Session', dauerMin: 90, website: false,
  hervorheben: false, aktiv: true, sortierung: 1, ...teil,
});

const gut = { datum: '2026-10-20', leistungKey: 'coaching-session', menge: '1', preis: '', text: '', nichtAbrechnen: false };

describe('Sitzung erfassen (K11)', () => {
  it('übernimmt Name, Einheit und Preis der Leistung', () => {
    const r = pruefeSitzung(gut, leistung());
    expect(r.fehler).toEqual([]);
    expect(r.werte).toEqual({
      datum: '2026-10-20', leistungKey: 'coaching-session', text: 'Coaching 90 Min.',
      menge: 1, einheit: 'Session', einzelpreis: 150, zustand: 'offen',
    });
  });

  it('K2: der Preis wird beim Erfassen kopiert; eine spätere Preisänderung ändert den Posten nicht', () => {
    const r = pruefeSitzung(gut, leistung({ preis: 150 }));
    const posten = { ...r.werte! };
    // Preis der Leistung ändert sich danach …
    const neu = leistung({ preis: 175 });
    expect(neu.preis).toBe(175);
    // … der erfasste Posten behält 150.
    expect(posten.einzelpreis).toBe(150);
  });

  it('eigener Preis und Text gehen vor (z. B. Rabatt, genauere Beschreibung)', () => {
    const r = pruefeSitzung({ ...gut, preis: '120,50', text: 'Coaching: Gesprächsvorbereitung', menge: '1,5' }, leistung());
    expect(r.werte).toMatchObject({ einzelpreis: 120.5, text: 'Coaching: Gesprächsvorbereitung', menge: 1.5 });
  });

  it('Leistung „nach Vereinbarung“ ohne Preis: Preis muss eingetragen werden', () => {
    const nv = leistung({ preis: null, nachVereinbarung: true });
    expect(pruefeSitzung(gut, nv).fehler.map((f) => f.key)).toEqual(['preis']);
    expect(pruefeSitzung({ ...gut, preis: '200' }, nv).werte?.einzelpreis).toBe(200);
  });

  it('K14: „nicht abrechnen“ ergibt einen Posten, der nicht offen ist', () => {
    expect(pruefeSitzung({ ...gut, nichtAbrechnen: true }, leistung()).werte?.zustand).toBe('nicht_abrechnen');
  });

  it.each([
    ['datum', '2026-13-01'], ['datum', ''], ['datum', '20.10.2026'],
    ['menge', '0'], ['menge', '-1'], ['menge', 'abc'], ['menge', '10000'],
    ['preis', '-5'], ['preis', 'x'], ['text', 'x'.repeat(301)],
  ])('lehnt %s = "%s" ab', (key, wert) => {
    const r = pruefeSitzung({ ...gut, [key]: wert }, leistung());
    expect(r.werte).toBeNull();
    expect(r.fehler.map((f) => f.key)).toContain(key);
  });

  it('ohne Leistung oder mit stillgelegter Leistung abgelehnt', () => {
    expect(pruefeSitzung(gut, null).fehler.map((f) => f.key)).toEqual(['leistungKey']);
    expect(pruefeSitzung(gut, leistung({ aktiv: false })).fehler.map((f) => f.key)).toEqual(['leistungKey']);
  });
});

describe('Beträge und Übersicht (K16)', () => {
  const p = (teil: Partial<Posten>): Posten => ({
    id: 'x', klientId: 'k1', klientName: 'A', herkunft: 'hand', datum: '2026-10-01', leistungKey: null, text: 't',
    menge: 1, einheit: 'Session', einzelpreis: 100, zustand: 'offen', invoiceId: null, notiz: null, ...teil,
  });

  it('Betrag = Menge × Einzelpreis, auf Cent gerundet', () => {
    expect(postenBetrag(p({ menge: 1.5, einzelpreis: 99.99 }))).toBe(149.99);
  });

  it('zählt je Klient nur offene Posten, mit Summe', () => {
    const s = summenJeKlient([
      p({ id: '1', klientId: 'k1', klientName: 'Anna', einzelpreis: 150 }),
      p({ id: '2', klientId: 'k1', klientName: 'Anna', einzelpreis: 60, menge: 2 }),
      p({ id: '3', klientId: 'k1', klientName: 'Anna', zustand: 'nicht_abrechnen' }),
      p({ id: '4', klientId: 'k2', klientName: 'Bert', einzelpreis: 1000 }),
      p({ id: '5', klientId: 'k2', klientName: 'Bert', zustand: 'abgerechnet' }),
    ]);
    expect(s).toEqual([
      { klientId: 'k2', klientName: 'Bert', anzahl: 1, summe: 1000 },
      { klientId: 'k1', klientName: 'Anna', anzahl: 2, summe: 270 },
    ]);
  });
});
