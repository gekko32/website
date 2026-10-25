// Beleg-Design (SPEZ-BELEG-DESIGN, K107–K113, 25.10.2026): Briefbild nach Geralds Word-Muster und DIN 5008
// (Form B) für alle PDF-Belege – Kopf mit grauem Titel und Logo, Anschriftfeld für Fensterumschläge, Infoblock,
// Fußzeile mit vier frei gezeichneten Symbolen, Falz- und Lochmarken, Folgeseiten mit „Seite x von y“.
import PDFDocument from 'pdfkit';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { hatEchteEmail } from './billing-versand';

type Doc = InstanceType<typeof PDFDocument>;

export const MM = 72 / 25.4;
/** A4; linker Rand 25 mm, rechter 20 mm (DIN 5008); Inhalt endet über der Fußzeile. */
export const S = { breite: 595.28, hoehe: 841.89, L: 25 * MM, R: 595.28 - 20 * MM, unten: 732, fussLinie: 746 } as const;
export const W = S.R - S.L;
export const FARBE = { titel: '#7f7f7f', text: '#1a1a1a', grau: '#595959', kopf: '#d0d0d0', summe: '#bfbfbf', linie: '#bfbfbf', symbol: '#333333' } as const;

const LOGO: Buffer | null = (() => {
  for (const p of [join(process.cwd(), 'src/assets/beleg-logo.png'), join(dirname(fileURLToPath(import.meta.url)), '../assets/beleg-logo.png')]) {
    try { if (existsSync(p)) return readFileSync(p); } catch { /* nächster */ }
  }
  return null;
})();
/** Seitenverhältnis des Logos (2047 × 579 Pixel). */
const LOGO_B = 165, LOGO_H = LOGO_B * 579 / 2047;

export interface BelegAbsender {
  name: string; address: string; postalCode: string; city: string; country: string;
  vatId: string; taxNumber: string; iban: string; bic: string; bankName: string;
  email?: string; phone?: string; website?: string;
  /** K111: „Inhaber: …“ in der Fußzeile, Ansprechpartner im Infoblock. */
  inhaber?: string;
}
export interface BelegEmpfaenger {
  name: string; company?: string; addressLine1?: string; city?: string; postalCode?: string; country: string; email: string;
}

const LAENDER: Record<string, string> = { AT: 'ÖSTERREICH', CH: 'SCHWEIZ', NL: 'NIEDERLANDE', FR: 'FRANKREICH', BE: 'BELGIEN', LU: 'LUXEMBURG', DK: 'DÄNEMARK', PL: 'POLEN', IT: 'ITALIEN', ES: 'SPANIEN', GB: 'VEREINIGTES KÖNIGREICH', US: 'USA' };

/** Neues A4-Dokument; `fertig` liefert den PDF-Puffer nach `abschliessen`. */
export function neuerBeleg(info: { Title: string; Author: string; Subject?: string }): { doc: Doc; fertig: Promise<Buffer> } {
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info });
  const chunks: Buffer[] = [];
  const fertig = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  return { doc, fertig };
}

/** K107: großer grauer Titel links, Logo rechts, kräftige Linie. */
export function zeichneKopf(doc: Doc, titel: string): void {
  doc.font('Helvetica-Bold').fontSize(30).fillColor(FARBE.titel).text(titel, S.L, 52, { width: W - LOGO_B - 10, lineBreak: false });
  if (LOGO) {
    try { doc.image(LOGO, S.R - LOGO_B, 38, { width: LOGO_B, height: LOGO_H }); } catch { /* ohne Logo weiter */ }
  } else {
    doc.font('Helvetica').fontSize(20).fillColor(FARBE.text).text('mentolder', S.R - LOGO_B, 50, { width: LOGO_B, align: 'right' });
  }
  doc.moveTo(S.L, 100).lineTo(S.R, 100).lineWidth(1.6).strokeColor(FARBE.text).stroke();
}

/** K108: Anschriftfeld DIN 5008 Form B (Fenster links, 45 mm von oben). Gibt das untere Ende zurück. */
export function zeichneAnschrift(doc: Doc, absender: BelegAbsender, e: BelegEmpfaenger): number {
  const x = S.L;
  const ruecksende = [absender.name, absender.address, [absender.postalCode, absender.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  doc.font('Helvetica').fontSize(6.5).fillColor(FARBE.grau).text(ruecksende, x, 164, { width: 80 * MM, lineBreak: false, underline: true });
  const zeilen = [
    e.company, e.name, e.addressLine1, [e.postalCode, e.city].filter(Boolean).join(' '),
    e.country && e.country !== 'DE' ? (LAENDER[e.country.toUpperCase()] ?? e.country.toUpperCase()) : null,
  ].filter((z): z is string => !!z && z.trim() !== '');
  let y = 62.7 * MM;
  doc.font('Helvetica').fontSize(10).fillColor(FARBE.text);
  for (const z of zeilen) { doc.text(z, x, y, { width: 80 * MM, lineBreak: false, ellipsis: true }); y += 12.5; }
  return y;
}

/** K109: Infoblock rechts (125 mm von links, 50 mm von oben); Beschriftung fett rechtsbündig. */
export function zeichneInfo(doc: Doc, info: [string, string][]): number {
  const lx = 118 * MM, lw = 34 * MM, vx = lx + lw + 6;
  let y = 50 * MM;
  for (const [l, v] of info) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(FARBE.text).text(`${l}:`, lx, y, { width: lw, align: 'right', lineBreak: false });
    doc.font('Helvetica').fontSize(9).fillColor(FARBE.text).text(v, vx, y, { width: S.R - vx, lineBreak: false, ellipsis: true });
    y += 13;
  }
  return y;
}

/** Infozeilen für E-Mail und Ansprechpartner (nur echte Werte). */
export function infoEmailUndAnsprechpartner(e: BelegEmpfaenger, absender: BelegAbsender): [string, string][] {
  return [
    ...(hatEchteEmail(e.email) ? [['E-Mail', e.email] as [string, string]] : []),
    ...(absender.inhaber ? [['Ansprechpartner', absender.inhaber] as [string, string]] : []),
  ];
}

// ── K111: Fußzeile mit frei gezeichneten Symbolen ──────────────────────────────

function symbolHaus(doc: Doc, cx: number, cy: number) {
  doc.moveTo(cx - 5, cy - 0.5).lineTo(cx, cy - 5.5).lineTo(cx + 5, cy - 0.5).stroke();
  doc.rect(cx - 3.6, cy - 1.2, 7.2, 6.2).stroke();
  doc.rect(cx - 1.1, cy + 1.6, 2.2, 3.4).stroke();
}
function symbolKontakt(doc: Doc, cx: number, cy: number) {
  doc.rect(cx - 5.5, cy - 3.8, 11, 7.6).stroke();
  doc.moveTo(cx - 5.5, cy - 3.8).lineTo(cx, cy + 0.6).lineTo(cx + 5.5, cy - 3.8).stroke();
}
function symbolBank(doc: Doc, cx: number, cy: number) {
  doc.moveTo(cx - 6, cy - 2).lineTo(cx, cy - 6).lineTo(cx + 6, cy - 2).closePath().stroke();
  for (const dx of [-4, 0, 4]) doc.moveTo(cx + dx, cy - 1).lineTo(cx + dx, cy + 4).stroke();
  doc.moveTo(cx - 6.5, cy + 5).lineTo(cx + 6.5, cy + 5).stroke();
}
function symbolPerson(doc: Doc, cx: number, cy: number) {
  doc.circle(cx, cy - 2.6, 2.6).stroke();
  doc.moveTo(cx - 5, cy + 5.5).bezierCurveTo(cx - 5, cy + 0.5, cx + 5, cy + 0.5, cx + 5, cy + 5.5).stroke();
}

export function zeichneFuss(doc: Doc, a: BelegAbsender): void {
  doc.moveTo(S.L, S.fussLinie).lineTo(S.R, S.fussLinie).lineWidth(1.6).strokeColor(FARBE.text).stroke();
  const spalten: { symbol: (d: Doc, x: number, y: number) => void; zeilen: string[] }[] = [
    { symbol: symbolHaus, zeilen: [a.name, a.address, [a.postalCode, a.city].filter(Boolean).join(' ')] },
    { symbol: symbolKontakt, zeilen: [a.phone ?? '', a.website ? a.website.replace(/^https?:\/\//, '').replace(/^(?!www\.)/, 'www.') : '', a.email ?? ''] },
    { symbol: symbolBank, zeilen: [a.bankName ? `Bank: ${a.bankName}` : '', a.iban ? `IBAN: ${a.iban.replace(/(.{4})/g, '$1 ').trim()}` : '', a.bic ? `BIC: ${a.bic}` : ''] },
    { symbol: symbolPerson, zeilen: [
      a.vatId ? `USt-IdNr.: ${a.vatId}` : '', a.taxNumber ? `Steuernr.: ${a.taxNumber}` : '', a.inhaber ? `Inhaber: ${a.inhaber}` : '',
    ] },
  ];
  // Bank braucht für die IBAN die breiteste Spalte.
  const anteile = [0.22, 0.24, 0.31, 0.23];
  let x0 = S.L;
  spalten.forEach((s, i) => {
    const sw = W * anteile[i];
    const cx = x0 + sw / 2, cy = S.fussLinie + 20;
    doc.lineWidth(0.8).strokeColor(FARBE.symbol).circle(cx, cy, 11).stroke();
    doc.lineWidth(0.7);
    s.symbol(doc, cx, cy);
    let y = cy + 16;
    doc.font('Helvetica').fontSize(7).fillColor(FARBE.text);
    for (const z of s.zeilen.filter(Boolean)) {
      const passend = doc.widthOfString(z) > sw - 4 ? doc.fontSize(6.3) : doc;
      passend.text(z, x0 + 2, y, { width: sw - 4, align: 'center', lineBreak: false });
      doc.fontSize(7);
      y += 9;
    }
    x0 += sw;
  });
}

/** K112: Falzmarken (105 mm, 210 mm) und Lochmarke (148,5 mm) am linken Rand. */
export function zeichneMarken(doc: Doc): void {
  doc.lineWidth(0.5).strokeColor('#8c8c8c');
  for (const [mm, l] of [[105, 10], [148.5, 14], [210, 10]] as const) doc.moveTo(0, mm * MM).lineTo(l, mm * MM).stroke();
}

/** Oberkante des Inhalts auf Folgeseiten. */
export const FOLGESEITE_Y = 118;

/** Platz prüfen; reicht er nicht, neue Seite mit Kopf (K113). Gibt die (neue) y-Position zurück. */
export function platz(doc: Doc, y: number, hoehe: number, titel: string, beiNeuerSeite?: (y: number) => number): number {
  if (y + hoehe <= S.unten) return y;
  doc.addPage({ size: 'A4', margin: 0 });
  zeichneKopf(doc, titel);
  const ny = FOLGESEITE_Y;
  return beiNeuerSeite ? beiNeuerSeite(ny) : ny;
}

/** Fußzeile, Marken und „Seite x von y“ auf jede Seite, dann Dokument schließen (K111–K113). */
export function abschliessen(doc: Doc, absender: BelegAbsender): void {
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    zeichneFuss(doc, absender);
    zeichneMarken(doc);
    if (count > 1) {
      doc.font('Helvetica').fontSize(7.5).fillColor(FARBE.grau)
        .text(`Seite ${i - start + 1} von ${count}`, S.R - 120, 104, { width: 120, align: 'right', lineBreak: false });
    }
  }
  doc.end();
}

export const euro = (n: number) => `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
export const datumDe = (iso: string) => iso.slice(0, 10).split('-').reverse().join('.');
export const mengeDe = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 3 });
