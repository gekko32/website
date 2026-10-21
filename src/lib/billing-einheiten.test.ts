// Einheitenliste für Positionen und Sitzungen (Handtest Aufträge, 21.10.2026).
import { describe, expect, it } from 'vitest';
import { EINHEITEN_STANDARD, pruefeEinheiten, einheitenAusText } from './billing-einheiten';

describe('Einheiten', () => {
  it('Standardliste', () => {
    expect(EINHEITEN_STANDARD).toEqual(['Stunde', 'Tag', 'Halbtag', 'Session', 'Vortrag', 'Workshop', 'Pauschal', 'Stück', 'km']);
  });

  it('eine Einheit je Zeile, Leerzeilen und Doppelte fallen weg', () => {
    expect(einheitenAusText(' Stunde\n\nTag\r\nstunde\n Moderation ')).toEqual(['Stunde', 'Tag', 'Moderation']);
  });

  it('prüft Länge und Anzahl', () => {
    expect(pruefeEinheiten('Stunde\nTag').fehler).toBeNull();
    expect(pruefeEinheiten('').fehler).toMatch(/mindestens eine/);
    expect(pruefeEinheiten('x'.repeat(41)).fehler).toMatch(/40 Zeichen/);
    expect(pruefeEinheiten(Array.from({ length: 51 }, (_, i) => `E${i}`).join('\n')).fehler).toMatch(/50/);
  });
});
