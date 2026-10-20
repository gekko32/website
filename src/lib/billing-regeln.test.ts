// Rechnungswesen Stufe 3, T1: Regeln über Formularfelder (K17, K36, K39, K40).
import { describe, expect, it } from 'vitest';
import { REGEL_FELDER, REGEL_STANDARD, pruefeRegeln, ausfallBetrag, regelTokenWerte, pruefeZahlungsziel } from './billing-regeln';
import { resolveRegelTokens } from './legal-tokens';
import { getDefaultAgb } from './legal-defaults';

describe('billing-regeln: Standardwerte', () => {
  it('Startwerte aus Geralds Entscheidung vom 20.10.2026', () => {
    expect(REGEL_STANDARD).toEqual({
      ausfallFristStunden: 24,
      ausfallArt: 'prozent',
      ausfallWert: 100,
      abrechnungsartFirma: 'monatlich',
      abrechnungsartPrivat: 'je_sitzung',
    });
  });

  it('K40: jedes Feld sagt in einem Satz, wo es wirkt', () => {
    for (const feld of REGEL_FELDER) {
      expect(feld.wirktIn.length, feld.key).toBeGreaterThan(10);
      expect(feld.label.length, feld.key).toBeGreaterThan(0);
    }
  });
});

describe('billing-regeln: Eingaben prüfen (K39)', () => {
  const gut = {
    regel_ausfall_frist_stunden: '48',
    regel_ausfall_art: 'betrag',
    regel_ausfall_wert: '75,50',
    regel_abrechnungsart_firma: 'je_sitzung',
    regel_abrechnungsart_privat: 'monatlich',
  };

  it('nimmt gültige Werte an, auch mit Komma', () => {
    const r = pruefeRegeln(gut);
    expect(r.fehler).toEqual([]);
    expect(r.werte).toEqual({
      ausfallFristStunden: 48,
      ausfallArt: 'betrag',
      ausfallWert: 75.5,
      abrechnungsartFirma: 'je_sitzung',
      abrechnungsartPrivat: 'monatlich',
    });
  });

  it.each([
    ['regel_ausfall_frist_stunden', '-5'],
    ['regel_ausfall_frist_stunden', 'abc'],
    ['regel_ausfall_frist_stunden', ''],
    ['regel_ausfall_frist_stunden', '1000'],
    ['regel_ausfall_art', 'irgendwas'],
    ['regel_ausfall_wert', '-1'],
    ['regel_abrechnungsart_firma', 'woechentlich'],
    ['regel_abrechnungsart_privat', ''],
  ])('lehnt %s = "%s" ab, mit verständlicher Meldung', (key, wert) => {
    const r = pruefeRegeln({ ...gut, [key]: wert });
    expect(r.werte).toBeNull();
    expect(r.fehler.length).toBe(1);
    expect(r.fehler[0].key).toBe(key);
    expect(r.fehler[0].meldung).toMatch(/[a-zäöü]{4,}/i);
  });

  it('lehnt mehr als 100 % ab, aber nicht als fester Betrag', () => {
    expect(pruefeRegeln({ ...gut, regel_ausfall_art: 'prozent', regel_ausfall_wert: '250' }).fehler).toHaveLength(1);
    expect(pruefeRegeln({ ...gut, regel_ausfall_art: 'betrag', regel_ausfall_wert: '250' }).fehler).toHaveLength(0);
  });

  it('meldet mehrere Fehler auf einmal', () => {
    const r = pruefeRegeln({ ...gut, regel_ausfall_frist_stunden: '-1', regel_ausfall_art: 'x' });
    expect(r.fehler.map((f) => f.key)).toEqual(['regel_ausfall_frist_stunden', 'regel_ausfall_art']);
  });
});

describe('billing-regeln: Platzhalter in den AGB (T2, K37, K38)', () => {
  it('formatiert die Werte für den AGB-Text', () => {
    expect(regelTokenWerte(REGEL_STANDARD, 14)).toEqual({
      ausfallFrist: '24',
      ausfallHoehe: 'des vereinbarten Preises',
      zahlungsziel: '14',
    });
    expect(regelTokenWerte({ ...REGEL_STANDARD, ausfallWert: 50 }, 30).ausfallHoehe).toBe('von 50 % des vereinbarten Preises');
    expect(regelTokenWerte({ ...REGEL_STANDARD, ausfallArt: 'betrag', ausfallWert: 60 }, 14).ausfallHoehe).toBe('von 60,00 €');
  });

  it('Standard-AGB enthalten Platzhalter statt fester Werte', () => {
    const roh = getDefaultAgb();
    expect(roh).toContain('{{regeln.ausfallFrist}} Stunden');
    expect(roh).toContain('{{regeln.ausfallHoehe}}');
    expect(roh).toContain('{{regeln.zahlungsziel}} Tagen');
    expect(roh).not.toMatch(/\b24 Stunden\b/);
  });

  it('K37: Frist 48 h steht nach dem Einsetzen in den AGB, 24 h nirgends', () => {
    const html = resolveRegelTokens(getDefaultAgb(), regelTokenWerte({ ...REGEL_STANDARD, ausfallFristStunden: 48 }, 14));
    expect(html).toContain('bis 48 Stunden vor Beginn');
    expect(html).not.toContain('24 Stunden');
    expect(html).not.toContain('{{regeln.');
  });

  it('K38: geändertes Zahlungsziel erscheint in den AGB', () => {
    const html = resolveRegelTokens(getDefaultAgb(), regelTokenWerte(REGEL_STANDARD, 30));
    expect(html).toContain('innerhalb von 30 Tagen');
  });

  it('unbekannte Platzhalter bleiben unangetastet', () => {
    expect(resolveRegelTokens('{{regeln.gibtsnicht}}', regelTokenWerte(REGEL_STANDARD, 14))).toBe('{{regeln.gibtsnicht}}');
  });
});

describe('billing-regeln: Zahlungsziel prüfen (K39, Prüfung Runde 1)', () => {
  it.each([['14', 14], ['0', 0], [' 30 ', 30], ['365', 365]])('nimmt "%s" an', (roh, zahl) => {
    expect(pruefeZahlungsziel(roh)).toEqual({ wert: zahl, fehler: null });
  });
  it.each(['', 'abc', '-3', '2,5', '366'])('lehnt "%s" ab, mit Meldung', (roh) => {
    const r = pruefeZahlungsziel(roh);
    expect(r.wert).toBeNull();
    expect(r.fehler).toMatch(/Zahlungsziel/);
  });
});

describe('billing-regeln: Ausfallhonorar berechnen (K17)', () => {
  it('Prozent vom Leistungspreis, auf Cent gerundet', () => {
    expect(ausfallBetrag({ ...REGEL_STANDARD }, 150)).toBe(150);
    expect(ausfallBetrag({ ...REGEL_STANDARD, ausfallWert: 50 }, 150)).toBe(75);
    expect(ausfallBetrag({ ...REGEL_STANDARD, ausfallWert: 33 }, 99.99)).toBe(33);
  });

  it('fester Betrag unabhängig vom Preis', () => {
    expect(ausfallBetrag({ ...REGEL_STANDARD, ausfallArt: 'betrag', ausfallWert: 60 }, 150)).toBe(60);
  });
});
