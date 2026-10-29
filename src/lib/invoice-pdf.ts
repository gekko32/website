// Belege als PDF: Rechnung, Gutschrift, Angebot (generateInvoicePdf) und Zahlungserinnerung/Mahnung
// (generateDunningPdf). Seit 25.10.2026 im Briefbild nach Geralds Word-Muster und DIN 5008 (beleg-layout.ts,
// SPEZ-BELEG-DESIGN K107–K116); Rechnungen bekommen weiterhin die E-Rechnung (Factur-X/XRechnung) eingebettet.
import type { Invoice } from './invoice-types';
import { embedFacturXIntoPdfA3, type FacturXLevel } from './pdf-a3-embed';
import { generateEInvoiceXml, type EInvoiceProfile } from './einvoice-profile';
import type { EInvoiceInput } from './einvoice-types';
import { leistungsdatumZeile } from './leistungszeitraum';
import {
  neuerBeleg, zeichneKopf, zeichneAnschrift, zeichneInfo, infoEmailUndAnsprechpartner, platz, abschliessen, einzeilig,
  fliesstext, zeilen, S, W, MM, FARBE, euro, datumDe, mengeDe, type BelegAbsender, type BelegEmpfaenger,
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

type Doc = ReturnType<typeof neuerBeleg>['doc'];

/** Anrede: bei bekannter Person persönlich, sonst allgemein. */
function anrede(c: InvoicePdfCustomer): string {
  return c.name && c.name.trim() && c.name !== c.company ? `Guten Tag ${c.name.trim()},` : 'Sehr geehrte Damen und Herren,';
}

/** Gruß – bleibt zusammen auf einer Seite. */
function grussformel(doc: Doc, y: number, seller: InvoicePdfSeller, titel: string): number {
  y = platz(doc, y, 40, titel);
  einzeilig(doc, 'Mit freundlichen Grüßen', S.L, y, W);
  einzeilig(doc, seller.inhaber || seller.name, S.L, y + 26, W);
  return y + 40;
}

/** Betreffzeile nach DIN 5008 Form B (98,4 mm), unter Anschrift und Infoblock. */
function betreff(doc: Doc, text: string, aEnde: number, iEnde: number): number {
  const y = Math.max(aEnde, iEnde, 98.4 * MM) + 10;
  einzeilig(doc, text, S.L, y, W, { schrift: 'Helvetica-Bold', groesse: 11, min: 8 });
  return y + 26;
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

  let y = betreff(doc, `${d.level === 1 ? 'ZAHLUNGSERINNERUNG' : `${d.level - 1}. MAHNUNG`} ZU RECHNUNG NR. ${inv.number}`, aEnde, iEnde);
  // Prüfung B11: alle Texte laufen über den Fließtext und brechen bei Bedarf auf die nächste Seite um.
  const absatz = (t: string, abstand = 8) => { y = fliesstext(doc, t, S.L, y, W, titel) + abstand; };
  absatz(anrede(customer));
  absatz(d.level === 1
    ? `sicher haben Sie nur übersehen, dass die Rechnung Nr. ${inv.number} vom ${datumDe(inv.issueDate)} am ${datumDe(inv.dueDate)} zur Zahlung fällig war.`
    : `leider konnten wir bis heute keinen Zahlungseingang für die Rechnung Nr. ${inv.number} vom ${datumDe(inv.issueDate)} feststellen.`);
  absatz('Wir bitten Sie höflich, den offenen Betrag bis spätestens 7 Tage nach Erhalt dieses Schreibens zu begleichen.', 14);

  // Posten wie die Rechnungstabelle, nur Beschreibung und Betrag.
  y = platz(doc, y, 110, titel);
  doc.rect(S.L, y, W, 18).fill(FARBE.kopf);
  einzeilig(doc, 'Posten', S.L + 6, y + 5, W - 130, { schrift: 'Helvetica-Bold', groesse: 9 });
  einzeilig(doc, 'Betrag', S.R - 106, y + 5, 100, { schrift: 'Helvetica-Bold', groesse: 9, ausrichtung: 'right' });
  y += 24;
  const zeile = (label: string, wert: number) => {
    einzeilig(doc, label, S.L + 6, y, W - 130, { groesse: 9.5, min: 7 });
    einzeilig(doc, euro(wert), S.R - 106, y, 100, { groesse: 9.5, min: 7, ausrichtung: 'right' });
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
  einzeilig(doc, 'Gesamtbetrag', S.R - 194, y + 7, 90, { schrift: 'Helvetica-Bold', groesse: 10 });
  einzeilig(doc, euro(total), S.R - 106, y + 7, 100, { schrift: 'Helvetica-Bold', groesse: 10, min: 7, ausrichtung: 'right' });
  y += 34;

  absatz(`Bitte überweisen Sie den Gesamtbetrag auf das unten angegebene Konto unter Angabe des Verwendungszwecks „${inv.paymentReference ?? inv.number}“.`);
  absatz('Sollten Sie die Zahlung in der Zwischenzeit bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.', 16);
  grussformel(doc, y, seller, titel);

  abschliessen(doc, seller);
  return fertig;
}

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
    [p.angebot || inv.kind === 'gutschrift' ? 'Datum' : 'Rechnungsdatum', datumDe(inv.issueDate)],
  ];
  if (p.angebot) {
    info.push(['Gültig bis', datumDe(p.angebot.gueltigBis)]);
    if (zeitraum) info.push(['Leistungszeitraum', zeitraum]);
  } else {
    // Leistungszeitpunkt ist Pflichtangabe (§ 14 Abs. 4 Nr. 6 UStG, Befund R7).
    info.push([zeitraum && zeitraum.includes('–') ? 'Leistungszeitraum' : 'Leistungsdatum', zeitraum ?? `wie ${inv.kind === 'gutschrift' ? 'Datum' : 'Rechnungsdatum'}`]);
    if (inv.kind !== 'gutschrift') info.push(['Fällig am', datumDe(inv.dueDate)]);
  }
  if (customer.customerNumber) info.push(['Kundennr.', customer.customerNumber]);
  if (customer.vatNumber) info.push(['Ihre USt-IdNr.', customer.vatNumber]);
  info.push(...infoEmailUndAnsprechpartner(customer, seller));
  const iEnde = zeichneInfo(doc, info);

  // ── Betreff, Anrede, Einleitung ─────────────────────────────────────────────
  let y = betreff(doc, `${titel} NR. ${inv.number}`, aEnde, iEnde);
  y = fliesstext(doc, anrede(customer), S.L, y, W, titel) + 8;
  if (templateTexts?.introText) y = fliesstext(doc, templateTexts.introText, S.L, y, W, titel) + 12;
  else y += 4;

  // ── Tabelle (K110, Folgeseiten K113, Prüfung B1/B3) ─────────────────────────
  const COL = {
    pos:  { x: S.L + 2,   w: 24 },
    desc: { x: S.L + 32,  w: W - 32 - 226 },
    qty:  { x: S.R - 222, w: 72 },
    up:   { x: S.R - 146, w: 64 },
    tot:  { x: S.R - 78,  w: 72 },
  } as const;
  const tabellenkopf = (yy: number): number => {
    doc.rect(S.L, yy, W, 18).fill(FARBE.kopf);
    const k = { schrift: 'Helvetica-Bold' as const, groesse: 9 };
    einzeilig(doc, 'Pos.', COL.pos.x, yy + 5, COL.pos.w, k);
    einzeilig(doc, 'Beschreibung', COL.desc.x, yy + 5, COL.desc.w, k);
    einzeilig(doc, 'Menge', COL.qty.x, yy + 5, COL.qty.w, { ...k, ausrichtung: 'right' });
    einzeilig(doc, 'Einzelpreis', COL.up.x, yy + 5, COL.up.w, { ...k, ausrichtung: 'right' });
    einzeilig(doc, 'Gesamtpreis', COL.tot.x, yy + 5, COL.tot.w, { ...k, ausrichtung: 'right' });
    return yy + 22;
  };
  y = platz(doc, y, 60, titel);
  y = tabellenkopf(y);

  const ZH = 11.5, ZH_KLEIN = 9.6;
  for (const [i, l] of lines.entries()) {
    doc.font('Helvetica').fontSize(9.5);
    const textZeilen = zeilen(doc, l.description, COL.desc.w);
    doc.fontSize(8);
    const unter = leistungsdatumZeile(l) ?? '';
    const unterZeilen = unter ? zeilen(doc, unter, COL.desc.w) : [];
    // Anfang der Position mit Zahlen zusammenhalten (erste Zeile + Leistungsdatum, falls kurz).
    y = platz(doc, y, ZH + (textZeilen.length === 1 ? unterZeilen.length * ZH_KLEIN : 0) + 6, titel, tabellenkopf);
    const k = { groesse: 9.5, min: 6.5 };
    einzeilig(doc, `${i + 1}.`, COL.pos.x, y, COL.pos.w, { ...k, ausrichtung: 'right' });
    einzeilig(doc, `${mengeDe(l.quantity)}${l.unit ? ` ${l.unit}` : ''}`, COL.qty.x, y, COL.qty.w, { ...k, ausrichtung: 'right' });
    einzeilig(doc, euro(l.unitPrice), COL.up.x, y, COL.up.w, { ...k, ausrichtung: 'right' });
    einzeilig(doc, euro(l.netAmount), COL.tot.x, y, COL.tot.w, { ...k, ausrichtung: 'right' });
    // Beschreibung Zeile für Zeile – auch über einen Seitenwechsel hinweg.
    for (const z of textZeilen) {
      y = platz(doc, y, ZH, titel, tabellenkopf);
      doc.font('Helvetica').fontSize(9.5).fillColor(FARBE.text).text(z, COL.desc.x, y, { lineBreak: false });
      y += ZH;
    }
    for (const z of unterZeilen) {
      y = platz(doc, y, ZH_KLEIN, titel, tabellenkopf);
      doc.font('Helvetica').fontSize(8).fillColor(FARBE.grau).text(z, COL.desc.x, y, { lineBreak: false });
      y += ZH_KLEIN;
    }
    y += 6;
    if (i < lines.length - 1) doc.moveTo(S.L, y - 4).lineTo(S.R, y - 4).lineWidth(0.4).strokeColor(FARBE.linie).stroke();
  }
  doc.moveTo(S.L, y - 2).lineTo(S.R, y - 2).lineWidth(1.4).strokeColor(FARBE.text).stroke();

  // ── Summen ──────────────────────────────────────────────────────────────────
  y = platz(doc, y + 2, 70, titel);
  const sx = S.R - 210;
  const summenZeile = (label: string, wert: string, fett = false) => {
    const o = { schrift: (fett ? 'Helvetica-Bold' : 'Helvetica') as 'Helvetica-Bold' | 'Helvetica', groesse: 9.5, min: 7 };
    einzeilig(doc, label, sx + 4, y + 4, 124, { ...o, ausrichtung: 'right' });
    einzeilig(doc, wert, COL.tot.x - 8, y + 4, COL.tot.w + 8, { ...o, ausrichtung: 'right' });
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
  doc.rect(sx, y + 1, 210, 20).fill(FARBE.summe);
  einzeilig(doc, 'Gesamtsumme', sx + 4, y + 7, 124, { schrift: 'Helvetica-Bold', groesse: 10, ausrichtung: 'right' });
  einzeilig(doc, euro(inv.grossAmount), COL.tot.x - 8, y + 7, COL.tot.w + 8, { schrift: 'Helvetica-Bold', groesse: 10, min: 7, ausrichtung: 'right' });
  y += 32;

  // ── Hinweise, Zahlung, Schluss (Fließtext, Prüfung B1) ──────────────────────
  const absatz = (t: string, o: { fett?: boolean; groesse?: number; abstand?: number } = {}) => {
    y = fliesstext(doc, t, S.L, y, W, titel, { schrift: o.fett ? 'Helvetica-Bold' : 'Helvetica', groesse: o.groesse ?? 10 }) + (o.abstand ?? 4);
  };
  // K123 (Handtest 29.10.2026): USt-IdNr. nur im Fuß, nicht noch einmal im Text.
  if (isKlein) absatz(kleinNote, { fett: true, groesse: 7.5 });
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
