// Rechnungswesen Stufe 3, T5: Abrechnungsposten (K2, K11, K14, K16).
import { describe, expect, it } from 'vitest';
import { pruefeSitzung, summenJeKlient, postenBetrag, termineZuPosten, pruefePreis, zeitenZuPosten, pruefeAuftragTitel, pruefePosition, postenAenderbar, type Posten, type TerminZeile, type ZeitZeile } from './billing-posten';
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

describe('Termine werden zu Posten (T6, K12, K15)', () => {
  const jetzt = new Date('2026-10-20T12:00:00Z');
  const termin = (teil: Partial<TerminZeile> = {}): TerminZeile => ({
    id: 'inbox-1', klientId: 'k1', isTestData: false,
    payload: {
      leistungKey: 'coaching-session', typeLabel: 'Termin',
      slotStart: '2026-10-19T08:00:00Z', slotEnd: '2026-10-19T09:30:00Z',
      freigegebenAm: '2026-10-10T10:00:00Z', state: 'offen',
    },
    ...teil,
  });
  const katalog = { 'coaching-session': leistung(), 'stunde': leistung({ key: 'stunde', name: 'Einzelstunde', einheit: 'Stunde', preis: 60 }),
    'erstgespraech': leistung({ key: 'erstgespraech', name: 'Erstgespräch', preis: 0, einheit: 'Einheit' }),
    'nv': leistung({ key: 'nv', name: 'Einzelstunde (60 Min.)', preis: null, nachVereinbarung: true, einheit: 'Stunde' }) } as Record<string, Leistung>;
  const finde = (k: string) => katalog[k] ?? null;

  it('freigegebener, vergangener Termin mit Leistung → ein offener Posten', () => {
    expect(termineZuPosten([termin()], jetzt, finde)).toEqual([{
      klientId: 'k1', herkunftRef: 'inbox-1', isTestData: false, leistungKey: 'coaching-session',
      datum: '2026-10-19', text: 'Coaching 90 Min.', menge: 1, einheit: 'Session', einzelpreis: 150, zustand: 'offen', notiz: null,
    }]);
  });

  it('Datum in deutscher Zeit (später Abendtermin bleibt am selben Tag)', () => {
    const p = termineZuPosten([termin({ payload: { ...termin().payload, slotStart: '2026-10-19T22:30:00Z', slotEnd: '2026-10-19T23:30:00Z' } })], jetzt, finde);
    expect(p[0].datum).toBe('2026-10-20');
  });

  it('Leistung je Stunde: Menge aus der Termindauer', () => {
    const p = termineZuPosten([termin({ payload: { ...termin().payload, leistungKey: 'stunde' } })], jetzt, finde);
    expect(p[0]).toMatchObject({ menge: 1.5, einzelpreis: 60 });
  });

  it('ohne festen Preis: Posten mit fehlendem Preis und Hinweis', () => {
    const p = termineZuPosten([termin({ payload: { ...termin().payload, leistungKey: 'nv' } })], jetzt, finde);
    expect(p[0]).toMatchObject({ einzelpreis: null, zustand: 'offen', notiz: 'Preis fehlt – bitte eintragen' });
  });

  it('kostenlose Leistung (0 €) → nicht abrechnen', () => {
    const p = termineZuPosten([termin({ payload: { ...termin().payload, leistungKey: 'erstgespraech' } })], jetzt, finde);
    expect(p[0]).toMatchObject({ zustand: 'nicht_abrechnen', einzelpreis: 0 });
  });

  it('Admin-Buchung gilt ohne Freigabe als bestätigt', () => {
    const t = termin({ payload: { ...termin().payload, freigegebenAm: undefined, adminCreated: true } });
    expect(termineZuPosten([t], jetzt, finde)).toHaveLength(1);
  });

  it.each([
    ['noch nicht vorbei', { slotEnd: '2026-10-20T12:30:00Z' }],
    ['nicht freigegeben', { freigegebenAm: undefined }],
    ['vom Kunden storniert', { state: 'storniert', cancelledAt: '2026-10-18T10:00:00Z' }],
    ['abgelehnt', { abgelehnt: true }],
    ['ohne Leistung (z. B. Rückruf)', { leistungKey: null, serviceKey: null }],
    ['unbekannte Leistung', { leistungKey: 'gibtsnicht' }],
    ['ohne Terminzeit', { slotStart: null, slotEnd: null }],
  ])('kein Posten: %s', (_name, teil) => {
    expect(termineZuPosten([termin({ payload: { ...termin().payload, ...teil } })], jetzt, finde)).toEqual([]);
  });

  it('ohne Akte (Klient unbekannt) kein Posten', () => {
    expect(termineZuPosten([termin({ klientId: null })], jetzt, finde)).toEqual([]);
  });

  it('serviceKey wird genutzt, wenn leistungKey fehlt', () => {
    const t = termin({ payload: { ...termin().payload, leistungKey: null, serviceKey: 'coaching-session' } });
    expect(termineZuPosten([t], jetzt, finde)).toHaveLength(1);
  });
});

describe('Zeiterfassung wird zu Posten (T7, K13)', () => {
  const zeit = (teil: Partial<ZeitZeile> = {}): ZeitZeile => ({
    id: 'z1', klientId: 'k1', minuten: 90, abrechenbar: true, satzCent: 8000, leistungKey: null,
    beschreibung: 'Workshop vorbereiten', projektTitel: 'Strategietag Firma X', datum: '2026-10-15',
    schonAbgerechnet: false, ...teil,
  });
  const finde = (k: string) => (k === 'stunde' ? leistung({ key: 'stunde', name: 'Beratung je Stunde', einheit: 'Stunde', preis: 120 }) : null);

  it('abrechenbare Zeit → Posten in Stunden zum erfassten Satz', () => {
    expect(zeitenZuPosten([zeit()], finde)).toEqual([{
      klientId: 'k1', herkunftRef: 'z1', leistungKey: null, datum: '2026-10-15',
      text: 'Strategietag Firma X: Workshop vorbereiten', menge: 1.5, einheit: 'Stunde',
      einzelpreis: 80, zustand: 'offen', notiz: null,
    }]);
  });

  it('ohne Satz: Preis der Leistung, sonst „Preis fehlt“', () => {
    expect(zeitenZuPosten([zeit({ satzCent: 0, leistungKey: 'stunde' })], finde)[0]).toMatchObject({ einzelpreis: 120, leistungKey: 'stunde' });
    expect(zeitenZuPosten([zeit({ satzCent: 0 })], finde)[0]).toMatchObject({ einzelpreis: null, notiz: 'Preis fehlt – bitte eintragen' });
  });

  it('Text ohne Beschreibung: Projekt', () => {
    expect(zeitenZuPosten([zeit({ beschreibung: null })], finde)[0].text).toBe('Strategietag Firma X');
  });

  it.each([
    ['nicht abrechenbar', { abrechenbar: false }],
    ['Projekt ohne Klient', { klientId: null }],
    ['schon über das alte System abgerechnet', { schonAbgerechnet: true }],
  ])('kein Posten: %s', (_n, teil) => {
    expect(zeitenZuPosten([zeit(teil)], finde)).toEqual([]);
  });
});

describe('Individuelle Aufträge (T8, K8–K10)', () => {
  it('Auftragstitel 2–120 Zeichen', () => {
    expect(pruefeAuftragTitel('Moderation Strategietag Firma X')).toEqual({ titel: 'Moderation Strategietag Firma X', fehler: null });
    expect(pruefeAuftragTitel(' x ').fehler).toMatch(/Titel/);
    expect(pruefeAuftragTitel('x'.repeat(121)).fehler).toMatch(/Titel/);
  });

  const pos = { datum: '2026-11-05', text: 'Moderation ganztägig', menge: '1', einheit: 'Tag', preis: '1.200' };

  it('eigene Position mit Text, Menge, Einheit, Preis und Leistungsdatum (K8)', () => {
    expect(pruefePosition({ ...pos, preis: '1200' })).toEqual({
      werte: { datum: '2026-11-05', text: 'Moderation ganztägig', menge: 1, einheit: 'Tag', einzelpreis: 1200 },
      fehler: [],
    });
  });

  it('Tausenderpunkt ist kein gültiger Preis (eindeutig bleiben)', () => {
    expect(pruefePosition(pos).fehler.map((f) => f.key)).toEqual(['preis']);
  });

  it.each([
    ['text', ''], ['text', 'x'.repeat(301)], ['datum', '2026-02-30'], ['menge', '0'],
    ['preis', ''], ['preis', '-1'], ['einheit', 'x'.repeat(41)],
  ])('lehnt %s = "%s" ab', (key, wert) => {
    const r = pruefePosition({ ...pos, preis: '1200', [key]: wert });
    expect(r.werte).toBeNull();
    expect(r.fehler.map((f) => f.key)).toContain(key);
  });

  it('K10: änderbar nur, solange der Posten auf keiner Rechnung steht', () => {
    expect(postenAenderbar('offen')).toBe(true);
    expect(postenAenderbar('nicht_abrechnen')).toBe(true);
    expect(postenAenderbar('auf_entwurf')).toBe(false);
    expect(postenAenderbar('abgerechnet')).toBe(false);
    expect(postenAenderbar('erlassen')).toBe(false);
  });
});

describe('Preis nachtragen (T6)', () => {
  it.each([['150', 150], ['99,5', 99.5], ['0', 0]])('nimmt "%s" an', (roh, wert) => {
    expect(pruefePreis(roh)).toBe(wert);
  });
  it.each(['', '-1', 'abc', '1,234'])('lehnt "%s" ab', (roh) => {
    expect(pruefePreis(roh)).toBeNull();
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

  it('Posten ohne Preis zählen mit, aber nicht in der Summe', () => {
    expect(postenBetrag(p({ einzelpreis: null }))).toBe(0);
    const s = summenJeKlient([p({ id: '1', einzelpreis: 100 }), p({ id: '2', einzelpreis: null })]);
    expect(s).toEqual([{ klientId: 'k1', klientName: 'A', anzahl: 2, summe: 100, ohnePreis: 1 }]);
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
      { klientId: 'k2', klientName: 'Bert', anzahl: 1, summe: 1000, ohnePreis: 0 },
      { klientId: 'k1', klientName: 'Anna', anzahl: 2, summe: 270, ohnePreis: 0 },
    ]);
  });
});
