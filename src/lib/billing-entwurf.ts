// Rechnungswesen Stufe 3, T10a: aus offenen Posten wird ein Rechnungsentwurf
// (Spezifikation K22–K25, K30, K38). Die Posten werden dabei gesperrt
// (zustand 'auf_entwurf' + invoice_id), beim Festschreiben 'abgerechnet',
// beim Verwerfen des Entwurfs oder Storno der Rechnung wieder 'offen'.
// Ein Posten steht so technisch immer auf höchstens einer Rechnung (K23).
import { pool } from './website-db';
import { createCustomer, createInvoice } from './native-billing';
import { ladeZahlungsziel } from './billing-regeln';
import { gibPostenFrei, initPostenTabelle, type Posten, type PostenZustand, type PositionWerte } from './billing-posten';
import { gemaessAngebotText } from './billing-angebot-text';
import { rechnungsempfaenger, verknuepfeRechnungskunde, type Klient } from './klientenakte';
import type { InvoiceLine } from './invoice-types';

export type RechnungsZeile = InvoiceLine & { leistungVon: string; leistungBis: string | null; postenId: string };

/** Prüft die Auswahl in der Akte. `posten` sind alle Posten dieses Klienten. */
export function pruefeAuswahl(posten: Posten[], ausgewaehlt: string[]): { posten: Posten[]; fehler: string | null } {
  const ids = [...new Set(ausgewaehlt)];
  if (ids.length === 0) return { posten: [], fehler: 'Bitte mindestens einen offenen Posten ankreuzen.' };
  const jeId = new Map(posten.map((p) => [p.id, p]));
  const gewaehlt: Posten[] = [];
  for (const id of ids) {
    const p = jeId.get(id);
    if (!p) return { posten: [], fehler: 'Ein gewählter Posten gehört nicht zu dieser Akte.' };
    if (p.zustand === 'auf_entwurf' || p.zustand === 'abgerechnet') {
      return { posten: [], fehler: `„${p.text}“ steht schon auf einer Rechnung und kann nicht ein zweites Mal abgerechnet werden.` };
    }
    if (p.zustand === 'geplant') return { posten: [], fehler: `„${p.text}“ ist noch geplant: Das Angebot ist nicht angenommen, die Position ist nicht offen.` };
    if (p.zustand !== 'offen') return { posten: [], fehler: `„${p.text}“ ist nicht offen (ausgenommen oder erlassen).` };
    if (p.einzelpreis === null) return { posten: [], fehler: `Bei „${p.text}“ fehlt noch der Preis. Bitte zuerst eintragen.` };
    gewaehlt.push(p);
  }
  return { posten: gewaehlt, fehler: null };
}

/**
 * Positionen der Rechnung, nach Leistungsdatum geordnet. Zahlt eine Firma für eine
 * Person (Stufe 2, „Rechnung geht an“), nennt jede Position die Person (Grenzfall Spezifikation).
 */
export function rechnungszeilen(posten: Posten[], opts: { person: string | null }): RechnungsZeile[] {
  return [...posten]
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.datum.localeCompare(b.p.datum) || a.i - b.i)
    .map(({ p }) => ({
      description: opts.person && !p.text.includes(opts.person) ? `${p.text} · ${opts.person}` : p.text,
      quantity: p.menge,
      unitPrice: p.einzelpreis ?? 0,
      unit: p.einheit,
      leistungVon: p.datum,
      leistungBis: p.datumBis ?? null,
      postenId: p.id,
    }));
}

export { leistungsdatumZeile } from './leistungszeitraum';

/** Leistungszeitraum der ganzen Rechnung (Kopf): frühestes bis spätestes Datum; ein Tag ohne Ende. */
export function rechnungsZeitraum(zeilen: { leistungVon: string; leistungBis: string | null }[]): { start: string; end: string | undefined } {
  const start = zeilen.map((z) => z.leistungVon).sort()[0];
  const ende = zeilen.map((z) => z.leistungBis ?? z.leistungVon).sort().at(-1)!;
  return { start, end: ende === start ? undefined : ende };
}

// ── Datenbank ───────────────────────────────────────────────────────────────

export type EntwurfErgebnis = { ok: true; invoiceId: string; number: string } | { ok: false; fehler: string };

/**
 * Legt aus den gewählten Posten einen Entwurf an (K22). Sperren der Posten und Anlegen
 * der Rechnung geschehen in einer Transaktion: Wird derselbe Posten gleichzeitig ein
 * zweites Mal gewählt, wartet die zweite Anfrage und findet ihn dann nicht mehr offen (K23).
 */
export async function erstelleEntwurfAusPosten(
  brand: string, klient: Klient, postenIds: string[], opts: { isTestData?: boolean } = {},
): Promise<EntwurfErgebnis> {
  await initPostenTabelle();
  const ids = [...new Set(postenIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length === 0) return { ok: false, fehler: 'Bitte mindestens einen offenen Posten ankreuzen.' };

  const dueDays = await ladeZahlungsziel(brand); // K38
  const e = rechnungsempfaenger(klient);
  const kunde = await createCustomer({
    brand, name: e.name, email: e.email, company: e.company ?? undefined,
    addressLine1: e.addressLine1 ?? undefined, postalCode: e.postalCode ?? undefined,
    city: e.city ?? undefined, vatNumber: e.vatNumber ?? undefined, isTestData: opts.isTestData,
  });
  await verknuepfeRechnungskunde(kunde.id, klient.id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, klient_id, herkunft, datum::text AS datum, datum_bis::text AS datum_bis, leistung_key, text,
              menge, einheit, einzelpreis, zustand, invoice_id, notiz, auftrag_id, angebot_id
         FROM abrechnungsposten
        WHERE brand = $1 AND klient_id = $2 AND id = ANY($3::uuid[])
        FOR UPDATE`,
      [brand, klient.id, ids]);
    const gefunden: Posten[] = rows.map((r: Record<string, unknown>) => ({
      id: r.id as string, klientId: r.klient_id as string, klientName: klient.name,
      herkunft: r.herkunft as Posten['herkunft'], datum: r.datum as string, datumBis: (r.datum_bis as string | null) ?? null,
      leistungKey: (r.leistung_key as string | null) ?? null, text: r.text as string, menge: Number(r.menge),
      einheit: (r.einheit as string) ?? '', einzelpreis: r.einzelpreis === null ? null : Number(r.einzelpreis),
      zustand: r.zustand as PostenZustand, invoiceId: (r.invoice_id as string | null) ?? null,
      notiz: (r.notiz as string | null) ?? null, auftragId: (r.auftrag_id as string | null) ?? null,
    }));
    const { posten, fehler } = pruefeAuswahl(gefunden, ids);
    if (fehler) { await client.query('ROLLBACK'); return { ok: false, fehler }; }

    const zeilen = rechnungszeilen(posten, { person: e.company ? klient.name : null });
    // Stufe 4 T17 (K53): Posten aus angenommenen Angeboten → „gemäß Angebot AN-…“ auf der Rechnung.
    const angebotIds = [...new Set(rows.filter((r: Record<string, unknown>) => ids.includes(r.id as string) && r.angebot_id)
      .map((r: Record<string, unknown>) => r.angebot_id as string))];
    const nummern = angebotIds.length === 0 ? [] : (await client.query(
      'SELECT number FROM billing_quotes WHERE id = ANY($1::text[])', [angebotIds])).rows.map((r: { number: string }) => r.number);
    const hinweis = gemaessAngebotText(nummern);
    const zeitraum = rechnungsZeitraum(zeilen);
    const inv = await createInvoice({
      brand, customerId: kunde.id,
      issueDate: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }),
      dueDays,
      // Steuerart bewusst nicht gesetzt: zentrale Einstellung, als Kleinunternehmer ohne USt (K30).
      lines: zeilen,
      servicePeriodStart: zeitraum.start, servicePeriodEnd: zeitraum.end,
      notes: hinweis ?? undefined,
      isTestData: opts.isTestData,
    }, client);

    await client.query('UPDATE billing_invoices SET klient_id = $2 WHERE id = $1', [inv.id, klient.id]);
    const upd = await client.query(
      `UPDATE abrechnungsposten SET zustand = 'auf_entwurf', invoice_id = $3, updated_at = now()
        WHERE brand = $1 AND id = ANY($2::uuid[]) AND zustand = 'offen'`,
      [brand, posten.map((p) => p.id), inv.id]);
    if ((upd.rowCount ?? 0) !== posten.length) throw new Error('Posten wurden während des Anlegens verändert.');
    await client.query('COMMIT');
    return { ok: true, invoiceId: inv.id, number: inv.number };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** N3: Vermerkfeld mit aktuellem „gemäß Angebot …“; übrige Zeilen bleiben, leer → null. */
export function mitAngebotsVermerk(alt: string | null, hinweis: string | null): string | null {
  const rest = (alt ?? '').split('\n').filter((z) => !/^gemäß Angebot(en)? /.test(z.trim()) && z.trim() !== '');
  const zeilen = hinweis ? [hinweis, ...rest] : rest;
  return zeilen.length > 0 ? zeilen.join('\n') : null;
}

/**
 * Handtest 23.10.2026: Ein Entwurf bleibt bis zum Festschreiben änderbar. Nach jeder Änderung an
 * seinen Posten wird er neu aufgebaut: Positionen aus den Posten (in derselben Reihenfolge und
 * Schreibweise wie beim Anlegen), freie Positionen ohne Posten bleiben, Summen und Leistungszeitraum
 * neu. Ohne eine einzige Position wird der Entwurf verworfen. Liefert, was geschah.
 */
export async function aktualisiereEntwurf(brand: string, invoiceId: string): Promise<'aktualisiert' | 'verworfen' | 'kein_entwurf'> {
  await initPostenTabelle();
  const kopf = (await pool.query(
    `SELECT status, klient_id::text AS klient_id, tax_mode, tax_rate, notes FROM billing_invoices WHERE id = $1 AND brand = $2`,
    [invoiceId, brand])).rows[0];
  if (!kopf || kopf.status !== 'draft') return 'kein_entwurf';
  const { rows } = await pool.query(
    `SELECT id, klient_id, herkunft, datum::text AS datum, datum_bis::text AS datum_bis, leistung_key, text, menge, einheit,
            einzelpreis, zustand, invoice_id, notiz, auftrag_id, angebot_id
       FROM abrechnungsposten WHERE brand = $1 AND invoice_id = $2 AND zustand = 'auf_entwurf' ORDER BY datum, created_at`,
    [brand, invoiceId]);
  const frei = (await pool.query(
    `SELECT quantity, unit_price, leistung_von::text AS von, leistung_bis::text AS bis FROM billing_invoice_line_items
      WHERE invoice_id = $1 AND posten_id IS NULL`, [invoiceId])).rows;
  if (rows.length === 0 && frei.length === 0) {
    await verwirfEntwurf(brand, invoiceId);
    return 'verworfen';
  }
  const { getKlient } = await import('./klientenakte');
  const klient = kopf.klient_id ? await getKlient(kopf.klient_id) : null;
  const person = klient && rechnungsempfaenger(klient).company ? klient.name : null;
  const posten: Posten[] = rows.map((r: Record<string, unknown>) => ({
    id: r.id as string, klientId: r.klient_id as string, klientName: klient?.name ?? '', herkunft: r.herkunft as Posten['herkunft'],
    datum: r.datum as string, datumBis: (r.datum_bis as string | null) ?? null, leistungKey: (r.leistung_key as string | null) ?? null,
    text: r.text as string, menge: Number(r.menge), einheit: (r.einheit as string) ?? '',
    einzelpreis: r.einzelpreis === null ? null : Number(r.einzelpreis), zustand: 'auf_entwurf', invoiceId,
    notiz: (r.notiz as string | null) ?? null, auftragId: (r.auftrag_id as string | null) ?? null,
  }));
  const zeilen = rechnungszeilen(posten, { person });
  const nummern = [...new Set(rows.map((r: Record<string, unknown>) => r.angebot_id as string | null).filter(Boolean))];
  const hinweis = nummern.length === 0 ? null : gemaessAngebotText((await pool.query(
    'SELECT number FROM billing_quotes WHERE id = ANY($1::text[])', [nummern])).rows.map((r: { number: string }) => r.number));
  // Prüfung Stufe 4 Runde 3 (N3, K53): alten „gemäß Angebot …“-Vermerk ersetzen, andere Vermerke behalten.
  const vermerk = mitAngebotsVermerk(kopf.notes as string | null, hinweis);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM billing_invoice_line_items WHERE invoice_id = $1 AND posten_id IS NOT NULL', [invoiceId]);
    for (const z of zeilen) {
      await client.query(
        `INSERT INTO billing_invoice_line_items (invoice_id, description, quantity, unit, unit_price, net_amount, leistung_von, leistung_bis, posten_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [invoiceId, z.description, z.quantity, z.unit ?? null, z.unitPrice, Math.round(z.quantity * z.unitPrice * 100) / 100,
         z.leistungVon, z.leistungBis, z.postenId]);
    }
    const netto = Math.round((zeilen.reduce((s, z) => s + z.quantity * z.unitPrice, 0)
      + frei.reduce((s: number, f: Record<string, unknown>) => s + Number(f.quantity) * Number(f.unit_price), 0)) * 100) / 100;
    const satz = kopf.tax_mode === 'kleinunternehmer' ? 0 : Number(kopf.tax_rate ?? 0);
    const steuer = Math.round(netto * satz) / 100;
    const datiert = [
      ...zeilen.map((z) => ({ leistungVon: z.leistungVon, leistungBis: z.leistungBis })),
      ...frei.filter((f: Record<string, unknown>) => f.von).map((f: Record<string, unknown>) => ({ leistungVon: f.von as string, leistungBis: (f.bis as string | null) ?? null })),
    ];
    const zeitraum = datiert.length > 0 ? rechnungsZeitraum(datiert) : null;
    await client.query(
      `UPDATE billing_invoices SET net_amount=$2, tax_amount=$3, gross_amount=$4, net_amount_eur=$2, gross_amount_eur=$4,
         service_period_start=$5, service_period_end=$6, notes=$7, updated_at=now()
       WHERE id=$1 AND status='draft'`,
      [invoiceId, netto, steuer, Math.round((netto + steuer) * 100) / 100, zeitraum?.start ?? null, zeitraum?.end ?? null, vermerk]);
    await client.query('COMMIT');
    return 'aktualisiert';
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Handtest 23.10.2026: freie Position eines Entwurfs (ohne Posten) ändern; danach aktualisiereEntwurf. */
export async function aendereFreieZeile(invoiceId: string, zeileId: string, w: PositionWerte): Promise<boolean> {
  if (!/^\d+$/.test(zeileId)) return false;
  const r = await pool.query(
    `UPDATE billing_invoice_line_items l SET description=$3, quantity=$4, unit=$5, unit_price=$6, net_amount=$7, leistung_von=$8, leistung_bis=$9
       FROM billing_invoices i WHERE i.id = l.invoice_id AND i.status = 'draft' AND l.invoice_id=$1 AND l.id=$2 AND l.posten_id IS NULL`,
    [invoiceId, zeileId, w.text, w.menge, w.einheit || null, w.einzelpreis, Math.round(w.menge * w.einzelpreis * 100) / 100, w.datum, w.datumBis]);
  return (r.rowCount ?? 0) > 0;
}

/** Handtest 23.10.2026: freie Position eines Entwurfs entfernen; danach aktualisiereEntwurf. */
export async function entferneFreieZeile(invoiceId: string, zeileId: string): Promise<boolean> {
  if (!/^\d+$/.test(zeileId)) return false;
  const r = await pool.query(
    `DELETE FROM billing_invoice_line_items l USING billing_invoices i
      WHERE i.id = l.invoice_id AND i.status = 'draft' AND l.invoice_id=$1 AND l.id=$2 AND l.posten_id IS NULL`, [invoiceId, zeileId]);
  return (r.rowCount ?? 0) > 0;
}

/** Entwurf verwerfen: Posten freigeben und Entwurf löschen, beides oder nichts (K24). */
export async function verwirfEntwurf(brand: string, invoiceId: string): Promise<boolean> {
  await initPostenTabelle();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await gibPostenFrei(client, invoiceId, 'auf_entwurf');
    // T10b: Der Monat darf für diesen Klienten danach erneut laufen.
    await client.query('DELETE FROM abrechnungslaeufe WHERE invoice_id = $1', [invoiceId]);
    const del = await client.query(
      `DELETE FROM billing_invoices WHERE id = $1 AND brand = $2 AND status = 'draft'`, [invoiceId, brand]);
    if ((del.rowCount ?? 0) === 0) { await client.query('ROLLBACK'); return false; }
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
