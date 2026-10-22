// Rechnungswesen Stufe 3, T11: Rechnung schreibt den Empfänger fest (K31, K32).
import { describe, expect, it } from 'vitest';
import { empfaengerAusKunde, empfaengerMitAkte, fehlendeAngaben, leseEmpfaenger, kaeuferName, alsKunde, type Empfaenger } from './billing-empfaenger';

const kunde = {
  id: 'bc1', brand: 'mentolder', name: 'Erika Test', email: 'erika@example.org', company: undefined,
  addressLine1: 'Alter Weg 1', postalCode: '21335', city: 'Lüneburg', landIso: 'DE', vatNumber: undefined,
};
const klient = {
  name: 'Erika Test', email: 'erika@example.org', address: 'Neuer Weg 2', postal_code: '20095', city: 'Hamburg',
  rechnung_an: 'person' as const, rechnung_firma: null, rechnung_firma_adresse: null, rechnung_firma_plz: null,
  rechnung_firma_ort: null, rechnung_email: null, rechnung_ust_id: null,
};

describe('Empfänger ermitteln', () => {
  it('ohne Akte: Daten des Rechnungskunden', () => {
    expect(empfaengerAusKunde(kunde)).toEqual({
      name: 'Erika Test', company: null, email: 'erika@example.org', addressLine1: 'Alter Weg 1',
      postalCode: '21335', city: 'Lüneburg', country: 'DE', vatNumber: null,
    });
  });

  it('K32: mit Akte gilt die heutige Anschrift aus der Akte, nicht die beim Anlegen des Entwurfs', () => {
    expect(empfaengerMitAkte(kunde, klient)).toMatchObject({ addressLine1: 'Neuer Weg 2', postalCode: '20095', city: 'Hamburg' });
  });

  it('Firma zahlt: Firma ist Empfänger, Person bleibt als z. Hd. erhalten', () => {
    const firma = { ...klient, rechnung_an: 'firma' as const, rechnung_firma: 'ACME GmbH', rechnung_firma_adresse: 'Hafen 3',
      rechnung_firma_plz: '20457', rechnung_firma_ort: 'Hamburg', rechnung_ust_id: 'DE123456789', rechnung_email: 'buch@acme.de' };
    const e = empfaengerMitAkte(kunde, firma);
    expect(e).toMatchObject({ company: 'ACME GmbH', name: 'Erika Test', addressLine1: 'Hafen 3', email: 'buch@acme.de', vatNumber: 'DE123456789' });
    expect(kaeuferName(e)).toBe('ACME GmbH');
    expect(kaeuferName({ ...e, company: null })).toBe('Erika Test');
  });
});

describe('Grenzfall: keine Rechnungsanschrift', () => {
  const voll: Empfaenger = { name: 'X', company: null, email: 'x@y.de', addressLine1: 'Weg 1', postalCode: '1', city: 'Ort', country: 'DE', vatNumber: null };
  it('vollständig: nichts fehlt', () => { expect(fehlendeAngaben(voll)).toEqual([]); });
  it('nennt, was fehlt', () => {
    expect(fehlendeAngaben({ ...voll, addressLine1: null, city: '  ' })).toEqual(['Straße und Hausnummer', 'Ort']);
    expect(fehlendeAngaben({ ...voll, postalCode: '' })).toEqual(['PLZ']);
  });
});

describe('gespeicherte Kopie lesen (K31)', () => {
  it('liest die Kopie aus der Datenbank', () => {
    const e = leseEmpfaenger({ name: 'X', company: 'Y', email: 'x@y.de', addressLine1: 'A', postalCode: '1', city: 'B', country: 'DE', vatNumber: null });
    expect(e).toMatchObject({ company: 'Y', city: 'B' });
  });
  it('keine oder kaputte Kopie (ältere Rechnung): null', () => {
    expect(leseEmpfaenger(null)).toBeNull();
    expect(leseEmpfaenger({ foo: 1 })).toBeNull();
    expect(leseEmpfaenger('kaputt')).toBeNull();
  });
  it('alsKunde: Kopie ersetzt Name und Anschrift für PDF und Mahnung', () => {
    const e = empfaengerMitAkte(kunde, klient);
    expect(alsKunde({ ...kunde, landIso: 'DE' }, e)).toMatchObject({ id: 'bc1', addressLine1: 'Neuer Weg 2', city: 'Hamburg', name: 'Erika Test' });
  });
});
