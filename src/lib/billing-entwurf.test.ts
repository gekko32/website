// Rechnungswesen Stufe 3, T10a: aus offenen Posten wird ein Rechnungsentwurf
// (K22–K25, K30, K38 Rechnung).
import { describe, expect, it } from 'vitest';
import { pruefeAuswahl, rechnungszeilen, rechnungsZeitraum, leistungsdatumZeile } from './billing-entwurf';
import type { Posten } from './billing-posten';

const posten = (teil: Partial<Posten> = {}): Posten => ({
  id: '11111111-1111-4111-8111-111111111111', klientId: 'k1', klientName: 'Erika Muster', herkunft: 'hand',
  datum: '2026-11-05', leistungKey: 'coaching', text: 'Coaching 90 Min.', menge: 1, einheit: 'Session',
  einzelpreis: 150, zustand: 'offen', invoiceId: null, notiz: null, auftragId: null, datumBis: null, ...teil,
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('Auswahl prüfen (K22, K23)', () => {
  const drei = [posten({ id: id(1) }), posten({ id: id(2), datum: '2026-11-12' }), posten({ id: id(3), datum: '2026-11-19' })];

  it('K22: zwei von drei offenen Posten werden gewählt, die dritte bleibt draußen', () => {
    const r = pruefeAuswahl(drei, [id(1), id(3)]);
    expect(r.fehler).toBeNull();
    expect(r.posten.map((p) => p.id)).toEqual([id(1), id(3)]);
  });

  it('ohne Auswahl abgelehnt', () => {
    expect(pruefeAuswahl(drei, []).fehler).toMatch(/mindestens einen/);
  });

  it('K23: ein Posten auf einem Entwurf oder einer Rechnung lässt sich nicht noch einmal wählen', () => {
    const belegt = [posten({ id: id(1), zustand: 'auf_entwurf', invoiceId: 'inv-1' }), posten({ id: id(2), zustand: 'abgerechnet', invoiceId: 'inv-2' })];
    expect(pruefeAuswahl(belegt, [id(1)]).fehler).toMatch(/schon auf einer Rechnung/);
    expect(pruefeAuswahl(belegt, [id(2)]).fehler).toMatch(/schon auf einer Rechnung/);
  });

  it('ausgenommene und erlassene Posten lassen sich nicht abrechnen', () => {
    const r = pruefeAuswahl([posten({ id: id(1), zustand: 'nicht_abrechnen' }), posten({ id: id(2), zustand: 'erlassen' })], [id(1), id(2)]);
    expect(r.fehler).toMatch(/nicht offen/);
  });

  it('Posten ohne Preis („nach Vereinbarung“) erst nach Eintragen des Preises', () => {
    expect(pruefeAuswahl([posten({ id: id(1), einzelpreis: null })], [id(1)]).fehler).toMatch(/Preis/);
  });

  it('fremde oder unbekannte Posten abgelehnt (gehören nicht zu dieser Akte)', () => {
    expect(pruefeAuswahl(drei, [id(1), id(9)]).fehler).toMatch(/gehört nicht zu dieser Akte/);
  });

  it('doppelt übergebene Auswahl zählt einmal', () => {
    expect(pruefeAuswahl(drei, [id(2), id(2)]).posten.map((p) => p.id)).toEqual([id(2)]);
  });
});

describe('Positionen der Rechnung (K22: jede mit ihrem Leistungsdatum)', () => {
  it('Text, Menge, Einheit und Preis kommen aus dem Posten; Datum je Position', () => {
    const z = rechnungszeilen([posten({ id: id(1), menge: 1.5, einzelpreis: 120.5, einheit: 'Stunde' })], { person: null });
    expect(z).toEqual([{
      description: 'Coaching 90 Min.', quantity: 1.5, unitPrice: 120.5, unit: 'Stunde',
      leistungVon: '2026-11-05', leistungBis: null, postenId: id(1),
    }]);
  });

  it('Zeitraum von–bis bleibt erhalten', () => {
    const [z] = rechnungszeilen([posten({ datum: '2026-11-05', datumBis: '2026-11-07' })], { person: null });
    expect(z).toMatchObject({ leistungVon: '2026-11-05', leistungBis: '2026-11-07' });
    expect(leistungsdatumZeile(z)).toBe('Leistung: 05.–07.11.2026');
  });

  it('ein Tag: „Leistung: 05.11.2026“', () => {
    expect(leistungsdatumZeile({ leistungVon: '2026-11-05', leistungBis: null })).toBe('Leistung: 05.11.2026');
    expect(leistungsdatumZeile({})).toBeNull();
  });

  it('nach Datum geordnet; mehrere Leistungen am selben Tag bleiben getrennte Positionen', () => {
    const z = rechnungszeilen([
      posten({ id: id(1), datum: '2026-11-12', text: 'B' }),
      posten({ id: id(2), datum: '2026-11-05', text: 'Vortrag' }),
      posten({ id: id(3), datum: '2026-11-05', text: 'Analyse' }),
    ], { person: null });
    expect(z.map((x) => [x.leistungVon, x.description])).toEqual([
      ['2026-11-05', 'Vortrag'], ['2026-11-05', 'Analyse'], ['2026-11-12', 'B'],
    ]);
  });

  it('Grenzfall Firma zahlt, Person wurde gecoacht: Positionen nennen die Person', () => {
    const [z] = rechnungszeilen([posten()], { person: 'Erika Muster' });
    expect(z.description).toBe('Coaching 90 Min. · Erika Muster');
  });

  it('nennt die Person nicht doppelt, wenn sie schon im Text steht', () => {
    const [z] = rechnungszeilen([posten({ text: 'Coaching Erika Muster' })], { person: 'Erika Muster' });
    expect(z.description).toBe('Coaching Erika Muster');
  });
});

describe('Leistungszeitraum der ganzen Rechnung (Kopf)', () => {
  it('frühestes bis spätestes Datum aller Positionen', () => {
    expect(rechnungsZeitraum([
      { leistungVon: '2026-11-12', leistungBis: null },
      { leistungVon: '2026-11-03', leistungBis: '2026-11-04' },
      { leistungVon: '2026-11-20', leistungBis: '2026-11-28' },
    ])).toEqual({ start: '2026-11-03', end: '2026-11-28' });
  });

  it('nur ein Tag: kein Ende', () => {
    expect(rechnungsZeitraum([{ leistungVon: '2026-11-05', leistungBis: null }])).toEqual({ start: '2026-11-05', end: undefined });
  });

  it('Grenzfall Dezember-Sitzung, Rechnung im Januar: der Zeitraum bleibt im Dezember', () => {
    expect(rechnungsZeitraum([{ leistungVon: '2026-12-15', leistungBis: null }, { leistungVon: '2026-12-29', leistungBis: null }]))
      .toEqual({ start: '2026-12-15', end: '2026-12-29' });
  });
});
