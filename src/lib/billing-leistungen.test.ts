// Rechnungswesen Stufe 3, T3/T4: Leistungen selbst pflegen (K1, K3, K4, K5, K6, K7).
import { describe, expect, it } from 'vitest';
import {
  pruefeLeistung, schluesselAus, startlisteAus, websiteKategorien, preisAnzeige,
  STARTLISTE_CODE_2026_10, type Leistung, type Kategorie,
} from './billing-leistungen';
import type { LeistungCategory } from '../content-schema/pages';
import { bundleLeistungen } from './content-bundle';

const websiteInhalt: LeistungCategory[] = [
  { id: 'fuehrungskraefte', title: 'Führungskräfte-Coaching', icon: '🎯', description: 'Für Führungskräfte.', services: [
    { key: 'coaching-einzel', name: 'Einzelstunde (60 Min.)', price: 'nach Vereinbarung', unit: '/ Stunde', desc: 'Intensive Einzelsession.' },
    { key: 'coaching-paket-s', name: 'Paket S — 6 Sessions', price: 'nach Vereinbarung', unit: '', desc: '6 Sessions.', highlight: true },
  ] },
  { id: 'beratung', title: 'Unternehmensberatung', icon: '🏢', services: [
    { key: 'beratung-individuell', name: 'Individuelles Angebot', price: 'nach Vereinbarung', unit: '', desc: 'Digitale Transformation.' },
  ] },
];

describe('Startliste aus beiden Listen (K4, Entscheidung 20.10.2026)', () => {
  const { kategorien, leistungen } = startlisteAus(websiteInhalt, STARTLISTE_CODE_2026_10);
  const nach = (key: string) => leistungen.find((l) => l.key === key)!;

  it('alle 12 Einträge aus dem Programmcode sind da, mit denselben Preisen, nur intern', () => {
    expect(STARTLISTE_CODE_2026_10).toHaveLength(12);
    for (const c of STARTLISTE_CODE_2026_10) {
      const l = nach(c.key);
      expect(l, c.key).toBeDefined();
      expect(l.preis).toBe(c.cents / 100);
      expect(l.website).toBe(false);
    }
    expect(nach('coaching-session')).toMatchObject({ preis: 150, einheit: 'Session' });
    expect(nach('beratung-tag')).toMatchObject({ preis: 1000, einheit: 'Tag' });
  });

  it('Website-Einträge bleiben sichtbar und zeigen „nach Vereinbarung“', () => {
    expect(nach('coaching-einzel')).toMatchObject({
      website: true, aktiv: true, preis: null, nachVereinbarung: true,
      name: 'Einzelstunde (60 Min.)', beschreibung: 'Intensive Einzelsession.', einheit: 'Stunde', kategorieId: 'fuehrungskraefte',
    });
  });

  it('alle Pakete sind stillgelegt (Website und Code)', () => {
    for (const key of ['coaching-paket-s', 'coaching-6er', '50plus-digital-5er', '50plus-digital-10er']) {
      expect(nach(key).aktiv, key).toBe(false);
    }
    expect(nach('coaching-session').aktiv).toBe(true);
  });

  it('Kategorien der Website bleiben erhalten, interne Termine bekommen eine eigene', () => {
    expect(kategorien.map((k) => k.id)).toEqual(expect.arrayContaining(['fuehrungskraefte', 'beratung', 'digital-50plus', 'termine']));
    expect(nach('erstgespraech').kategorieId).toBe('termine');
    expect(nach('50plus-digital-einzel').kategorieId).toBe('digital-50plus');
  });
});

describe('Startliste mit der echten Inhaltsdatei von mentolder', () => {
  it('Website zeigt danach dieselben Einträge wie heute, nur ohne Pakete', () => {
    const echt = bundleLeistungen('mentolder');
    const { kategorien, leistungen } = startlisteAus(echt, STARTLISTE_CODE_2026_10);
    const vorher = echt.flatMap((c) => c.services).filter((s) => !/paket/i.test(s.key)).map((s) => s.key);
    const nachher = websiteKategorien(kategorien, leistungen).flatMap((c) => c.services);
    expect(nachher.map((s) => s.key)).toEqual(vorher);
    expect(nachher.every((s) => s.price === 'nach Vereinbarung')).toBe(true);
  });

  it('alle 12 Code-Einträge haben ihren Preis; doppelte Schlüssel werden zusammengeführt', () => {
    const echt = bundleLeistungen('mentolder');
    const { leistungen } = startlisteAus(echt, STARTLISTE_CODE_2026_10);
    for (const c of STARTLISTE_CODE_2026_10) {
      expect(leistungen.find((l) => l.key === c.key)?.preis, c.key).toBe(c.cents / 100);
    }
    // 50plus-digital-einzel steht in beiden Listen: Website-Text, Preis 60 € als Vorschlag.
    expect(leistungen.find((l) => l.key === '50plus-digital-einzel')).toMatchObject({
      website: true, nachVereinbarung: true, preis: 60,
    });
    expect(new Set(leistungen.map((l) => l.key)).size).toBe(leistungen.length);
  });
});

describe('Eingaben prüfen (K5, K39)', () => {
  const gut = { name: 'Vortrag 90 Min.', kategorieId: 'beratung', preis: '450', nachVereinbarung: false, einheit: 'Vortrag', dauerMin: '90', website: false };
  const kategorien = ['beratung'];

  it('nimmt gültige Leistung an, Preis mit Komma', () => {
    const r = pruefeLeistung({ ...gut, preis: '450,50' }, kategorien);
    expect(r.fehler).toEqual([]);
    expect(r.werte).toMatchObject({ name: 'Vortrag 90 Min.', preis: 450.5, dauerMin: 90, nachVereinbarung: false });
  });

  it('0 € ist erlaubt (Erstgespräch)', () => {
    expect(pruefeLeistung({ ...gut, preis: '0' }, kategorien).fehler).toEqual([]);
  });

  it('ohne Preis abgelehnt, außer „nach Vereinbarung“', () => {
    expect(pruefeLeistung({ ...gut, preis: '' }, kategorien).fehler.map((f) => f.key)).toEqual(['preis']);
    const nv = pruefeLeistung({ ...gut, preis: '', nachVereinbarung: true }, kategorien);
    expect(nv.fehler).toEqual([]);
    expect(nv.werte?.preis).toBeNull();
  });

  it.each([
    ['preis', '-5'], ['preis', 'abc'], ['name', ''], ['name', 'x'.repeat(121)],
    ['dauerMin', '0'], ['dauerMin', '2,5'], ['kategorieId', 'gibtsnicht'],
  ])('lehnt %s = "%s" ab', (key, wert) => {
    const r = pruefeLeistung({ ...gut, [key]: wert }, kategorien);
    expect(r.werte).toBeNull();
    expect(r.fehler.map((f) => f.key)).toContain(key);
  });

  it('Dauer ist freiwillig', () => {
    expect(pruefeLeistung({ ...gut, dauerMin: '' }, kategorien).werte?.dauerMin).toBeNull();
  });
});

describe('Schlüssel aus dem Namen', () => {
  it('erzeugt einen lesbaren, eindeutigen Schlüssel', () => {
    expect(schluesselAus('Führungskräfte-Coaching: Einzel (90 Min.)', [])).toBe('fuehrungskraefte-coaching-einzel-90-min');
    expect(schluesselAus('Vortrag', ['vortrag'])).toBe('vortrag-2');
    expect(schluesselAus('Vortrag', ['vortrag', 'vortrag-2'])).toBe('vortrag-3');
  });
});

describe('Website-Ansicht (K6, K7)', () => {
  const kat: Kategorie[] = [
    { id: 'a', titel: 'A', icon: '🅰', beschreibung: 'Kat A', sortierung: 1 },
    { id: 'b', titel: 'B', icon: '🅱', beschreibung: null, sortierung: 2 },
  ];
  const basis: Omit<Leistung, 'key' | 'name'> = {
    kategorieId: 'a', beschreibung: '', preis: 150, nachVereinbarung: false, einheit: 'Session',
    dauerMin: 90, website: true, hervorheben: false, aktiv: true, sortierung: 1,
  };
  const leistungen: Leistung[] = [
    { ...basis, key: 'sichtbar', name: 'Sichtbar' },
    { ...basis, key: 'intern', name: 'Intern', website: false },
    { ...basis, key: 'still', name: 'Still', aktiv: false },
    { ...basis, key: 'nv', name: 'Nach Vereinbarung', preis: null, nachVereinbarung: true, einheit: 'Stunde', sortierung: 2 },
    { ...basis, key: 'nur-intern-b', name: 'B intern', kategorieId: 'b', website: false },
  ];

  it('zeigt nur aktive Website-Leistungen, Kategorien ohne solche fallen weg', () => {
    const w = websiteKategorien(kat, leistungen);
    expect(w.map((c) => c.id)).toEqual(['a']);
    expect(w[0].services.map((s) => s.key)).toEqual(['sichtbar', 'nv']);
  });

  it('Preis als Text, Einheit als „/ …“', () => {
    const w = websiteKategorien(kat, leistungen);
    expect(w[0].services[0]).toMatchObject({ price: '150 €', unit: '/ Session' });
    expect(w[0].services[1]).toMatchObject({ price: 'nach Vereinbarung', unit: '/ Stunde' });
  });

  it('Preisanzeige mit Cent und Tausenderpunkt', () => {
    expect(preisAnzeige({ preis: 1000, nachVereinbarung: false })).toBe('1.000 €');
    expect(preisAnzeige({ preis: 99.5, nachVereinbarung: false })).toBe('99,50 €');
    expect(preisAnzeige({ preis: 0, nachVereinbarung: false })).toBe('kostenlos');
    expect(preisAnzeige({ preis: null, nachVereinbarung: true })).toBe('nach Vereinbarung');
  });
});
