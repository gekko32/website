// Rechnungstexte unter Einstellungen (Handtest Lieferung 2, Wunsch Gerald 20.10.2026; K36, K39, K40).
import { describe, expect, it } from 'vitest';
import { RECHNUNGSTEXT_FELDER, RECHNUNGSTEXT_STANDARD, pruefeRechnungstexte } from './billing-rechnungstexte';

const gut = { ...RECHNUNGSTEXT_STANDARD };

describe('Rechnungstexte', () => {
  it('alle Texte (fünf Rechnung, vier Angebot – Stufe 4) mit Standardwert und „wirkt in …“', () => {
    expect(RECHNUNGSTEXT_FELDER.map((f) => f.key)).toEqual([
      'invoice_intro_text', 'invoice_kleinunternehmer_notice', 'invoice_outro_text',
      'invoice_email_subject', 'invoice_email_body',
      'angebot_intro_text', 'angebot_outro_text', 'angebot_email_subject', 'angebot_email_body',
    ]);
    for (const f of RECHNUNGSTEXT_FELDER) {
      expect(f.wirktIn.length, f.key).toBeGreaterThan(10);
      expect(RECHNUNGSTEXT_STANDARD[f.key].length, f.key).toBeGreaterThan(5);
    }
  });

  it('gültige Texte werden übernommen, Leerzeichen am Rand entfernt', () => {
    const r = pruefeRechnungstexte({ ...gut, invoice_outro_text: '  Danke!  ' });
    expect(r.fehler).toEqual([]);
    expect(r.werte?.invoice_outro_text).toBe('Danke!');
  });

  it('Kleinunternehmer-Hinweis darf nicht leer sein (Pflichtangabe)', () => {
    const r = pruefeRechnungstexte({ ...gut, invoice_kleinunternehmer_notice: '   ' });
    expect(r.werte).toBeNull();
    expect(r.fehler.map((f) => f.key)).toEqual(['invoice_kleinunternehmer_notice']);
  });

  it('Längen werden begrenzt', () => {
    expect(pruefeRechnungstexte({ ...gut, invoice_email_subject: 'x'.repeat(201) }).fehler.map((f) => f.key)).toEqual(['invoice_email_subject']);
    expect(pruefeRechnungstexte({ ...gut, invoice_email_body: 'x'.repeat(4001) }).fehler.map((f) => f.key)).toEqual(['invoice_email_body']);
  });

  it('leere freiwillige Texte sind erlaubt', () => {
    expect(pruefeRechnungstexte({ ...gut, invoice_outro_text: '' }).fehler).toEqual([]);
  });
});
