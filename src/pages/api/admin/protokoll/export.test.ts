import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../lib/auth', () => ({ getSession: vi.fn(), isAdmin: vi.fn() }));
vi.mock('../../../../lib/akte-protokoll', () => ({
  leseProtokoll: vi.fn(),
  BEREICH_TEXT: { stammdaten: 'Stammdaten', posten: 'Posten', auftrag: 'Auftrag', angebot: 'Angebot', rechnung: 'Rechnung', einstellungen: 'Einstellungen' },
}));

import { csvFeld, protokollCsv } from './export';

describe('Export Änderungsprotokoll (K161)', () => {
  it('setzt Felder in Anführungszeichen, verdoppelt innere und entschärft Formeln', () => {
    expect(csvFeld('Müller; "Anna"')).toBe('"Müller; ""Anna"""');
    expect(csvFeld(null)).toBe('""');
    expect(csvFeld('=SUMME(A1)')).toBe(`"'=SUMME(A1)"`);
    expect(csvFeld({ preis: 60 })).toBe('"{""preis"":60}"');
  });

  it('beginnt mit BOM und Kopfzeile, eine Zeile je Eintrag, Bereich auf Deutsch', () => {
    const csv = protokollCsv([{
      am: '2026-10-30T15:13:31Z', wer: 'quamain@web.de', klientId: 'k', klientName: 'Testclient1', bereich: 'stammdaten',
      aktion: 'Notiz angelegt', objekt: 'Anruf', beschreibung: null, vorher: null, nachher: { weg: 'Telefon' },
    }]);
    expect(csv.startsWith('﻿"Zeitpunkt";"Wer"')).toBe(true);
    const zeilen = csv.trim().split('\r\n');
    expect(zeilen).toHaveLength(2);
    expect(zeilen[1]).toContain('"Stammdaten";"Notiz angelegt";"Anruf"');
  });
});
