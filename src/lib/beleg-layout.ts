// Beleg-Design (SPEZ-BELEG-DESIGN, K107–K113, 25.10.2026): Briefbild nach Geralds Word-Muster und DIN 5008
// (Form B) für alle PDF-Belege – Kopf mit grauem Titel und Logo, Anschriftfeld für Fensterumschläge, Infoblock,
// Fußzeile mit vier frei gezeichneten Symbolen, Falz- und Lochmarken, Folgeseiten mit „Seite x von y“.
// Prüfung B1–B4, B6, B7: Texte werden selbst umbrochen (auch über Seiten), einzeilige Werte eingepasst statt
// umbrochen, Zeichen außerhalb der Standardschrift ersetzt.
import PDFDocument from 'pdfkit';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { hatEchteEmail } from './billing-versand';

type Doc = InstanceType<typeof PDFDocument>;
type Schrift = 'Helvetica' | 'Helvetica-Bold';

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

// ── Zeichen (Prüfung B4) ──────────────────────────────────────────────────────
// Die PDF-Standardschriften kennen nur WinAnsi (Westeuropa). Andere Zeichen würden den Rest der Zeile zerstören.
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const ERSATZ: Record<string, string> = { 'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'ı': 'i', 'ħ': 'h', 'Ħ': 'H', 'ŧ': 't', 'Ŧ': 'T', '≈': '~', '−': '-', '‐': '-', '‑': '-', ' ': ' ', ' ': ' ', ' ': ' ' };
export function pdfText(s: string | null | undefined): string {
  let r = '';
  for (const z of String(s ?? '')) {
    const c = z.codePointAt(0)!;
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.has(z) || z === '\n') { r += z; continue; }
    if (ERSATZ[z] !== undefined) { r += ERSATZ[z]; continue; }
    const ohne = z.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (ohne.length > 0 && [...ohne].every((y) => { const k = y.codePointAt(0)!; return k >= 0x20 && k <= 0xff; })) { r += ohne; continue; }
    if (c === 0x09) r += ' ';
    // sonst (Emoji, Schriftzeichen ohne Entsprechung): weglassen
  }
  return r;
}

/** Text in Zeilen der Breite `breite` zerlegen (aktuelle Schrift). Überlange Wörter werden getrennt. */
export function zeilen(doc: Doc, text: string, breite: number): string[] {
  const aus: string[] = [];
  for (const absatz of pdfText(text).split('\n')) {
    let zeile = '';
    for (const wort of absatz.split(/ +/)) {
      const probe = zeile ? `${zeile} ${wort}` : wort;
      if (doc.widthOfString(probe) <= breite) { zeile = probe; continue; }
      if (zeile) aus.push(zeile);
      let rest = wort;
      while (doc.widthOfString(rest) > breite && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && doc.widthOfString(rest.slice(0, n)) > breite) n--;
        aus.push(rest.slice(0, n)); rest = rest.slice(n);
      }
      zeile = rest;
    }
    aus.push(zeile);
  }
  return aus;
}

/** Einzeiliger Wert: Schrift bis `min` verkleinern, notfalls mit „…“ kürzen – nie umbrechen (Prüfung B2). */
export function einzeilig(
  doc: Doc, text: string, x: number, y: number, breite: number,
  o: { schrift?: Schrift; groesse?: number; min?: number; ausrichtung?: 'left' | 'right' | 'center'; farbe?: string; unterstrichen?: boolean } = {},
): void {
  let t = pdfText(text).replace(/\n/g, ' ');
  let g = o.groesse ?? 10;
  doc.font(o.schrift ?? 'Helvetica').fontSize(g);
  while (doc.widthOfString(t) > breite && g > (o.min ?? 6.5)) { g -= 0.25; doc.fontSize(g); }
  if (doc.widthOfString(t) > breite) {
    while (t.length > 1 && doc.widthOfString(`${t}…`) > breite) t = t.slice(0, -1);
    t = `${t}…`;
  }
  const w = doc.widthOfString(t);
  const xx = o.ausrichtung === 'right' ? x + breite - w : o.ausrichtung === 'center' ? x + (breite - w) / 2 : x;
  doc.fillColor(o.farbe ?? FARBE.text).text(t, xx, y, { lineBreak: false, underline: o.unterstrichen ?? false });
}

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
  einzeilig(doc, titel, S.L, 52, W - LOGO_B - 10, { schrift: 'Helvetica-Bold', groesse: 30, min: 18, farbe: FARBE.titel });
  if (LOGO) {
    try { doc.image(LOGO, S.R - LOGO_B, 38, { width: LOGO_B, height: LOGO_H }); } catch { /* ohne Logo weiter */ }
  } else {
    einzeilig(doc, 'mentolder', S.R - LOGO_B, 50, LOGO_B, { groesse: 20, ausrichtung: 'right' });
  }
  doc.moveTo(S.L, 100).lineTo(S.R, 100).lineWidth(1.6).strokeColor(FARBE.text).stroke();
}

/** Ländername in Großbuchstaben (DIN 5008), Inland leer (Prüfung B6). */
export function landZeile(code: string | null | undefined): string | null {
  const c = (code ?? '').trim().toUpperCase();
  if (!c || c === 'DE') return null;
  try {
    const name = new Intl.DisplayNames(['de'], { type: 'region' }).of(c);
    if (name && name !== c) return name.toLocaleUpperCase('de-DE');
  } catch { /* unbekannter Code */ }
  return c;
}

/** K108: Anschriftfeld DIN 5008 Form B (Fenster links, 45 mm von oben). Gibt das untere Ende zurück. */
export function zeichneAnschrift(doc: Doc, absender: BelegAbsender, e: BelegEmpfaenger): number {
  const x = S.L, breite = 80 * MM;
  const ruecksende = [absender.name, absender.address, [absender.postalCode, absender.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  einzeilig(doc, ruecksende, x, 164, breite, { groesse: 6.5, min: 5, farbe: FARBE.grau, unterstrichen: true });
  const roh = [e.company, e.name, e.addressLine1, [e.postalCode, e.city].filter(Boolean).join(' '), landZeile(e.country)]
    .map((z) => (z ?? '').trim()).filter(Boolean);
  const zeilenListe = roh.filter((z, i) => roh.indexOf(z) === i); // Firma gleich Name nur einmal
  let y = 62.7 * MM;
  for (const z of zeilenListe.slice(0, 6)) { einzeilig(doc, z, x, y, breite, { groesse: 10, min: 7.5 }); y += 12.5; }
  return y;
}

/** K109: Infoblock rechts (118 mm von links, 50 mm von oben); Beschriftung fett rechtsbündig, Wert links. */
export function zeichneInfo(doc: Doc, info: [string, string][]): number {
  // Beginnt rechts neben dem Anschriftfeld (endet bei 105 mm), damit auch lange E-Mail-Adressen passen.
  const lx = 107 * MM, lw = 33 * MM, vx = lx + lw + 5;
  let y = 50 * MM;
  for (const [l, v] of info) {
    einzeilig(doc, `${l}:`, lx, y, lw, { schrift: 'Helvetica-Bold', groesse: 9, min: 7, ausrichtung: 'right' });
    einzeilig(doc, v, vx, y, S.R - vx, { groesse: 9, min: 6.5 });
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

/** Website ohne Protokoll; „www.“ nur, wenn es schon dasteht (Prüfung B7). */
export const websiteText = (w: string | undefined) => (w ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');

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

/** Spalten der Fußzeile (auch für den Word-Briefbogen). */
export function fussSpalten(a: BelegAbsender): string[][] {
  return [
    [a.name, a.address, [a.postalCode, a.city].filter(Boolean).join(' ')],
    [a.phone ?? '', websiteText(a.website), a.email ?? ''],
    [a.bankName ? `Bank: ${a.bankName}` : '', a.iban ? `IBAN: ${a.iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()}` : '', a.bic ? `BIC: ${a.bic}` : ''],
    [a.vatId ? `USt-IdNr.: ${a.vatId}` : '', a.taxNumber ? `Steuernr.: ${a.taxNumber}` : '', a.inhaber ? `Inhaber: ${a.inhaber}` : ''],
  ].map((s) => s.filter(Boolean));
}
export const FUSS_ANTEILE = [0.22, 0.24, 0.31, 0.23];

export function zeichneFuss(doc: Doc, a: BelegAbsender): void {
  doc.moveTo(S.L, S.fussLinie).lineTo(S.R, S.fussLinie).lineWidth(1.6).strokeColor(FARBE.text).stroke();
  const symbole = [symbolHaus, symbolKontakt, symbolBank, symbolPerson];
  let x0 = S.L;
  fussSpalten(a).forEach((zeilenListe, i) => {
    const sw = W * FUSS_ANTEILE[i];
    const cx = x0 + sw / 2, cy = S.fussLinie + 20;
    doc.lineWidth(0.8).strokeColor(FARBE.symbol).circle(cx, cy, 11).stroke();
    doc.lineWidth(0.7);
    symbole[i](doc, cx, cy);
    let y = cy + 16;
    for (const z of zeilenListe) { einzeilig(doc, z, x0 + 2, y, sw - 4, { groesse: 7, min: 5.5, ausrichtung: 'center' }); y += 9; }
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

/**
 * Fließtext Zeile für Zeile setzen – geht bei Bedarf auf der nächsten Seite weiter (Prüfung B1, B11).
 * Gibt die y-Position nach dem Text zurück.
 */
export function fliesstext(
  doc: Doc, text: string, x: number, y: number, breite: number, titel: string,
  o: { schrift?: Schrift; groesse?: number; farbe?: string; zeilenhoehe?: number; beiNeuerSeite?: (y: number) => number } = {},
): number {
  const g = o.groesse ?? 10;
  const setze = () => doc.font(o.schrift ?? 'Helvetica').fontSize(g).fillColor(o.farbe ?? FARBE.text);
  setze();
  const zh = o.zeilenhoehe ?? g * 1.18;
  for (const z of zeilen(doc, text, breite)) {
    const ny = platz(doc, y, zh, titel, o.beiNeuerSeite);
    if (ny !== y) setze();
    y = ny;
    doc.text(z, x, y, { lineBreak: false });
    y += zh;
  }
  return y;
}

/** Fußzeile, Marken und „Seite x von y“ auf jede Seite, dann Dokument schließen (K111–K113). */
export function abschliessen(doc: Doc, absender: BelegAbsender): void {
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    zeichneFuss(doc, absender);
    zeichneMarken(doc);
    if (count > 1) einzeilig(doc, `Seite ${i - start + 1} von ${count}`, S.R - 120, 104, 120, { groesse: 7.5, farbe: FARBE.grau, ausrichtung: 'right' });
  }
  doc.end();
}

export const euro = (n: number) => `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
export const datumDe = (iso: string) => iso.slice(0, 10).split('-').reverse().join('.');
export const mengeDe = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 3 });
