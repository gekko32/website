// N33 (Gerald 01.11.2026, H47): Mahnvorgang je Rechnung – läuft oder abgeschlossen.
// Abschluss automatisch (bezahlt, storniert) oder von Hand: abgeschrieben, an Gericht/Inkasso übergeben, eingestellt.
// Der Rechnungsstatus bleibt bewusst unverändert (Zahlungsbuchung, Offene Posten und Kundenportal hängen daran);
// der Abschluss steht in billing_mahnabschluss, wirkt auf Mahnlauf und Mahnungsseite und steht im Protokoll.
// Eine spätere Zahlung wird trotzdem normal gebucht; der Vorgang zählt dann als „bezahlt“.
import { pool, initBillingTables } from './website-db';
import { type MailErgebnis } from './billing-mail';

export type AbschlussArt = 'abgeschrieben' | 'uebergeben' | 'eingestellt';

export const ABSCHLUSS_TEXT: Record<AbschlussArt | 'bezahlt' | 'storniert', string> = {
  abgeschrieben: 'abgeschrieben (uneinbringlich)',
  uebergeben: 'an Gericht/Inkasso übergeben',
  eingestellt: 'Mahnungen eingestellt',
  bezahlt: 'bezahlt',
  storniert: 'storniert',
};

export interface MahnVorgang {
  invoiceId: string; rechnungsnummer: string; klientName: string;
  offenJetzt: number;
  /** Höchste verschickte Stufe (0 = noch keine verschickt). */
  stufe: number; letzterVersand: string | null; frist: string | null;
  /** Neueste Mahnung (für den Link zur Prüfseite). */
  mahnungId: string | null;
  /** null = läuft. */
  abschluss: { art: AbschlussArt | 'bezahlt' | 'storniert'; am: string | null; grund: string; von: string | null } | null;
  /** Frist der letzten Mahnung ist abgelaufen – jetzt entscheiden (abschreiben, übergeben, weiter warten). */
  entscheidungNoetig: boolean;
}

const heuteBerlin = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const ARTEN: readonly AbschlussArt[] = ['abgeschrieben', 'uebergeben', 'eingestellt'];
const GESPERRT = 'Zu dieser Rechnung wird gerade eine Mahnung verschickt. Bitte die Seite neu laden.';

/** Alle Rechnungen mit verschickter Mahnung oder Abschluss. */
export async function listeVorgaenge(brand: string, nurRechnung?: string): Promise<MahnVorgang[]> {
  await initBillingTables();
  const { rows } = await pool.query(
    `SELECT i.id AS invoice_id, i.number, i.status,
            COALESCE((SELECT k.name FROM customers k WHERE k.id = i.klient_id), i.empfaenger->>'company', i.empfaenger->>'name', '') AS klient_name,
            v.gross_amount - COALESCE(v.paid_amount, 0) AS offen_jetzt, v.paid_at,
            (SELECT MAX(d.level) FROM billing_invoice_dunnings d WHERE d.invoice_id = i.id AND d.sent_at IS NOT NULL) AS stufe,
            (SELECT d.sent_at FROM billing_invoice_dunnings d WHERE d.invoice_id = i.id AND d.sent_at IS NOT NULL ORDER BY d.level DESC LIMIT 1) AS letzter_versand,
            (SELECT d.frist::text FROM billing_invoice_dunnings d WHERE d.invoice_id = i.id AND d.sent_at IS NOT NULL ORDER BY d.level DESC LIMIT 1) AS frist,
            (SELECT d.id FROM billing_invoice_dunnings d WHERE d.invoice_id = i.id ORDER BY d.level DESC LIMIT 1) AS mahnung_id,
            a.art, a.grund, a.abgeschlossen_am, a.von,
            (SELECT l.created_at FROM billing_audit_log l WHERE l.invoice_id = i.id AND l.action = 'storno' ORDER BY l.id DESC LIMIT 1) AS storniert_am
       FROM billing_invoices i
       JOIN v_billing_invoices_with_state v ON v.id = i.id
       LEFT JOIN billing_mahnabschluss a ON a.invoice_id = i.id
      WHERE i.brand = $1 AND ($2::text IS NULL OR i.id = $2)
        AND (a.invoice_id IS NOT NULL OR EXISTS (SELECT 1 FROM billing_invoice_dunnings d WHERE d.invoice_id = i.id AND d.sent_at IS NOT NULL))
      ORDER BY i.number`, [brand, nurRechnung ?? null]);
  const heute = heuteBerlin();
  return rows.map((r) => {
    const stufe = Number(r.stufe ?? 0);
    const frist = (r.frist as string | null) ?? null;
    let abschluss: MahnVorgang['abschluss'] = null;
    // Bezahlt und storniert gehen vor: eine Zahlung nach „übergeben“ schließt als bezahlt.
    if (r.status === 'paid') abschluss = { art: 'bezahlt', am: r.paid_at ? new Date(r.paid_at).toISOString() : null, grund: '', von: null };
    else if (r.status === 'cancelled') abschluss = { art: 'storniert', am: r.storniert_am ? new Date(r.storniert_am).toISOString() : null, grund: '', von: null };
    else if (r.art) abschluss = { art: r.art as AbschlussArt, am: r.abgeschlossen_am ? new Date(r.abgeschlossen_am).toISOString() : null, grund: String(r.grund ?? ''), von: (r.von as string | null) ?? null };
    return {
      invoiceId: String(r.invoice_id), rechnungsnummer: String(r.number), klientName: String(r.klient_name ?? ''),
      offenJetzt: Math.round(Number(r.offen_jetzt ?? 0) * 100) / 100,
      stufe, letzterVersand: r.letzter_versand ? new Date(r.letzter_versand).toISOString() : null, frist,
      mahnungId: (r.mahnung_id as string | null) ?? null,
      abschluss,
      entscheidungNoetig: !abschluss && stufe >= 3 && !!frist && heute > frist,
    };
  });
}

/** Für Dashboard und Seite: wie viele Vorgänge eine Entscheidung brauchen. */
export async function zaehleEntscheidungen(brand: string): Promise<number> {
  return (await listeVorgaenge(brand)).filter((v) => v.entscheidungNoetig).length;
}

/**
 * „Mahnverfahren beenden …“: abschreiben, übergeben oder einstellen – jederzeit, auch vor der letzten Stufe.
 * Eine noch nicht verschickte Mahnung wird dabei verworfen, eine Mahnpause entfällt. Alles in einer Transaktion.
 */
export async function beendeMahnverfahren(
  brand: string, invoiceId: string, eingabe: { art: string; grund: string }, wer?: string,
): Promise<MailErgebnis> {
  const art = eingabe.art as AbschlussArt;
  const grund = (eingabe.grund ?? '').trim();
  if (!ARTEN.includes(art)) return { ok: false, status: 400, fehler: 'Bitte wählen: abgeschrieben, an Gericht/Inkasso übergeben oder Mahnungen eingestellt.' };
  if (!grund) return { ok: false, status: 400, fehler: 'Bitte kurz den Grund eintragen (steht im Protokoll).' };
  await initBillingTables();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inv = (await client.query(
      `SELECT id, status FROM billing_invoices WHERE id = $1 AND brand = $2 FOR UPDATE`, [invoiceId, brand])).rows[0];
    if (!inv) { await client.query('ROLLBACK'); return { ok: false, status: 404, fehler: 'Rechnung nicht gefunden.' }; }
    if (inv.status === 'paid' || inv.status === 'cancelled') {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, fehler: `Die Rechnung ist ${inv.status === 'paid' ? 'bezahlt' : 'storniert'} – der Mahnvorgang ist damit schon abgeschlossen.` };
    }
    const schon = (await client.query(`SELECT art FROM billing_mahnabschluss WHERE invoice_id = $1`, [invoiceId])).rows[0];
    if (schon) { await client.query('ROLLBACK'); return { ok: false, status: 409, fehler: 'Das Mahnverfahren ist schon beendet.' }; }
    const sendet = (await client.query(
      `SELECT 1 FROM billing_invoice_dunnings WHERE invoice_id = $1 AND sent_at IS NULL AND versandweg = 'sendet'
          AND sperre_am >= now() - interval '10 minutes'`, [invoiceId])).rows.length;
    if (sendet) { await client.query('ROLLBACK'); return { ok: false, status: 409, fehler: GESPERRT }; }
    const verworfen = await client.query(
      `DELETE FROM billing_invoice_dunnings WHERE invoice_id = $1 AND sent_at IS NULL RETURNING *`, [invoiceId]);
    // Status wie nach der letzten verschickten Stufe (die verworfene war nie draußen).
    let neuerStatus: string | null = null;
    if (verworfen.rows.length > 0) {
      const hoechste = (await client.query(
        `SELECT MAX(level) AS l FROM billing_invoice_dunnings WHERE invoice_id = $1`, [invoiceId])).rows[0]?.l;
      const vorher = (await client.query(
        `SELECT from_status FROM billing_audit_log WHERE invoice_id = $1 AND action = 'dunning_generated' AND to_status = $2
          ORDER BY id DESC LIMIT 1`, [invoiceId, inv.status])).rows[0]?.from_status as string | undefined;
      neuerStatus = hoechste ? `dunning_${hoechste}` : (vorher ?? 'open');
      if (/^dunning_\d$/.test(inv.status)) {
        await client.query(`UPDATE billing_invoices SET status = $2, updated_at = now() WHERE id = $1`, [invoiceId, neuerStatus]);
      } else neuerStatus = null;
    }
    await client.query(`DELETE FROM billing_mahnpausen WHERE invoice_id = $1`, [invoiceId]);
    await client.query(
      `INSERT INTO billing_mahnabschluss (invoice_id, art, grund, von) VALUES ($1, $2, $3, $4)`,
      [invoiceId, art, grund, wer ?? 'admin']);
    await client.query(
      `INSERT INTO billing_audit_log (invoice_id, action, actor_email, from_status, to_status, reason, metadata)
       VALUES ($1, 'dunning_closed', $2, $3, $4, $5, $6)`,
      [invoiceId, wer ?? null, inv.status, neuerStatus ?? inv.status, `Mahnverfahren beendet: ${ABSCHLUSS_TEXT[art]} – ${grund}`,
        JSON.stringify({ art, grund, verworfeneMahnungen: verworfen.rows })]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { ok: true };
}

/** Falls nötig: Mahnverfahren wieder aufnehmen (z. B. Gericht/Inkasso erfolglos, Absprache geplatzt). */
export async function nimmMahnverfahrenAuf(brand: string, invoiceId: string, wer?: string): Promise<MailErgebnis> {
  await initBillingTables();
  // Prüfung G23: in einer Transaktion; bezahlte/stornierte Rechnungen nicht wieder aufnehmen.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inv = (await client.query(
      `SELECT status FROM billing_invoices WHERE id = $1 AND brand = $2 FOR UPDATE`, [invoiceId, brand])).rows[0];
    if (!inv) { await client.query('ROLLBACK'); return { ok: false, status: 404, fehler: 'Rechnung nicht gefunden.' }; }
    if (inv.status === 'paid' || inv.status === 'cancelled') {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, fehler: `Die Rechnung ist ${inv.status === 'paid' ? 'bezahlt' : 'storniert'} – nichts mehr zu mahnen.` };
    }
    const r = await client.query(`DELETE FROM billing_mahnabschluss WHERE invoice_id = $1 RETURNING art, grund`, [invoiceId]);
    if (r.rows.length === 0) { await client.query('ROLLBACK'); return { ok: false, status: 404, fehler: 'Kein beendetes Mahnverfahren zu dieser Rechnung.' }; }
    await client.query(
      `INSERT INTO billing_audit_log (invoice_id, action, actor_email, reason, metadata) VALUES ($1, 'dunning_reopened', $2, $3, $4)`,
      [invoiceId, wer ?? null, `Mahnverfahren wieder aufgenommen (vorher: ${ABSCHLUSS_TEXT[r.rows[0].art as AbschlussArt] ?? r.rows[0].art})`,
        JSON.stringify({ vorher: r.rows[0] })]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { ok: true };
}
