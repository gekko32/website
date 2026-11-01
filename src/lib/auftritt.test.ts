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

describe('Markengebundene Regeln (K187, K189, K193, K197)', async () => {
  const { weiterleitungFuer, kontaktAnliegen, erstgespraechMinuten } = await import('./auftritt-wege');

  it('leitet die alten mentolder-Adressen weiter', () => {
    expect(weiterleitungFuer('mentolder', '/leistungen')).toBe('/#hilfe');
    expect(weiterleitungFuer('mentolder', '/coaching')).toBe('/fuehrung-persoenlichkeit');
    expect(weiterleitungFuer('mentolder', '/beratung')).toBe('/kleine-unternehmen');
    expect(weiterleitungFuer('mentolder', '/50plus-digital')).toBe('/');
    expect(weiterleitungFuer('mentolder', '/verwaltung')).toBeNull();
  });

  it('lässt andere Marken unverändert', () => {
    for (const marke of ['korczewski', 'massage']) {
      expect(weiterleitungFuer(marke, '/leistungen')).toBeNull();
      expect(weiterleitungFuer(marke, '/coaching')).toBeNull();
      expect(kontaktAnliegen(marke)).toBeUndefined();
      expect(erstgespraechMinuten(marke)).toBe(30);
    }
  });

  it('bietet die neuen Anliegen an, ohne 50+ und Beratung', () => {
    const werte = kontaktAnliegen('mentolder')!.map((a) => a.value);
    expect(werte).toEqual(['allgemein', 'erstgespraech', 'selbststaendige-vereine', 'kleine-unternehmen', 'verwaltung', 'coaching', 'feedback']);
    expect(erstgespraechMinuten('mentolder')).toBe(45);
  });

  it('jedes Anliegen hat eine Bezeichnung in der Kontakt-API', async () => {
    const { readFileSync } = await import('node:fs');
    const api = readFileSync(new URL('../pages/api/contact.ts', import.meta.url), 'utf8');
    for (const a of kontaktAnliegen('mentolder')!) {
      const eintrag = /^[a-z]+$/.test(a.value) ? `  ${a.value}:` : `  '${a.value}':`;
      expect(api).toContain(eintrag);
    }
  });

  it('alte Bereiche sind in services.json ausgeblendet, die vier neuen sichtbar', async () => {
    const { bundleServices } = await import('./content-bundle');
    const sv = bundleServices('mentolder');
    const sichtbar = sv.filter((s) => !s.hidden).map((s) => s.slug).sort();
    expect(sichtbar).toEqual(['fuehrung-persoenlichkeit', 'kleine-unternehmen', 'selbststaendige-vereine', 'verwaltung']);
  });
});
