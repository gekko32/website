// Rechnungswesen Stufe 3, T1b: Absenderdaten aus einer Quelle, USt-IdNr. und
// Steuernummer getrennt (K36, K36a, K39).
import { describe, expect, it } from 'vitest';
import { absenderAus, ustIdGueltig, normalisiereUstId, pruefeSteuerangaben, steuerangabeFuerRechnung } from './billing-absender';

const einstellungen = {
  invoice_sender_name: 'Gerald Korczewski',
  invoice_sender_street: 'Ludwig-Erhard-Str. 18',
  invoice_sender_city: '20459 Hamburg',
  invoice_sender_phone: '+49 151 000000',
  invoice_bank_iban: 'DE02 1203 0000 0000 2020 51',
  invoice_bank_bic: 'BYLADEM1001',
  invoice_bank_name: 'Testbank',
  invoice_vat_id: 'DE 123 456 789',
  invoice_tax_number: '12/345/67890',
};

describe('USt-IdNr. prüfen (K36a)', () => {
  it.each([
    ['DE123456789', true],
    ['de 123 456 789', true],
    ['12/345/67890', false],
    ['DE12345678', false],
    ['ATU12345678', false],
    ['', false],
  ])('%s → %s', (roh, gueltig) => {
    expect(ustIdGueltig(roh)).toBe(gueltig);
  });

  it('normalisiert Leerzeichen und Kleinschreibung', () => {
    expect(normalisiereUstId(' de 123 456 789 ')).toBe('DE123456789');
  });
});

describe('Absender aus den Einstellungen (K36)', () => {
  it('liest alle Felder, trennt PLZ und Ort', () => {
    const a = absenderAus(einstellungen, {});
    expect(a).toMatchObject({
      name: 'Gerald Korczewski',
      address: 'Ludwig-Erhard-Str. 18',
      postalCode: '20459',
      city: 'Hamburg',
      country: 'DE',
      vatId: 'DE123456789',
      taxNumber: '12/345/67890',
      iban: 'DE02 1203 0000 0000 2020 51',
      bic: 'BYLADEM1001',
      bankName: 'Testbank',
      phone: '+49 151 000000',
    });
  });

  it('Einstellungen gehen den Server-Variablen vor, Variablen sind nur Rückfall', () => {
    const env = { SELLER_NAME: 'Env Name', SELLER_ADDRESS: 'Env-Str. 1', SELLER_POSTAL_CODE: '11111', SELLER_CITY: 'Envstadt', SELLER_TAX_NUMBER: '99/999/99999' };
    expect(absenderAus(einstellungen, env).name).toBe('Gerald Korczewski');
    const leer = absenderAus({}, env);
    expect(leer).toMatchObject({ name: 'Env Name', address: 'Env-Str. 1', postalCode: '11111', city: 'Envstadt', taxNumber: '99/999/99999' });
  });

  it('eine Steuernummer im USt-IdNr.-Feld wird nie als USt-IdNr. ausgegeben, sondern als Steuernummer', () => {
    const a = absenderAus({ ...einstellungen, invoice_vat_id: '33/111/22222', invoice_tax_number: '' }, {});
    expect(a.vatId).toBe('');
    expect(a.taxNumber).toBe('33/111/22222');
  });

  it('Ort ohne PLZ bleibt als Ort stehen', () => {
    expect(absenderAus({ ...einstellungen, invoice_sender_city: 'Hamburg' }, {})).toMatchObject({ postalCode: '', city: 'Hamburg' });
  });
});

describe('Steuerangabe auf der Rechnung (§ 14 Abs. 4 Nr. 2 UStG)', () => {
  it('USt-IdNr. vor Steuernummer, sonst Steuernummer, sonst nichts', () => {
    expect(steuerangabeFuerRechnung({ vatId: 'DE123456789', taxNumber: '12/345/67890' })).toEqual({ label: 'USt-IdNr.', wert: 'DE123456789' });
    expect(steuerangabeFuerRechnung({ vatId: '', taxNumber: '12/345/67890' })).toEqual({ label: 'Steuernummer', wert: '12/345/67890' });
    expect(steuerangabeFuerRechnung({ vatId: '', taxNumber: '' })).toBeNull();
  });
});

describe('Steuerangaben beim Speichern prüfen (K39)', () => {
  it('leere USt-IdNr. ist erlaubt (noch nicht erteilt)', () => {
    expect(pruefeSteuerangaben('', '12/345/67890')).toEqual([]);
  });
  it('gültige USt-IdNr. ist erlaubt', () => {
    expect(pruefeSteuerangaben('DE 123456789', '')).toEqual([]);
  });
  it('Steuernummer im USt-IdNr.-Feld wird abgelehnt, mit Hinweis', () => {
    const f = pruefeSteuerangaben('12/345/67890', '');
    expect(f).toHaveLength(1);
    expect(f[0].key).toBe('invoice_vat_id');
    expect(f[0].meldung).toMatch(/Steuernummer/);
  });
});
