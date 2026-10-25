// Belege als PDF: Rechnung, Gutschrift, Angebot (generateInvoicePdf) und Zahlungserinnerung/Mahnung
// (generateDunningPdf). Seit 25.10.2026 im Briefbild nach Geralds Word-Muster und DIN 5008 (beleg-layout.ts,
// SPEZ-BELEG-DESIGN K107–K116); Rechnungen bekommen weiterhin die E-Rechnung (Factur-X/XRechnung) eingebettet.
import type { Invoice } from './invoice-types';
import { embedFacturXIntoPdfA3, type FacturXLevel } from './pdf-a3-embed';
import { generateEInvoiceXml, type EInvoiceProfile } from './einvoice-profile';
import type { EInvoiceInput } from './einvoice-types';
import { leistungsdatumZeile } from './leistungszeitraum';
import {
  neuerBeleg, zeichneKopf, zeichneAnschrift, zeichneInfo, infoEmailUndAnsprechpartner, platz, abschliessen,
  S, W, FARBE, euro, datumDe, mengeDe, type BelegAbsender, type BelegEmpfaenger,
} from './beleg-layout';

export interface InvoicePdfLine {
  description: string; quantity: number; unitPrice: number; netAmount: number; unit?: string;
  /** Stufe 3 T10a: Leistungsdatum bzw. -zeitraum der Position (YYYY-MM-DD). */
  leistungVon?: string; leistungBis?: string;
}
export interface InvoicePdfCustomer extends BelegEmpfaenger {
  vatNumber?: string;
  /** K109: Kundennummer aus der Klientenakte. */
  customerNumber?: string;
}
export type InvoicePdfSeller = BelegAbsender;
export interface InvoicePdfTemplateTexts {
  title?: string;
  introText?: string;
  kleinunternehmerNotice?: string;
  outroText?: string;
}

export interface Dunning {
  id: string; invoiceId: string; brand: string; level: number;
  generatedAt: string; feeAmount: number; interestAmount: number;
  outstandingAtGeneration: number;
}

/** Anrede: bei bekannter Person persönlich, sonst allgemein. */
function anrede(c: InvoicePdfCustomer): string {
  return c.name && c.name.trim() && c.name !== c.company ? `Guten Tag ${c.name.trim()},` : 'Sehr geehrte Damen und Herren,';
}

function grussformel(doc: ReturnType<typeof neuerBeleg>['doc'], y: number, seller: InvoicePdfSeller, titel: string): number {
  y = platz(doc, y, 40, titel);
  doc.font('Helvetica').fontSize(10).fillColor(FARBE.text).text('Mit freundlichen Grüßen', S.L, y, { width: W });
  y = doc.y + 14;
  doc.text(seller.inhaber || seller.name, S.L, y, { width: W });
  return doc.y;
}

export async function generateDunningPdf(p: {
  dunning: Dunning; invoice: Invoice;
  customer: InvoicePdfCustomer; seller: InvoicePdfSeller;
}): Promise<Buffer> {
  const { dunning: d, invoice: inv, customer, seller } = p;
  const titel = d.level === 1 ? 'ZAHLUNGSERINNERUNG' : 'MAHNUNG';
  const { doc, fertig } = neuerBeleg({ Title: `Mahnung ${d.level} - ${inv.number}`, Author: seller.name });

  zeichneKopf(doc, titel);
  const aEnde = zeichneAnschrift(doc, seller, customer);
  const iEnde = zeichneInfo(doc, [
    ['Rechnung Nr.', inv.number],
    ['Rechnungsdatum', datumDe(inv.issueDate)],
    ['Fällig seit', datumDe(inv.dueDate)],
    ['Datum', datumDe(d.generatedAt)],
    ...(customer.customerNumber ? [['Kundennr.', customer.customerNumber] as [string, string]] : []),
    ...infoEmailUndAnsprechpartner(customer, seller),
  ]);

  let y = Math.max(aEnde, iEnde, 98 * MM_Y) + 10;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(FARBE.text).text(`${d.level === 1 ? 'ZAHLUNGSERINNERUNG' : `${d.level - 1}. MAHNUNG`} ZU RECHNUNG NR. ${inv.number}`, S.L, y, { width: W });
  y = doc.y + 14;
  doc.font('Helvetica').fontSize(10).fillColor(FARBE.text).text(anrede(customer), S.L, y, { width: W });
  y = doc.y + 8;
  const intro = d.level === 1
    ? `sicher haben Sie nur übersehen, dass die Rechnung Nr. ${inv.number} vom ${datumDe(inv.issueDate)} am ${datumDe(inv.dueDate)} zur Zahlung fällig war.`
    : `leider konnten wir bis heute keinen Zahlungseingang für die Rechnung Nr. ${inv.number} vom ${datumDe(inv.issueDate)} feststellen.`;
  doc.text(intro, S.L, y, { width: W });
  y = doc.y + 8;
  doc.text('Wir bitten Sie höflich, den offenen Betrag bis spätestens 7 Tage nach Erhalt dieses Schreibens zu begleichen.', S.L, y, { width: W });
  y = doc.y + 16;

  // Posten wie die Rechnungstabelle, nur Beschreibung und Betrag.
  doc.rect(S.L, y, W, 18).fill(FARBE.kopf);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(FARBE.text);
  doc.text('Posten', S.L + 6, y + 5, { width: W - 120 });
  doc.text('Betrag', S.R - 106, y + 5, { width: 100, align: 'right' });
  y += 24;
  const zeile = (label: string, wert: number) => {
    doc.font('Helvetica').fontSize(9.5).fillColor(FARBE.text).text(label, S.L + 6, y, { width: W - 120 });
    doc.text(euro(wert), S.R - 106, y, { width: 100, align: 'right' });
    y += 16;
    doc.moveTo(S.L, y - 4).lineTo(S.R, y - 4).lineWidth(0.4).strokeColor(FARBE.linie).stroke();
  };
  zeile(`Offener Betrag aus Rechnung ${inv.number}`, d.outstandingAtGeneration);
  if (d.feeAmount > 0) zeile('Mahngebühren', d.feeAmount);
  if (d.interestAmount > 0) zeile('Verzugszinsen', d.interestAmount);
  y += 2;
  const total = d.outstandingAtGeneration + d.feeAmount + d.interestAmount;
  doc.moveTo(S.L, y).lineTo(S.R, y).lineWidth(1.4).strokeColor(FARBE.text).stroke();
  doc.rect(S.R - 200, y + 2, 200, 18).fill(FARBE.summe);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(FARBE.text).text('Gesamtbetrag', S.R - 194, y + 7, { width: 90 });
  doc.text(euro(total), S.R - 106, y + 7, { width: 100, align: 'right' });
  y += 34;

  doc.font('Helvetica').fontSize(10).fillColor(FARBE.text)
    .text(`Bitte überweisen Sie den Gesamtbetrag auf das unten angegebene Konto unter Angabe des Verwendungszwecks „${inv.paymentReference ?? inv.number}“.`, S.L, y, { width: W });
  y = doc.y + 8;
  doc.text('Sollten Sie die Zahlung in der Zwischenzeit bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.', S.L, y, { width: W });
  y = doc.y + 16;
  grussformel(doc, y, seller, titel);

  abschliessen(doc, seller);
  return fertig;
}

/** 98,4 mm: Lage der Betreffzeile nach DIN 5008 Form B. */
const MM_Y = 72 / 25.4;

export async function generateInvoicePdf(p: {
  invoice: Invoice; lines: InvoicePdfLine[];
  customer: InvoicePdfCustomer; seller: InvoicePdfSeller;
  templateTexts?: InvoicePdfTemplateTexts;
  profile?: EInvoiceProfile;
  /** Stufe 4 (K49): dasselbe Briefbild als Angebot – „Gültig bis“ statt Fälligkeit, kein Zahlungsblock. */
  angebot?: { gueltigBis: string };
}): Promise<Buffer> {
  const supplyTypeForMeta = p.invoice.supplyType;
  const supplyNoticeMap: Record<string, string> = {
    eu_b2b_services: 'Die Steuerschuldnerschaft geht auf den Leistungsempfänger über (§ 13b UStG / Art. 196 MwStSystRL).',
    eu_b2b_goods:    'Steuerfreie innergemeinschaftliche Lieferung gem. § 4 Nr. 1b UStG. Gelangensbestätigung liegt vor.',
    drittland_export: 'Steuerfreie Ausfuhrlieferung gem. § 4 Nr. 1a UStG. Ausfuhrnachweis wird geführt.',
  };
  // ASCII tag stored in PDF info dict so test extraction via toString('latin1') works
  const supplyTypeTagMap: Record<string, string> = {
    eu_b2b_services: 'Reverse Charge SS.13b UStG',
    eu_b2b_goods:    'Innergemeinschaftliche Lieferung SS.4 Nr.1b UStG',
    drittland_export: 'Ausfuhrlieferung SS.4 Nr.1a UStG',
  };
  const docSubject = supplyTypeForMeta && supplyTypeTagMap[supplyTypeForMeta] ? supplyTypeTagMap[supplyTypeForMeta] : undefined;

  const { invoice: inv, lines, customer, seller, templateTexts } = p;
  const isKlein = inv.taxMode === 'kleinunternehmer';
  const kleinNote = templateTexts?.kleinunternehmerNotice ??
    'Kein Ausweis der Umsatzsteuer aufgrund der Anwendung der Kleinunternehmerregelung gemäß § 19 UStG.';
  const titel = templateTexts?.title ?? (p.angebot ? 'ANGEBOT' : inv.kind === 'gutschrift' ? 'GUTSCHRIFT' : 'RECHNUNG');
  const titelWort = titel.charAt(0) + titel.slice(1).toLowerCase();

  const { doc, fertig } = neuerBeleg({ Title: inv.number, Author: seller.name, ...(docSubject ? { Subject: docSubject } : {}) });

  // ── Seite 1: Kopf, Anschrift, Infoblock ─────────────────────────────────────
  zeichneKopf(doc, titel);
  const aEnde = zeichneAnschrift(doc, seller, customer);
  const zeitraum = inv.servicePeriodStart
    ? (inv.servicePeriodEnd ? `${datumDe(inv.servicePeriodStart)}–${datumDe(inv.servicePeriodEnd)}` : datumDe(inv.servicePeriodStart))
    : null;
  const info: [string, string][] = [
    [`${titelWort} Nr.`, inv.number],
    [p.angebot ? 'Datum' : `${titelWort}sdatum`.replace('Gutschriftsdatum', 'Datum'), datumDe(inv.issueDate)],
  ];
  if (p.angebot) {
    info.push(['Gültig bis', datumDe(p.angebot.gueltigBis)]);
    if (zeitraum) info.push(['Leistungszeitraum', zeitraum]);
  } else {
    // Leistungszeitpunkt ist Pflichtangabe (§ 14 Abs. 4 Nr. 6 UStG, Befund R7).
    info.push([zeitraum && zeitraum.includes('–') ? 'Leistungszeitraum' : 'Leistungsdatum', zeitraum ?? 'wie Rechnungsdatum']);
    if (inv.kind !== 'gutschrift') info.push(['Fällig am', datumDe(inv.dueDate)]);
  }
  if (customer.customerNumber) info.push(['Kundennr.', customer.customerNumber]);
  if (customer.vatNumber) info.push(['Ihre USt-IdNr.', customer.vatNumber]);
  info.push(...infoEmailUndAnsprechpartner(customer, seller));
  const iEnde = zeichneInfo(doc, info);

  // ── Betreff, Anrede, Einleitung ─────────────────────────────────────────────
  let y = Math.max(aEnde, iEnde, 98.4 * MM_Y) + 10;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(FARBE.text).text(`${titel} NR. ${inv.number}`, S.L, y, { width: W });
  y = doc.y + 14;
  doc.font('Helvetica').fontSize(10).fillColor(FARBE.text).text(anrede(customer), S.L, y, { width: W });
  y = doc.y + 8;
  if (templateTexts?.introText) {
    doc.text(templateTexts.introText, S.L, y, { width: W });
    y = doc.y + 12;
  } else y += 4;

  // ── Tabelle (K110, Folgeseiten K113) ────────────────────────────────────────
  const COL = {
    pos:  { x: S.L + 2,   w: 24 },
    desc: { x: S.L + 32,  w: W - 32 - 216 },
    qty:  { x: S.R - 212, w: 64 },
    up:   { x: S.R - 144, w: 64 },
    tot:  { x: S.R - 76,  w: 70 },
  } as const;
  const tabellenkopf = (yy: number): number => {
    doc.rect(S.L, yy, W, 18).fill(FARBE.kopf);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(FARBE.text);
    doc.text('Pos.', COL.pos.x, yy + 5, { width: COL.pos.w });
    doc.text('Beschreibung', COL.desc.x, yy + 5, { width: COL.desc.w });
    doc.text('Menge', COL.qty.x, yy + 5, { width: COL.qty.w, align: 'right' });
    doc.text('Einzelpreis', COL.up.x, yy + 5, { width: COL.up.w, align: 'right' });
    doc.text('Gesamtpreis', COL.tot.x, yy + 5, { width: COL.tot.w, align: 'right' });
    return yy + 22;
  };
  y = platz(doc, y, 60, titel);
  y = tabellenkopf(y);

  for (const [i, l] of lines.entries()) {
    const unterzeile = leistungsdatumZeile(l) ?? '';
    doc.font('Helvetica').fontSize(9.5);
    const hDesc = doc.heightOfString(l.description, { width: COL.desc.w });
    doc.fontSize(8);
    const hUnter = unterzeile ? doc.heightOfString(unterzeile, { width: COL.desc.w }) : 0;
    const hoehe = hDesc + hUnter + 8;
    y = platz(doc, y, hoehe, titel, (ny) => tabellenkopf(ny));
    doc.font('Helvetica').fontSize(9.5).fillColor(FARBE.text);
    doc.text(`${i + 1}.`, COL.pos.x, y, { width: COL.pos.w, align: 'right' });
    doc.text(l.description, COL.desc.x, y, { width: COL.desc.w });
    if (unterzeile) doc.font('Helvetica').fontSize(8).fillColor(FARBE.grau).text(unterzeile, COL.desc.x, y + hDesc, { width: COL.desc.w });
    doc.font('Helvetica').fontSize(9.5).fillColor(FARBE.text);
    doc.text(`${mengeDe(l.quantity)}${l.unit ? ` ${l.unit}` : ''}`, COL.qty.x, y, { width: COL.qty.w, align: 'right' });
    doc.text(euro(l.unitPrice), COL.up.x, y, { width: COL.up.w, align: 'right' });
    doc.text(euro(l.netAmount), COL.tot.x, y, { width: COL.tot.w, align: 'right' });
    y += hoehe;
    if (i < lines.length - 1) doc.moveTo(S.L, y - 4).lineTo(S.R, y - 4).lineWidth(0.4).strokeColor(FARBE.linie).stroke();
  }
  doc.moveTo(S.L, y - 2).lineTo(S.R, y - 2).lineWidth(1.4).strokeColor(FARBE.text).stroke();

  // ── Summen ──────────────────────────────────────────────────────────────────
  y = platz(doc, y + 2, 70, titel);
  const sx = S.R - 200;
  const summenZeile = (label: string, wert: string, fett = false) => {
    doc.font(fett ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor(FARBE.text);
    doc.text(label, sx + 6, y + 4, { width: 120, align: 'right' });
    doc.text(wert, COL.tot.x, y + 4, { width: COL.tot.w, align: 'right' });
    y += 18;
    doc.moveTo(sx, y).lineTo(S.R, y).lineWidth(0.4).strokeColor(FARBE.linie).stroke();
  };
  if (!isKlein) {
    summenZeile('Summe Netto', euro(inv.netAmount), true);
    summenZeile(`zzgl. USt. ${inv.taxRate} %`, euro(inv.taxAmount));
  } else {
    summenZeile('Summe Netto', euro(inv.grossAmount), true);
    summenZeile('USt. (§ 19 UStG)', euro(0));
  }
  doc.moveTo(sx, y).lineTo(S.R, y).lineWidth(1.4).strokeColor(FARBE.text).stroke();
  doc.rect(sx, y + 1, 200, 20).fill(FARBE.summe);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(FARBE.text);
  doc.text('Gesamtsumme', sx + 6, y + 7, { width: 120, align: 'right' });
  doc.text(euro(inv.grossAmount), COL.tot.x, y + 7, { width: COL.tot.w, align: 'right' });
  y += 32;

  // ── Hinweise, Zahlung, Schluss ──────────────────────────────────────────────
  const absatz = (text: string, opts: { fett?: boolean; groesse?: number; abstand?: number } = {}) => {
    const schrift = () => doc.font(opts.fett ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.groesse ?? 10);
    schrift();
    y = platz(doc, y, doc.heightOfString(text, { width: W }) + 4, titel);
    // Nach einem Seitenwechsel hat der Kopf die Titelschrift eingestellt – Schrift neu setzen.
    schrift().fillColor(FARBE.text).text(text, S.L, y, { width: W });
    y = doc.y + (opts.abstand ?? 6);
  };
  if (isKlein) absatz(kleinNote, { fett: true, groesse: 7.5 });
  else if (seller.vatId) absatz(`USt-IdNr.: ${seller.vatId}`, { groesse: 7.5 });
  if (supplyTypeForMeta && supplyNoticeMap[supplyTypeForMeta]) absatz(supplyNoticeMap[supplyTypeForMeta], { groesse: 7.5 });
  if (!p.angebot && inv.kind !== 'gutschrift') {
    // Prüfung L3 (B1, K38): Zahlungsziel aus der Rechnung selbst, nicht fest 14 Tage.
    const zielTage = Math.max(0, Math.round((Date.parse(inv.dueDate) - Date.parse(inv.issueDate)) / 86_400_000));
    absatz(`Zahlung innerhalb von ${Number.isFinite(zielTage) ? zielTage : 14} Tagen bis ${datumDe(inv.dueDate)} ohne Abzug unter Angabe des Verwendungszwecks „${inv.paymentReference ?? inv.number}“.`, { groesse: 7.5, abstand: 10 });
  } else if (p.angebot) {
    absatz(`Dieses Angebot ist gültig bis ${datumDe(p.angebot.gueltigBis)}.`, { groesse: 7.5, abstand: 10 });
  }
  if (templateTexts?.outroText) absatz(templateTexts.outroText, { abstand: 8 });
  if (inv.notes) absatz(inv.notes, { groesse: 8.5, abstand: 8 });
  y += 4;
  grussformel(doc, y, seller, titel);

  abschliessen(doc, seller);
  const basePdf = await fertig;

  // Stufe 4: Ein Angebot ist keine Rechnung – keine E-Rechnung einbetten.
  if (p.angebot) return basePdf;

  // ── PDF/A-3 post-processing: embed e-invoice XML ────────────────────────
  const profile = p.profile ?? 'factur-x-minimum';
  const xml = generateEInvoiceXml(profile, p as unknown as EInvoiceInput);
  const attachmentName = profile === 'factur-x-minimum' ? 'factur-x.xml' : 'xrechnung.xml';
  const PROFILE_LEVEL: Record<EInvoiceProfile, FacturXLevel> = {
    'factur-x-minimum': 'MINIMUM',
    'xrechnung-cii':    'XRECHNUNG',
    'xrechnung-ubl':    'XRECHNUNG',
  };
  return embedFacturXIntoPdfA3(basePdf, xml, {
    conformanceLevel: PROFILE_LEVEL[profile],
    invoiceNumber: p.invoice.number,
    attachmentName,
    modificationDate: new Date(p.invoice.issueDate),
  });
}
