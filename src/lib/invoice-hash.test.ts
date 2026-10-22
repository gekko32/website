import { describe, it, expect } from 'vitest';
import { canonicalInvoiceForHash, sha256Hex, type HashableInvoice, type HashableLine } from './invoice-hash';

const inv: HashableInvoice = {
  id: 'i1', number: 'RE-2026-0001', brand: 'mentolder',
  customerId: 'c1', issueDate: '2026-04-01', dueDate: '2026-04-15',
  taxMode: 'regelbesteuerung',
  netAmount: 100, taxRate: 19, taxAmount: 19, grossAmount: 119,
};
const lines: HashableLine[] = [
  { id: 2, description: 'B', quantity: 1, unitPrice: 50, netAmount: 50 },
  { id: 1, description: 'A', quantity: 1, unitPrice: 50, netAmount: 50 },
];

describe('canonicalInvoiceForHash', () => {
  it('produces identical hash regardless of line input order', () => {
    const a = sha256Hex(canonicalInvoiceForHash(inv, lines));
    const b = sha256Hex(canonicalInvoiceForHash(inv, [...lines].reverse()));
    expect(a).toBe(b);
  });

  it('changes when an amount changes', () => {
    const a = sha256Hex(canonicalInvoiceForHash(inv, lines));
    const b = sha256Hex(canonicalInvoiceForHash({ ...inv, netAmount: 101 }, lines));
    expect(a).not.toBe(b);
  });

  it('changes when a line item changes', () => {
    const a = sha256Hex(canonicalInvoiceForHash(inv, lines));
    const mutated = [{ ...lines[0], unitPrice: 51 }, lines[1]];
    const b = sha256Hex(canonicalInvoiceForHash(inv, mutated));
    expect(a).not.toBe(b);
  });

  it('produces 64-hex-char digest', () => {
    expect(sha256Hex('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

// Rechnungswesen Stufe 3, T10a: Leistungsdatum je Position gehört zur Prüfsumme (K42).
describe('canonicalInvoiceForHash — Leistungsdatum je Position (Stufe 3 T10a)', () => {
  it('ältere Positionen ohne Datum: Prüfsumme unverändert (kein neues Feld im Text)', () => {
    const text = canonicalInvoiceForHash(inv, [{ id: 1, description: 'A', quantity: 1, unitPrice: 50, netAmount: 50 }]);
    expect(text).toContain('"lines":[{"id":1,"description":"A","quantity":1,"unitPrice":50,"netAmount":50,"unit":null}]');
    expect(text).not.toContain('leistung');
  });

  it('ein späteres Ändern des Leistungsdatums fällt in der Prüfsumme auf', () => {
    const mit = (von: string) => sha256Hex(canonicalInvoiceForHash(inv, [{ ...lines[0], leistungVon: von }]));
    expect(mit('2026-11-05')).not.toBe(mit('2026-11-06'));
    const bis = (b: string) => sha256Hex(canonicalInvoiceForHash(inv, [{ ...lines[0], leistungVon: '2026-11-05', leistungBis: b }]));
    expect(bis('2026-11-07')).not.toBe(bis('2026-11-08'));
  });
});
