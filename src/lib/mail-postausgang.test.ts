import { describe, it, expect, afterEach } from 'vitest';
import { uebersetzeMailFehler } from './mail-fehler';
import { verschluessle, entschluessle, pruefeAnmeldung } from './mail-postausgang';

const ALT = process.env.MAIL_SETTINGS_KEY;
afterEach(() => { if (ALT === undefined) delete process.env.MAIL_SETTINGS_KEY; else process.env.MAIL_SETTINGS_KEY = ALT; });

describe('uebersetzeMailFehler (K76)', () => {
  it('Anmeldung abgelehnt (535) mit Hinweis auf App-Passwort', () => {
    const f = uebersetzeMailFehler({ code: 'EAUTH', responseCode: 535, command: 'AUTH PLAIN', response: '535 5.7.8 Error: authentication failed' });
    expect(f.grund).toMatch(/Passwort abgelehnt.*App-Passwort/);
    expect(f.detail).toContain('535');
  });
  it('Server nicht erreichbar', () => {
    expect(uebersetzeMailFehler({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' }).grund).toMatch(/nicht erreichbar/);
    expect(uebersetzeMailFehler({ code: 'EDNS', message: 'getaddrinfo ENOTFOUND smtp.x' }).grund).toMatch(/nicht erreichbar/);
  });
  it('Verschlüsselung passt nicht zum Port', () => {
    expect(uebersetzeMailFehler({ code: 'ESOCKET', message: 'ssl3_get_record:wrong version number' }).grund).toMatch(/465.*587/);
  });
  it('Absender nicht erlaubt', () => {
    const f = uebersetzeMailFehler({ code: 'EENVELOPE', responseCode: 553, command: 'MAIL FROM', response: '553 5.7.1 Sender address rejected: not owned by user' });
    expect(f.grund).toMatch(/Absenderadresse nicht/);
  });
  it('Prüfung M1: Port 465 mit STARTTLS → Hinweis Verschlüsselung statt „nicht erreichbar“', () => {
    const err = { code: 'ETIMEDOUT', message: 'Greeting never received' };
    expect(uebersetzeMailFehler(err, { port: 465, sicherheit: 'starttls' }).grund).toMatch(/465.*587/);
    expect(uebersetzeMailFehler(err, { port: 587, sicherheit: 'starttls' }).grund).toMatch(/nicht erreichbar/);
  });
  it('Prüfung M7: 530 STARTTLS verlangt → Hinweis Verschlüsselung', () => {
    expect(uebersetzeMailFehler({ responseCode: 530, response: '530 5.7.0 Must issue a STARTTLS command first' }).grund).toMatch(/465.*587/);
    expect(uebersetzeMailFehler({ code: 'EAUTH', responseCode: 530, response: '530 5.7.0 Authentication required' }).grund).toMatch(/Passwort abgelehnt/);
  });
  it('Unbekanntes bleibt allgemein, mit Meldung des Servers', () => {
    const f = uebersetzeMailFehler(new Error('irgendwas'));
    expect(f.grund).toMatch(/nicht verschickt/);
    expect(f.detail).toBe('irgendwas');
  });
});

describe('Passwort verschlüsselt (K80, K82)', () => {
  it('hin und zurück, Klartext steht nicht im gespeicherten Wert', () => {
    process.env.MAIL_SETTINGS_KEY = 'a'.repeat(64);
    const v = verschluessle('geheim-ÄÖÜ ß!');
    expect(v).not.toContain('geheim');
    expect(entschluessle(v)).toBe('geheim-ÄÖÜ ß!');
    expect(verschluessle('geheim-ÄÖÜ ß!')).not.toBe(v);
  });
  it('anderer Schlüssel oder kein Schlüssel: nicht lesbar', () => {
    process.env.MAIL_SETTINGS_KEY = 'a'.repeat(64);
    const v = verschluessle('geheim');
    process.env.MAIL_SETTINGS_KEY = 'b'.repeat(64);
    expect(entschluessle(v)).toBeNull();
    delete process.env.MAIL_SETTINGS_KEY;
    expect(entschluessle(v)).toBeNull();
    process.env.MAIL_SETTINGS_KEY = 'a'.repeat(64);
    expect(entschluessle('kaputt')).toBeNull();
  });
});

describe('pruefeAnmeldung (K74)', () => {
  it('nicht erreichbarer Server: verständlicher Grund', async () => {
    const r = await pruefeAnmeldung({ host: '127.0.0.1', port: 1, sicherheit: 'starttls', benutzer: 'x@y.de', passwort: 'p' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.grund).toMatch(/nicht erreichbar/);
  }, 20_000);
});
