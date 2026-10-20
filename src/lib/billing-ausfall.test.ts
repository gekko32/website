// Rechnungswesen Stufe 3, T9: Ausfallhonorar (K17–K21, AE8).
import { describe, expect, it } from 'vitest';
import { ausfaelleZuPosten, absageVermerk, agbBestaetigt } from './billing-ausfall';
import { REGEL_STANDARD, type Regeln } from './billing-regeln';
import type { Leistung } from './billing-leistungen';
import type { TerminZeile } from './billing-posten';

const leistung = (teil: Partial<Leistung> = {}): Leistung => ({
  key: 'coaching-session', kategorieId: 'f', name: 'Coaching 90 Min.', beschreibung: '', preis: 150,
  nachVereinbarung: false, einheit: 'Session', dauerMin: 90, website: false, hervorheben: false,
  aktiv: true, sortierung: 1, ...teil,
});
const finde = (k: string) => (k === 'coaching-session' ? leistung() : k === 'nv' ? leistung({ key: 'nv', preis: null, nachVereinbarung: true }) : k === 'gratis' ? leistung({ key: 'gratis', preis: 0 }) : null);

// Termin am 20.10.2026 10:00 (UTC) – Frist 24 h endet am 19.10. 10:00.
const termin = (teil: Record<string, unknown> = {}, zeile: Partial<TerminZeile> = {}): TerminZeile => ({
  id: 'inbox-7', klientId: 'k1', isTestData: false,
  payload: {
    leistungKey: 'coaching-session', slotStart: '2026-10-20T10:00:00Z', slotEnd: '2026-10-20T11:30:00Z',
    freigegebenAm: '2026-10-01T09:00:00Z', state: 'storniert', cancelledAt: '2026-10-19T18:00:00Z', ...teil,
  },
  ...zeile,
});

describe('Ausfallhonorar entsteht (K18)', () => {
  it('Absage innerhalb der Frist durch den Kunden → Posten nach Regel', () => {
    expect(ausfaelleZuPosten([termin()], REGEL_STANDARD, finde)).toEqual([{
      klientId: 'k1', herkunftRef: 'inbox-7', isTestData: false, leistungKey: 'coaching-session',
      datum: '2026-10-20', text: 'Ausfallhonorar: Coaching 90 Min. am 20.10.2026', menge: 1, einheit: '',
      einzelpreis: 150, zustand: 'offen', notiz: 'Absage 16 Std. vor Termin (Frist 24 Std.)',
    }]);
  });

  it('Nicht erschienen zählt wie eine späte Absage', () => {
    const p = ausfaelleZuPosten([termin({ abgesagtVon: 'nicht_erschienen', cancelledAt: '2026-10-20T10:00:00Z' })], REGEL_STANDARD, finde);
    expect(p[0]).toMatchObject({ einzelpreis: 150, notiz: 'Nicht erschienen' });
  });

  it('Regel zum Zeitpunkt der Absage gilt, nicht die heutige (Grenzfall Regeländerung)', () => {
    const damals = { ausfallFristStunden: 24, ausfallArt: 'prozent', ausfallWert: 50 };
    const heute: Regeln = { ...REGEL_STANDARD, ausfallWert: 100 };
    expect(ausfaelleZuPosten([termin({ ausfallRegel: damals })], heute, finde)[0].einzelpreis).toBe(75);
  });

  it('fester Betrag als Regel', () => {
    const r: Regeln = { ...REGEL_STANDARD, ausfallArt: 'betrag', ausfallWert: 60 };
    expect(ausfaelleZuPosten([termin()], r, finde)[0].einzelpreis).toBe(60);
  });

  it('Leistung ohne festen Preis: Prozent ergibt „Preis fehlt“', () => {
    const p = ausfaelleZuPosten([termin({ leistungKey: 'nv' })], REGEL_STANDARD, finde);
    expect(p[0]).toMatchObject({ einzelpreis: null, notiz: 'Absage 16 Std. vor Termin (Frist 24 Std.) · Preis fehlt – bitte eintragen' });
  });
});

describe('Kein Ausfallhonorar (K19)', () => {
  it.each([
    ['rechtzeitig abgesagt', { cancelledAt: '2026-10-18T09:00:00Z' }],
    ['genau an der Frist', { cancelledAt: '2026-10-19T10:00:00Z' }],
    ['Gerald hat abgesagt', { abgesagtVon: 'gerald' }],
    ['nie freigegeben (nur Anfrage)', { freigegebenAm: undefined }],
    ['nicht abgesagt', { state: 'offen' }],
    ['ohne Leistung', { leistungKey: null }],
    ['kostenlose Leistung', { leistungKey: 'gratis' }],
    ['verschoben statt abgesagt (Umbuchung über den Kundenlink)', { abgesagtVon: 'umbuchung' }],
  ])('%s', (_n, teil) => {
    expect(ausfaelleZuPosten([termin(teil)], REGEL_STANDARD, finde)).toEqual([]);
  });

  it('ohne Akte kein Posten', () => {
    expect(ausfaelleZuPosten([termin({}, { klientId: null })], REGEL_STANDARD, finde)).toEqual([]);
  });
});

describe('Absage durch Gerald vermerken (AE8)', () => {
  const jetzt = new Date('2026-10-19T20:00:00Z');
  it('Kunde hat abgesagt: storniert, Zeitpunkt, Regel festgehalten', () => {
    expect(absageVermerk('kunde', jetzt, REGEL_STANDARD)).toEqual({
      state: 'storniert', outcome: 'storniert', cancelledAt: '2026-10-19T20:00:00.000Z', abgesagtVon: 'kunde',
      ausfallRegel: { ausfallFristStunden: 24, ausfallArt: 'prozent', ausfallWert: 100 },
    });
  });
  it('Ich habe abgesagt: nie Ausfallhonorar', () => {
    expect(absageVermerk('gerald', jetzt, REGEL_STANDARD).abgesagtVon).toBe('gerald');
  });
});

describe('AGB beim Buchen bestätigen (K21)', () => {
  it.each([[true, true], ['on', true], ['true', true], [false, false], [undefined, false], ['nein', false]])('%s → %s', (wert, ok) => {
    expect(agbBestaetigt(wert)).toBe(ok);
  });
});
