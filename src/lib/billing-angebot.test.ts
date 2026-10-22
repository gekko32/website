// Rechnungswesen Stufe 4, T16: Angebot aus einem Auftrag (K47–K51, K55, K70).
import { describe, expect, it } from 'vitest';
import { fassungsNummer, angebotStand, pruefeGueltigBis, gueltigBisVorschlag, ANGEBOT_STAND_TEXT } from './billing-angebot';
import { pruefeRegeln, REGEL_STANDARD } from './billing-regeln';
import { RECHNUNGSTEXT_FELDER } from './billing-rechnungstexte';

describe('Angebotsnummer und Fassung (K49, K50)', () => {
  it('erste Fassung trägt die Grundnummer, weitere hängen die Fassung an', () => {
    expect(fassungsNummer('AN-2026-0001', 1)).toBe('AN-2026-0001');
    expect(fassungsNummer('AN-2026-0001', 2)).toBe('AN-2026-0001-2');
    expect(fassungsNummer('AN-2026-0001', 3)).toBe('AN-2026-0001-3');
  });
});

describe('Stand eines Angebots (K55)', () => {
  it('verschickt und „gültig bis“ vorbei → abgelaufen', () => {
    expect(angebotStand({ status: 'verschickt', gueltigBis: '2026-11-30' }, '2026-12-01')).toBe('abgelaufen');
  });
  it('am letzten Gültigkeitstag noch verschickt', () => {
    expect(angebotStand({ status: 'verschickt', gueltigBis: '2026-11-30' }, '2026-11-30')).toBe('verschickt');
  });
  it('angenommen, abgelehnt, ersetzt und Entwurf bleiben, wie sie sind', () => {
    for (const status of ['entwurf', 'angenommen', 'abgelehnt', 'ersetzt'] as const) {
      expect(angebotStand({ status, gueltigBis: '2020-01-01' }, '2026-12-01')).toBe(status);
    }
  });
  it('lesbare Texte', () => {
    expect(ANGEBOT_STAND_TEXT.abgelaufen).toBe('abgelaufen');
    expect(ANGEBOT_STAND_TEXT.verschickt).toBe('verschickt, Antwort offen');
  });
});

describe('Gültig bis (K47, K48)', () => {
  it('Vorschlag: heute plus eingestellte Tage', () => {
    expect(gueltigBisVorschlag(new Date('2026-11-10T10:00:00Z'), 30)).toBe('2026-12-10');
  });
  it('im Einzelfall änderbar: ab heute, höchstens ein Jahr', () => {
    expect(pruefeGueltigBis('2026-12-24', '2026-11-10')).toEqual({ wert: '2026-12-24', fehler: null });
    expect(pruefeGueltigBis('2026-11-09', '2026-11-10').fehler).toMatch(/nicht in der Vergangenheit/);
    expect(pruefeGueltigBis('2028-01-01', '2026-11-10').fehler).toMatch(/ein Jahr/);
    expect(pruefeGueltigBis('kaputt', '2026-11-10').fehler).toMatch(/gültiges Datum/);
  });
});

describe('Einstellungen (K70)', () => {
  const form = {
    regel_ausfall_frist_stunden: '24', regel_ausfall_art: 'prozent', regel_ausfall_wert: '100',
    regel_abrechnungsart_firma: 'monatlich', regel_abrechnungsart_privat: 'je_sitzung',
  };
  it('Startwert „gültig bis“ 30 Tage', () => {
    expect(REGEL_STANDARD.angebotGueltigTage).toBe(30);
  });
  it('Frist wird geprüft: 1 bis 365 Tage', () => {
    expect(pruefeRegeln({ ...form, regel_angebot_gueltig_tage: '45' }).werte?.angebotGueltigTage).toBe(45);
    expect(pruefeRegeln({ ...form, regel_angebot_gueltig_tage: '0' }).fehler.map((f) => f.key)).toContain('regel_angebot_gueltig_tage');
    expect(pruefeRegeln({ ...form, regel_angebot_gueltig_tage: '400' }).fehler.map((f) => f.key)).toContain('regel_angebot_gueltig_tage');
  });
  it('Angebotstexte stehen unter Rechnungstexte, mit „wo es wirkt“', () => {
    const keys = RECHNUNGSTEXT_FELDER.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['angebot_intro_text', 'angebot_outro_text', 'angebot_email_subject', 'angebot_email_body']));
    for (const f of RECHNUNGSTEXT_FELDER.filter((x) => x.key.startsWith('angebot_'))) expect(f.wirktIn).toMatch(/Angebot/);
  });
});
