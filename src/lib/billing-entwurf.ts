// Rechnungswesen Stufe 3, T10a: aus offenen Posten wird ein Rechnungsentwurf
// (Spezifikation K22–K25, K30, K38). Die Posten werden dabei gesperrt
// (zustand 'auf_entwurf' + invoice_id), beim Festschreiben 'abgerechnet',
// beim Verwerfen des Entwurfs oder Storno der Rechnung wieder 'offen'.
// Ein Posten steht so technisch immer auf höchstens einer Rechnung (K23).
import { pool } from './website-db';
import { createCustomer, createInvoice } from './native-billing';
import { ladeZahlungsziel } from './billing-regeln';
import { gibPostenFrei, initPostenTabelle, type Posten, type PostenZustand } from './billing-posten';
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
              menge, einheit, einzelpreis, zustand, invoice_id, notiz, auftrag_id
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
    const zeitraum = rechnungsZeitraum(zeilen);
    const inv = await createInvoice({
      brand, customerId: kunde.id,
      issueDate: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }),
      dueDays,
      // Steuerart bewusst nicht gesetzt: zentrale Einstellung, als Kleinunternehmer ohne USt (K30).
      lines: zeilen,
      servicePeriodStart: zeitraum.start, servicePeriodEnd: zeitraum.end,
      isTestData: opts.isTestData,
    }, client);

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

/** Entwurf verwerfen: Posten freigeben und Entwurf löschen, beides oder nichts (K24). */
export async function verwirfEntwurf(brand: string, invoiceId: string): Promise<boolean> {
  await initPostenTabelle();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await gibPostenFrei(client, invoiceId, 'auf_entwurf');
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
