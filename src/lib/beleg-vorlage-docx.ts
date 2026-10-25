// Beleg-Design (K115): Blanko-Briefbogen als Word-Datei (.docx) – in Word und LibreOffice bearbeitbar.
// Gleiches Briefbild wie die PDF-Belege (Kopf mit Titel und Logo, Anschriftfeld DIN 5008, Infoblock, Tabelle,
// Fußzeile mit den Werten aus Einstellungen → Rechnungen); Platzhalter in eckigen Klammern.
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { zip } from './zip-schreiber';
import type { BelegAbsender } from './beleg-layout';

export type VorlagenArt = 'rechnung' | 'angebot' | 'brief';

export interface VorlagenTexte { einleitung?: string; schluss?: string; kleinunternehmer?: string; kleinunternehmerAktiv: boolean; zahlungszielTage: number }

const LOGO: Buffer | null = (() => {
  for (const p of [join(process.cwd(), 'src/assets/beleg-logo.png'), join(dirname(fileURLToPath(import.meta.url)), '../assets/beleg-logo.png')]) {
    try { if (existsSync(p)) return readFileSync(p); } catch { /* nächster */ }
  }
  return null;
})();

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

interface Lauf { text: string; fett?: boolean; groesse?: number; farbe?: string; unterstrichen?: boolean }
const lauf = (l: Lauf) => `<w:r><w:rPr>${l.fett ? '<w:b/>' : ''}${l.unterstrichen ? '<w:u w:val="single"/>' : ''}${l.farbe ? `<w:color w:val="${l.farbe}"/>` : ''}<w:sz w:val="${Math.round((l.groesse ?? 10) * 2)}"/></w:rPr><w:t xml:space="preserve">${esc(l.text)}</w:t></w:r>`;

interface Absatz { laeufe: Lauf[]; ausrichtung?: 'left' | 'right' | 'center'; vor?: number; nach?: number; linieUnten?: boolean; linieOben?: boolean }
const absatz = (a: Absatz) =>
  `<w:p><w:pPr><w:spacing w:before="${a.vor ?? 0}" w:after="${a.nach ?? 0}"/>${a.ausrichtung ? `<w:jc w:val="${a.ausrichtung}"/>` : ''}${
    a.linieUnten || a.linieOben ? `<w:pBdr>${a.linieOben ? '<w:top w:val="single" w:sz="12" w:space="4" w:color="1A1A1A"/>' : ''}${a.linieUnten ? '<w:bottom w:val="single" w:sz="12" w:space="4" w:color="1A1A1A"/>' : ''}</w:pBdr>` : ''
  }</w:pPr>${a.laeufe.map(lauf).join('')}</w:p>`;
const text = (t: string, opts: Omit<Lauf, 'text'> & Omit<Absatz, 'laeufe'> = {}) => absatz({ ...opts, laeufe: [{ text: t, ...opts }] });

interface Zelle { breite: number; inhalt: string; grau?: string; ausrichtung?: 'left' | 'right' | 'center' }
const tabelle = (zeilen: Zelle[][], opts: { rahmen?: boolean; linienZwischen?: boolean } = {}) => {
  const breiten = zeilen[0].map((z) => z.breite);
  const rahmen = opts.rahmen || opts.linienZwischen
    ? `<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:right w:val="nil"/><w:bottom w:val="single" w:sz="12" w:color="1A1A1A"/><w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideV w:val="nil"/></w:tblBorders>`
    : '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>';
  return `<w:tbl><w:tblPr><w:tblW w:w="${breiten.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${rahmen}<w:tblCellMar><w:left w:w="60" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${breiten.map((b) => `<w:gridCol w:w="${b}"/>`).join('')}</w:tblGrid>${
    zeilen.map((z) => `<w:tr>${z.map((c) => `<w:tc><w:tcPr><w:tcW w:w="${c.breite}" w:type="dxa"/>${c.grau ? `<w:shd w:val="clear" w:color="auto" w:fill="${c.grau}"/>` : ''}</w:tcPr>${c.inhalt || '<w:p/>'}</w:tc>`).join('')}</w:tr>`).join('')
  }</w:tbl>`;
};

const TITEL: Record<VorlagenArt, string> = { rechnung: 'RECHNUNG', angebot: 'ANGEBOT', brief: '' };

export function briefbogenDocx(art: VorlagenArt, a: BelegAbsender, t: VorlagenTexte): Buffer {
  const titel = TITEL[art];
  const nutzbar = 11906 - 1417 - 1134; // A4 minus Rand links 25 mm, rechts 20 mm

  // ── Kopf: Titel links, Logo rechts, Linie ─────────────────────────────────
  const logoBreite = 2095500, logoHoehe = Math.round(logoBreite * 579 / 2047);
  const logo = LOGO ? `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${logoBreite}" cy="${logoHoehe}"/><wp:docPr id="1" name="Logo"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="logo.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${logoBreite}" cy="${logoHoehe}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>` : lauf({ text: 'mentolder', groesse: 20 });
  const kopf = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}>${tabelle([[
    { breite: nutzbar - 3600, inhalt: text(titel || ' ', { fett: true, groesse: 30, farbe: '7F7F7F', vor: 200 }) },
    { breite: 3600, inhalt: `<w:p><w:pPr><w:jc w:val="right"/></w:pPr>${logo}</w:p>` },
  ]])}${text(' ', { linieUnten: true, groesse: 4 })}</w:hdr>`;

  // ── Fußzeile: vier Spalten wie im PDF ─────────────────────────────────────
  const spalte = (zeilen: string[], breite: number): Zelle => ({ breite, inhalt: zeilen.filter(Boolean).map((z) => text(z, { groesse: 7, ausrichtung: 'center' })).join('') || '<w:p/>' });
  const anteile = [0.22, 0.24, 0.31, 0.23].map((x) => Math.round(nutzbar * x));
  const fuss = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}>${text(' ', { linieOben: true, groesse: 4 })}${tabelle([[
    spalte([a.name, a.address, [a.postalCode, a.city].filter(Boolean).join(' ')], anteile[0]),
    spalte([a.phone ?? '', a.website ? a.website.replace(/^https?:\/\//, '').replace(/^(?!www\.)/, 'www.') : '', a.email ?? ''], anteile[1]),
    spalte([a.bankName ? `Bank: ${a.bankName}` : '', a.iban ? `IBAN: ${a.iban.replace(/(.{4})/g, '$1 ').trim()}` : '', a.bic ? `BIC: ${a.bic}` : ''], anteile[2]),
    spalte([a.vatId ? `USt-IdNr.: ${a.vatId}` : '', a.taxNumber ? `Steuernr.: ${a.taxNumber}` : '', a.inhaber ? `Inhaber: ${a.inhaber}` : ''], anteile[3]),
  ]])}</w:ftr>`;

  // ── Inhalt ───────────────────────────────────────────────────────────────
  const ruecksende = [a.name, a.address, [a.postalCode, a.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  const info: [string, string][] = art === 'brief'
    ? [['Datum', '[TT.MM.JJJJ]'], ['Kundennr.', '[Kundennr.]'], ['Ihre E-Mail', '[E-Mail]'], ['Ansprechpartner', a.inhaber || '[Name]']]
    : [
        [`${art === 'angebot' ? 'Angebot' : 'Rechnung'} Nr.`, '[Nummer]'],
        [art === 'angebot' ? 'Datum' : 'Rechnungsdatum', '[TT.MM.JJJJ]'],
        art === 'angebot' ? ['Gültig bis', '[TT.MM.JJJJ]'] : ['Leistungsdatum', '[TT.MM.JJJJ]'],
        ...(art === 'rechnung' ? [['Fällig am', '[TT.MM.JJJJ]'] as [string, string]] : []),
        ['Kundennr.', '[Kundennr.]'], ['E-Mail', '[E-Mail]'], ['Ansprechpartner', a.inhaber || '[Name]'],
      ];
  // Infoblock wie im PDF: Beschriftung fett rechtsbündig, Wert linksbündig daneben.
  const infoAbsaetze = tabelle(info.map(([l, v]) => [
    { breite: 2200, inhalt: text(`${l}:`, { fett: true, groesse: 9, ausrichtung: 'right' }) },
    { breite: nutzbar - 4819 - 2200, inhalt: text(v, { groesse: 9 }) },
  ]));
  const anschrift = ['[Firma]', '[Ansprechpartner]', '[Straße Hausnummer]', '[PLZ Ort]'].map((z) => text(z, { groesse: 10 })).join('');

  const teile: string[] = [];
  teile.push(text(ruecksende, { groesse: 6.5, unterstrichen: true, farbe: '595959', vor: 760, nach: 120 }));
  teile.push(tabelle([[{ breite: 4819, inhalt: anschrift }, { breite: nutzbar - 4819, inhalt: infoAbsaetze + "<w:p/>" }]]));
  teile.push(text(art === 'brief' ? '[Betreff]' : `${titel} NR. [Nummer]`, { fett: true, groesse: 11, vor: 700, nach: 240 }));
  teile.push(text('Guten Tag [Name],', { nach: 160 }));
  teile.push(text(t.einleitung || '[Einleitung]', { nach: 200 }));

  if (art !== 'brief') {
    const sp = [620, nutzbar - 620 - 1300 - 1300 - 1400, 1300, 1300, 1400];
    const kopfZelle = (s: string, b: number, r = false): Zelle => ({ breite: b, grau: 'D0D0D0', inhalt: text(s, { fett: true, groesse: 9, ausrichtung: r ? 'right' : 'left' }) });
    const zelle = (s: string, b: number, r = false): Zelle => ({ breite: b, inhalt: text(s, { groesse: 9.5, ausrichtung: r ? 'right' : 'left' }) });
    const zeilen: Zelle[][] = [[kopfZelle('Pos.', sp[0]), kopfZelle('Beschreibung', sp[1]), kopfZelle('Menge', sp[2], true), kopfZelle('Einzelpreis', sp[3], true), kopfZelle('Gesamtpreis', sp[4], true)]];
    for (const n of [1, 2, 3]) {
      zeilen.push([zelle(`${n}.`, sp[0], true), { breite: sp[1], inhalt: text('[Beschreibung der Leistung]', { groesse: 9.5 }) + text('Leistung: [TT.MM.JJJJ]', { groesse: 8, farbe: '595959' }) },
        zelle('[Menge]', sp[2], true), zelle('0,00 €', sp[3], true), zelle('0,00 €', sp[4], true)]);
    }
    teile.push(tabelle(zeilen, { linienZwischen: true }));
    const rechts = 3200, links = nutzbar - rechts - 1400;
    const summe = (l: string, v: string, fett = false, grau?: string): Zelle[] => [
      { breite: links, inhalt: '<w:p/>' },
      { breite: rechts, grau, inhalt: text(l, { fett, groesse: 9.5, ausrichtung: 'right' }) },
      { breite: 1400, grau, inhalt: text(v, { fett, groesse: 9.5, ausrichtung: 'right' }) },
    ];
    teile.push(text(' ', { groesse: 4 }));
    teile.push(tabelle([
      summe('Summe Netto', '0,00 €', true),
      summe(t.kleinunternehmerAktiv ? 'USt. (§ 19 UStG)' : 'zzgl. USt. 19 %', '0,00 €'),
      summe('Gesamtsumme', '0,00 €', true, 'BFBFBF'),
    ]));
    if (t.kleinunternehmerAktiv) teile.push(text(t.kleinunternehmer || 'Kein Ausweis der Umsatzsteuer aufgrund der Anwendung der Kleinunternehmerregelung gemäß § 19 UStG.', { fett: true, groesse: 7.5, vor: 240 }));
    teile.push(text(art === 'angebot'
      ? 'Dieses Angebot ist gültig bis [TT.MM.JJJJ].'
      : `Zahlung innerhalb von ${t.zahlungszielTage} Tagen bis [TT.MM.JJJJ] ohne Abzug unter Angabe des Verwendungszwecks „[Nummer]“.`, { groesse: 7.5, vor: 80, nach: 200 }));
  } else {
    teile.push(text('[Text]', { nach: 200 }));
  }
  if (t.schluss) teile.push(text(t.schluss, { nach: 200 }));
  teile.push(text('Mit freundlichen Grüßen', { vor: 120, nach: 400 }));
  teile.push(text(a.inhaber || a.name));

  const dokument = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${teile.join('')}<w:sectPr><w:headerReference w:type="default" r:id="rIdKopf"/><w:footerReference w:type="default" r:id="rIdFuss"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="2551" w:right="1134" w:bottom="1985" w:left="1417" w:header="567" w:footer="454" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const stile = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="20"/><w:lang w:val="de-DE"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Normal"/></w:style></w:styles>`;
  const typen = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`;
  const rel = (id: string, typ: string, ziel: string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${typ}" Target="${ziel}"/>`;
  const rels = (inhalt: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${inhalt}</Relationships>`;

  return zip([
    { name: '[Content_Types].xml', inhalt: typen },
    { name: '_rels/.rels', inhalt: rels(rel('rIdDok', 'officeDocument', 'word/document.xml')) },
    { name: 'word/document.xml', inhalt: dokument },
    { name: 'word/styles.xml', inhalt: stile },
    { name: 'word/header1.xml', inhalt: kopf },
    { name: 'word/footer1.xml', inhalt: fuss },
    { name: 'word/_rels/document.xml.rels', inhalt: rels(rel('rIdStile', 'styles', 'styles.xml') + rel('rIdKopf', 'header', 'header1.xml') + rel('rIdFuss', 'footer', 'footer1.xml')) },
    { name: 'word/_rels/header1.xml.rels', inhalt: rels(LOGO ? rel('rIdLogo', 'image', 'media/logo.png') : '') },
    ...(LOGO ? [{ name: 'word/media/logo.png', inhalt: LOGO }] : []),
  ]);
}
