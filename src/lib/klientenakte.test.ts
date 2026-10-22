import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('./website-db', () => ({ pool: { query: (...a: unknown[]) => query(...a) } }));
vi.mock('./customer-crm-db', () => ({ ensureCustomerCrmSchema: vi.fn().mockResolvedValue(undefined) }));

import {
  pruefeKlient, rechnungsempfaenger, createKlient, updateKlient, getKlient, verknuepfeRechnungskunde,
} from './klientenakte';

beforeEach(() => { query.mockReset(); query.mockResolvedValue({ rows: [] }); });

const basis = {
  name: 'Erika Muster', email: 'Erika@Example.de', address: 'Weg 1', postal_code: '12345', city: 'Ort',
  rechnung_an: 'person' as const, rechnung_firma: null, rechnung_firma_adresse: null,
  rechnung_firma_plz: null, rechnung_firma_ort: null, rechnung_email: null, rechnung_ust_id: null,
};

describe('pruefeKlient', () => {
  it('verlangt Name und gültige E-Mail, normalisiert die E-Mail', () => {
    expect(() => pruefeKlient({ name: ' ', email: 'a@b.de' })).toThrow(/Namen/);
    expect(() => pruefeKlient({ name: 'X', email: 'kaputt' })).toThrow(/E-Mail/);
    expect(pruefeKlient({ name: ' X ', email: ' A@B.DE ' })).toMatchObject({ name: 'X', email: 'a@b.de', rechnung_an: 'person' });
  });
  it('macht leere Felder zu null', () => {
    expect(pruefeKlient({ name: 'X', email: 'a@b.de', phone: '  ' }).phone).toBeNull();
  });
  it('verlangt bei „Rechnung an Firma“ einen Firmennamen', () => {
    expect(() => pruefeKlient({ name: 'X', email: 'a@b.de', rechnung_an: 'firma' })).toThrow(/Firmennamen/);
  });
  it('prüft eine abweichende Rechnungs-E-Mail', () => {
    expect(() => pruefeKlient({ name: 'X', email: 'a@b.de', rechnung_email: 'nix' })).toThrow(/Rechnungs-E-Mail/);
  });
});

describe('rechnungsempfaenger', () => {
  it('Person: Anschrift und E-Mail der Person', () => {
    expect(rechnungsempfaenger(basis)).toEqual({
      name: 'Erika Muster', email: 'Erika@Example.de', company: null,
      addressLine1: 'Weg 1', postalCode: '12345', city: 'Ort', vatNumber: null,
    });
  });
  it('Firma: Firmenanschrift, USt-IdNr. und abweichende Rechnungs-E-Mail', () => {
    const e = rechnungsempfaenger({
      ...basis, rechnung_an: 'firma', rechnung_firma: 'ACME GmbH', rechnung_firma_adresse: 'Allee 2',
      rechnung_firma_plz: '54321', rechnung_firma_ort: 'Stadt', rechnung_email: 'rechnung@acme.de',
      rechnung_ust_id: 'DE123456789',
    });
    expect(e).toEqual({
      name: 'Erika Muster', email: 'rechnung@acme.de', company: 'ACME GmbH',
      addressLine1: 'Allee 2', postalCode: '54321', city: 'Stadt', vatNumber: 'DE123456789',
    });
  });
});

describe('createKlient / updateKlient', () => {
  it('legt ohne Konto an (kein keycloak_user_id) und markiert Herkunft manuell', async () => {
    query.mockImplementation(async (sql: string) =>
      /INSERT INTO customers/.test(sql) ? { rows: [{ id: 'k1', customer_number: 'M0001' }] } : { rows: [] });
    const r = await createKlient({ name: 'X', email: 'x@y.de' });
    expect(r.ok).toBe(true);
    const insert = query.mock.calls.find((c) => /INSERT INTO customers/.test(c[0] as string))!;
    // Nur die Spaltenliste vor VALUES prüfen – RETURNING liest keycloak_user_id mit aus.
    expect((insert[0] as string).split('VALUES')[0]).not.toMatch(/keycloak_user_id/);
    expect(insert[0]).toMatch(/'manuell'/);
  });
  it('meldet eine vorhandene E-Mail mit der Id der Akte', async () => {
    query.mockImplementation(async (sql: string) =>
      /SELECT id FROM customers WHERE lower\(email\)/.test(sql) ? { rows: [{ id: 'alt' }] } : { rows: [] });
    const r = await createKlient({ name: 'X', email: 'x@y.de' });
    expect(r).toEqual({ ok: false, error: 'Zu dieser E-Mail gibt es schon eine Akte.', vorhandenId: 'alt' });
  });
  it('gibt Prüffehler zurück statt zu werfen', async () => {
    expect(await createKlient({ name: '', email: 'x@y.de' })).toMatchObject({ ok: false });
    expect(await updateKlient('k1', { name: 'X', email: 'nix' })).toMatchObject({ ok: false });
  });
});

describe('getKlient / verknuepfeRechnungskunde', () => {
  it('fragt bei ungültiger Id nicht die Datenbank nach Kunden', async () => {
    expect(await getKlient('keine-uuid')).toBeNull();
    expect(query.mock.calls.some((c) => /FROM customers WHERE id/.test(c[0] as string))).toBe(false);
  });
  it('verknüpft nur, wenn noch keine andere Akte verknüpft ist', async () => {
    await verknuepfeRechnungskunde('bc1', 'k1');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/customers_id IS NULL OR customers_id = \$2/);
    expect(params).toEqual(['bc1', 'k1']);
  });
});

// Rechnungswesen Stufe 3, T10b: Abrechnungsart je Klient (K26).
describe('pruefeKlient — Abrechnungsart (Stufe 3 T10b)', () => {
  it('übernimmt „monatlich“ oder „je Sitzung“', () => {
    expect(pruefeKlient({ name: 'X', email: 'a@b.de', abrechnungsart: 'monatlich' }).abrechnungsart).toBe('monatlich');
    expect(pruefeKlient({ name: 'X', email: 'a@b.de', abrechnungsart: 'je_sitzung' }).abrechnungsart).toBe('je_sitzung');
  });
  it('ohne Angabe: null = Voreinstellung aus den Regeln', () => {
    expect(pruefeKlient({ name: 'X', email: 'a@b.de' }).abrechnungsart).toBeNull();
    expect(pruefeKlient({ name: 'X', email: 'a@b.de', abrechnungsart: '' as never }).abrechnungsart).toBeNull();
  });
  it('lehnt anderes ab', () => {
    expect(() => pruefeKlient({ name: 'X', email: 'a@b.de', abrechnungsart: 'woechentlich' as never })).toThrow(/Abrechnungsart/);
  });
  it('speichert die Abrechnungsart beim Anlegen', async () => {
    query.mockImplementation(async (sql: string) =>
      /INSERT INTO customers/.test(sql) ? { rows: [{ id: 'k1' }] } : { rows: [] });
    await createKlient({ name: 'X', email: 'x@y.de', abrechnungsart: 'monatlich' });
    const insert = query.mock.calls.find((c) => /INSERT INTO customers/.test(c[0] as string))!;
    expect(insert[0]).toMatch(/abrechnungsart/);
    expect(insert[1]).toContain('monatlich');
  });
});
