// SPEZ-NEUER-AUFTRITT K199–K213: Inhaltsbereiche, Geschichten-Text, Speicher-Meldungen, Markentrennung.
import { describe, it, expect } from 'vitest';
import { AuftrittSchema, GeschichtenSchema } from '../content-schema';
import { geschichteZuHtml } from './geschichten-text';
import { bundleAuftritt, bundleGeschichten } from './content-bundle';
import { getAuftritt, getGeschichten } from './auftritt';
import { lesbarerFehler } from '../components/admin/inhalte/auftritt-speichern';

const geschichte = {
  slug: 'digitalfunk', title: 'Titel', zeit: '2001–2007', teaser: 'Kurz', order: 1, sichtbar: true, text: 'Text',
};

describe('Inhaltsbereiche auftritt und geschichten', () => {
  it('mentolder-Dateien sind gültig', () => {
    expect(bundleAuftritt('mentolder').fuerWen).toHaveLength(4);
    expect(bundleGeschichten('mentolder').length).toBeGreaterThanOrEqual(3);
  });

  it('andere Marken bekommen leere Inhalte statt eines Fehlers (K189)', () => {
    expect(bundleAuftritt('massage')).toEqual({ fuerWen: [], beispiele: [], werIchBin: [] });
    expect(bundleGeschichten('korczewski')).toEqual([]);
    expect(getGeschichten('massage')).toEqual([]);
  });

  it('ausgeblendete Geschichten und Beispiele erscheinen nicht (K200, K210)', () => {
    const alle = bundleGeschichten('mentolder');
    expect(getGeschichten('mentolder')).toHaveLength(alle.filter((g) => g.sichtbar).length);
    expect(getAuftritt('mentolder').beispiele.every((b) => b.sichtbar)).toBe(true);
  });

  it('lehnt eine Geschichte ohne Titel ab (K204)', () => {
    const r = GeschichtenSchema.safeParse([{ ...geschichte, title: '  ' }]);
    expect(r.success).toBe(false);
  });

  it('lehnt doppelte Adressen und ungültige Adressen ab', () => {
    expect(GeschichtenSchema.safeParse([geschichte, { ...geschichte }]).success).toBe(false);
    expect(GeschichtenSchema.safeParse([{ ...geschichte, slug: 'Mit Leerzeichen' }]).success).toBe(false);
  });

  it('lehnt eine Karte mit fremdem Ziel ab', () => {
    const r = AuftrittSchema.safeParse({
      fuerWen: [{ titel: 'A', zitat: 'B', beleg: 'C', href: 'https://example.com' }],
      beispiele: [], werIchBin: [],
    });
    expect(r.success).toBe(false);
  });
});

describe('geschichteZuHtml', () => {
  it('macht Absätze aus Leerzeilen und verbindet Zeilenumbrüche', () => {
    expect(geschichteZuHtml('Erste\nZeile\n\nZweiter Absatz')).toBe('<p>Erste Zeile</p>\n<p>Zweiter Absatz</p>');
  });

  it('kennt **fett** und interne Links', () => {
    expect(geschichteZuHtml('**Ausgangslage.** Siehe [hier](/geschichten/x).'))
      .toBe('<p><strong>Ausgangslage.</strong> Siehe <a href="/geschichten/x">hier</a>.</p>');
  });

  it('lässt kein HTML durch', () => {
    const html = geschichteZuHtml('<script>alert(1)</script> <b>x</b>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('lässt nur Links auf eigene Seiten oder https zu', () => {
    expect(geschichteZuHtml('[x](javascript:alert(1))')).not.toContain('<a ');
    expect(geschichteZuHtml('[x](http://a.de)')).not.toContain('<a ');
    expect(geschichteZuHtml('[x](https://a.de)')).toContain('rel="noopener"');
  });
});

describe('lesbarerFehler', () => {
  it('benennt Liste und Nummer', () => {
    expect(lesbarerFehler('beispiele.1.titel: Titel fehlt', { beispiele: 'Beispiel' })).toBe('Beispiel 2: Titel fehlt');
    expect(lesbarerFehler('0.title: Titel fehlt', { '#': 'Geschichte' })).toBe('Geschichte 1: Titel fehlt');
  });
});
