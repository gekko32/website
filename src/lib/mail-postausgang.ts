// E-Mail-Versand im Adminbereich (Spezifikation SPEZ-EMAIL-VERSAND, K71–K82).
// Gerald stellt den Postausgang (Anbieter, Server, Benutzername, App-Passwort) selbst ein.
// Das Passwort liegt mit AES-256-GCM verschlüsselt in der Datenbank; der Schlüssel kommt aus
// MAIL_SETTINGS_KEY auf dem Server (E1). Ohne Eintrag, ohne Schlüssel oder wenn das Passwort
// sich nicht mehr entschlüsseln lässt, gilt die Server-Einstellung (SMTP_HOST …) wie bisher.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { pool, ensureSchemaOnce } from './db-pool';
import { uebersetzeMailFehler, type MailFehler } from './mail-fehler';

export type Sicherheit = 'starttls' | 'ssl';

export interface Postausgang {
  host: string; port: number; sicherheit: Sicherheit; benutzer: string; passwort: string;
}

export interface Anbieter { key: string; name: string; host: string; port: number; sicherheit: Sicherheit }

/** K71: Vorlagen; Server, Port und Verschlüsselung bleiben änderbar. */
export const ANBIETER: Anbieter[] = [
  { key: 'mailbox', name: 'mailbox.org', host: 'smtp.mailbox.org', port: 587, sicherheit: 'starttls' },
  { key: 'posteo', name: 'Posteo', host: 'posteo.de', port: 587, sicherheit: 'starttls' },
  { key: 'ionos', name: 'IONOS', host: 'smtp.ionos.de', port: 587, sicherheit: 'starttls' },
  { key: 'strato', name: 'Strato', host: 'smtp.strato.de', port: 465, sicherheit: 'ssl' },
  { key: 'anderer', name: 'Anderer Anbieter', host: '', port: 587, sicherheit: 'starttls' },
];

export const schluesselVorhanden = () => !!process.env.MAIL_SETTINGS_KEY;
const schluessel = () => createHash('sha256').update(process.env.MAIL_SETTINGS_KEY ?? '').digest();

export function verschluessle(klartext: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', schluessel(), iv);
  const ct = Buffer.concat([c.update(klartext, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join('.');
}

/** null, wenn der Schlüssel fehlt oder nicht passt (K82). */
export function entschluessle(wert: string): string | null {
  if (!schluesselVorhanden()) return null;
  const [v, iv, tag, ct] = wert.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', schluessel(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export async function initPostausgangTabellen(): Promise<void> {
  return ensureSchemaOnce('mail_postausgang', async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mail_postausgang (
        brand TEXT PRIMARY KEY,
        anbieter TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
        sicherheit TEXT NOT NULL CHECK (sicherheit IN ('starttls','ssl')),
        benutzer TEXT NOT NULL,
        passwort_enc TEXT NOT NULL,
        passwort_am TIMESTAMPTZ NOT NULL DEFAULT now(),
        geaendert_am TIMESTAMPTZ NOT NULL DEFAULT now(),
        geaendert_von TEXT
      );
      CREATE TABLE IF NOT EXISTS mail_postausgang_verlauf (
        id BIGSERIAL PRIMARY KEY,
        brand TEXT NOT NULL,
        am TIMESTAMPTZ NOT NULL DEFAULT now(),
        wer TEXT,
        aktion TEXT NOT NULL,
        host TEXT,
        benutzer TEXT
      );`);
  });
}

export interface PostausgangStand {
  quelle: 'admin' | 'server';
  /** Gesetzt, wenn ein Eintrag existiert, aber nicht nutzbar ist (K82). */
  hinweis: string | null;
  postausgang: Postausgang | null;
  anbieter: string | null;
  passwortAm: string | null;
  geaendertAm: string | null;
  /** Es gibt einen gespeicherten Eintrag (auch wenn er gerade nicht nutzbar ist, K82 / Prüfung M4). */
  eintrag: { anbieter: string; host: string; port: number; sicherheit: Sicherheit; benutzer: string } | null;
  /** Für den Absender (E3): Benutzername des gültigen Postfachs. */
  benutzer: string;
  host: string;
}

interface GespeicherteZeile { anbieter: string; host: string; port: number | string; sicherheit: Sicherheit; benutzer: string; geaendert_am: string }

const serverStand = (hinweis: string | null, r?: GespeicherteZeile): PostausgangStand => ({
  quelle: 'server', hinweis, postausgang: null, anbieter: r?.anbieter ?? null, passwortAm: null, geaendertAm: r?.geaendert_am ?? null,
  eintrag: r ? { anbieter: r.anbieter, host: r.host, port: Number(r.port), sicherheit: r.sicherheit, benutzer: r.benutzer } : null,
  benutzer: process.env.SMTP_USER || '', host: process.env.SMTP_HOST || '',
});

/** Gültiger Postausgang: hier eingestellt, sonst Server-Einstellung (K79, K82). Eine Abfrage, nie halb. */
export async function ladePostausgang(brand: string): Promise<PostausgangStand> {
  await initPostausgangTabellen();
  const r = (await pool.query(
    `SELECT anbieter, host, port, sicherheit, benutzer, passwort_enc, passwort_am::text AS passwort_am, geaendert_am::text AS geaendert_am
       FROM mail_postausgang WHERE brand = $1`, [brand])).rows[0];
  if (!r) return serverStand(null);
  if (!schluesselVorhanden()) return serverStand('Auf dem Server fehlt der Schlüssel MAIL_SETTINGS_KEY. Bis er eingerichtet ist, gilt die Server-Einstellung.', r);
  const passwort = entschluessle(r.passwort_enc);
  if (passwort === null) return serverStand('Das gespeicherte Passwort lässt sich nicht mehr entschlüsseln (Schlüssel auf dem Server geändert). Bitte Passwort neu eintragen; bis dahin gilt die Server-Einstellung.', r);
  return {
    quelle: 'admin', hinweis: null, anbieter: r.anbieter, passwortAm: r.passwort_am, geaendertAm: r.geaendert_am,
    eintrag: { anbieter: r.anbieter, host: r.host, port: Number(r.port), sicherheit: r.sicherheit, benutzer: r.benutzer },
    postausgang: { host: r.host, port: Number(r.port), sicherheit: r.sicherheit, benutzer: r.benutzer, passwort },
    benutzer: r.benutzer, host: r.host,
  };
}

export function transportOptionen(p: Postausgang) {
  return {
    host: p.host, port: p.port, secure: p.sicherheit === 'ssl', requireTLS: p.sicherheit === 'starttls',
    connectionTimeout: 8_000, greetingTimeout: 8_000, socketTimeout: 15_000,
    auth: { user: p.benutzer, pass: p.passwort },
  };
}

/** K74: Anmeldung beim Mail-Server, ohne eine Mail zu schicken. */
export async function pruefeAnmeldung(p: Postausgang): Promise<{ ok: true } | ({ ok: false } & MailFehler)> {
  const t = nodemailer.createTransport(transportOptionen(p));
  try {
    await t.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, ...uebersetzeMailFehler(err, p) };
  } finally {
    t.close();
  }
}

export interface PostausgangEingabe {
  anbieter?: string; host?: string; port?: number | string; sicherheit?: string; benutzer?: string; passwort?: string;
}

export type SpeicherErgebnis = { ok: true } | { ok: false; status: number; grund: string; detail?: string };

const verlauf = (brand: string, wer: string | undefined, aktion: string, host: string | null, benutzer: string | null) =>
  pool.query('INSERT INTO mail_postausgang_verlauf (brand, wer, aktion, host, benutzer) VALUES ($1,$2,$3,$4,$5)',
    [brand, wer ?? null, aktion, host, benutzer]);

/** K73, K74, K81: prüfen, anmelden, erst dann speichern. Leeres Passwort = bisheriges behalten. */
export async function speicherePostausgang(
  brand: string, e: PostausgangEingabe, wer?: string,
  anmelden: (p: Postausgang) => ReturnType<typeof pruefeAnmeldung> = pruefeAnmeldung,
): Promise<SpeicherErgebnis> {
  if (!schluesselVorhanden()) return { ok: false, status: 409, grund: 'Auf dem Server fehlt der Schlüssel MAIL_SETTINGS_KEY. Ohne ihn lässt sich kein Passwort sicher speichern.' };
  const anbieter = ANBIETER.find((a) => a.key === e.anbieter)?.key ?? 'anderer';
  const host = (e.host ?? '').trim().toLowerCase();
  const port = Number(e.port);
  const sicherheit = e.sicherheit === 'ssl' ? 'ssl' : e.sicherheit === 'starttls' ? 'starttls' : null;
  const benutzer = (e.benutzer ?? '').trim();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return { ok: false, status: 400, grund: 'Bitte den Mail-Server eintragen (z. B. smtp.mailbox.org).' };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, status: 400, grund: 'Bitte einen gültigen Port eintragen (meist 587 oder 465).' };
  if (!sicherheit) return { ok: false, status: 400, grund: 'Bitte die Verschlüsselung wählen.' };
  if (!benutzer) return { ok: false, status: 400, grund: 'Bitte den Benutzernamen eintragen (meist die E-Mail-Adresse des Postfachs).' };

  await initPostausgangTabellen();
  let passwort = (e.passwort ?? '').trim();
  if (!passwort) {
    const alt = (await pool.query('SELECT passwort_enc FROM mail_postausgang WHERE brand = $1', [brand])).rows[0];
    const altKlar = alt ? entschluessle(alt.passwort_enc) : null;
    if (!altKlar) return { ok: false, status: 400, grund: 'Bitte das Passwort eintragen.' };
    passwort = altKlar;
  }
  const p: Postausgang = { host, port, sicherheit, benutzer, passwort };
  const a = await anmelden(p);
  if (!a.ok) return { ok: false, status: 422, grund: `Nicht gespeichert: ${a.grund}`, detail: a.detail };

  const neuesPasswort = !!(e.passwort ?? '').trim();
  await pool.query(
    `INSERT INTO mail_postausgang (brand, anbieter, host, port, sicherheit, benutzer, passwort_enc, passwort_am, geaendert_am, geaendert_von)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now(), $8)
     ON CONFLICT (brand) DO UPDATE SET anbieter = EXCLUDED.anbieter, host = EXCLUDED.host, port = EXCLUDED.port,
       sicherheit = EXCLUDED.sicherheit, benutzer = EXCLUDED.benutzer, passwort_enc = EXCLUDED.passwort_enc,
       passwort_am = CASE WHEN $9 THEN now() ELSE mail_postausgang.passwort_am END,
       geaendert_am = now(), geaendert_von = EXCLUDED.geaendert_von`,
    [brand, anbieter, host, port, sicherheit, benutzer, verschluessle(passwort), wer ?? null, neuesPasswort]);
  await verlauf(brand, wer, neuesPasswort ? 'gespeichert (neues Passwort)' : 'gespeichert', host, benutzer);
  return { ok: true };
}

/** K81 (Prüfung M3): auch Änderungen am Absender kommen in den Verlauf. */
export async function vermerkeAbsender(brand: string, wer: string | undefined, name: string, adresse: string): Promise<void> {
  await initPostausgangTabellen();
  await verlauf(brand, wer, `Absender geändert: ${name} <${adresse || 'Benutzername des Postfachs'}>`, null, null);
}

/** K79: zurück zur Server-Einstellung. */
export async function loeschePostausgang(brand: string, wer?: string): Promise<void> {
  await initPostausgangTabellen();
  await pool.query('DELETE FROM mail_postausgang WHERE brand = $1', [brand]);
  await verlauf(brand, wer, 'zurück zur Server-Einstellung', process.env.SMTP_HOST || null, process.env.SMTP_USER || null);
}

export async function letzteAenderungen(brand: string, anzahl = 10) {
  await initPostausgangTabellen();
  return (await pool.query(
    `SELECT am::text AS am, wer, aktion, host, benutzer FROM mail_postausgang_verlauf WHERE brand = $1 ORDER BY am DESC, id DESC LIMIT $2`,
    [brand, anzahl])).rows as { am: string; wer: string | null; aktion: string; host: string | null; benutzer: string | null }[];
}
