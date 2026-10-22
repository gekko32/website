// Rechnungswesen Stufe 4, T13/T14: Klient ohne E-Mail (K61–K64), Versand ohne E-Mail (K58–K60).
import { describe, expect, it } from 'vitest';
import { platzhalterEmail, hatEchteEmail, anzeigeEmail, versandwege, pruefeVersandweg } from './billing-versand';

describe('Klient ohne E-Mail (AE9)', () => {
  it('Platzhalter ist eindeutig, nie zustellbar und als solcher erkennbar', () => {
    const a = platzhalterEmail(); const b = platzhalterEmail();
    expect(a).toMatch(/^ohne-email-[0-9a-f]{12}@mentolder\.invalid$/);
    expect(a).not.toBe(b);
    expect(hatEchteEmail(a)).toBe(false);
  });
  it('echte Adressen bleiben echt, leere und Platzhalter nicht', () => {
    expect(hatEchteEmail('erika@example.org')).toBe(true);
    expect(hatEchteEmail('')).toBe(false);
    expect(hatEchteEmail(null)).toBe(false);
    expect(hatEchteEmail('irgendwas@foo.invalid')).toBe(false);
  });
  it('Anzeige: „keine E-Mail“ statt Platzhalter', () => {
    expect(anzeigeEmail(platzhalterEmail())).toBe('keine E-Mail');
    expect(anzeigeEmail('a@b.de')).toBe('a@b.de');
  });
});

describe('Versandweg (K58, K59)', () => {
  it('mit E-Mail: E-Mail oder Post; ohne: nur Post', () => {
    expect(versandwege('a@b.de')).toEqual(['email', 'post']);
    expect(versandwege(platzhalterEmail())).toEqual(['post']);
  });
  it('prüft die Wahl', () => {
    expect(pruefeVersandweg(undefined, 'a@b.de')).toEqual({ weg: 'email', fehler: null });
    expect(pruefeVersandweg(undefined, platzhalterEmail())).toEqual({ weg: 'post', fehler: null });
    expect(pruefeVersandweg('post', 'a@b.de')).toEqual({ weg: 'post', fehler: null });
    expect(pruefeVersandweg('email', platzhalterEmail()).fehler).toMatch(/keine E-Mail-Adresse/);
    expect(pruefeVersandweg('fax', 'a@b.de').fehler).toMatch(/E-Mail oder Post/);
  });
});
