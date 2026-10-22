// Rechnungswesen Stufe 4, T13/T14 (AE9, AE13): Klienten ohne E-Mail und Versand ohne E-Mail.
// customers.email ist in der Datenbank Pflicht und eindeutig. Klienten ohne E-Mail bekommen
// deshalb eine interne Platzhalteradresse unter der reservierten Endung .invalid (RFC 2606),
// an die nie etwas zugestellt werden kann. hatEchteEmail() entscheidet überall, ob es eine
// richtige Adresse ist. Leaf-Modul ohne Datenbank.
import { randomUUID } from 'node:crypto';

const PLATZHALTER_DOMAIN = '@mentolder.invalid';

export function platzhalterEmail(): string {
  return `ohne-email-${randomUUID().replace(/-/g, '').slice(0, 12)}${PLATZHALTER_DOMAIN}`;
}

export function hatEchteEmail(email: string | null | undefined): boolean {
  const e = (email ?? '').trim().toLowerCase();
  return e !== '' && !e.endsWith('.invalid');
}

/** Für Anzeigen: der Platzhalter erscheint nie, stattdessen „keine E-Mail“. */
export function anzeigeEmail(email: string | null | undefined): string {
  return hatEchteEmail(email) ? (email as string) : 'keine E-Mail';
}

export type Versandweg = 'email' | 'post';

/** K58, K59: mit E-Mail beide Wege, ohne nur „ohne E-Mail (Post/persönlich)“. */
export function versandwege(email: string | null | undefined): Versandweg[] {
  return hatEchteEmail(email) ? ['email', 'post'] : ['post'];
}

/** Gewählten Versandweg prüfen; ohne Angabe E-Mail, wenn möglich, sonst Post. */
export function pruefeVersandweg(roh: unknown, email: string | null | undefined): { weg: Versandweg; fehler: string | null } {
  const moeglich = versandwege(email);
  if (roh === undefined || roh === null || roh === '') return { weg: moeglich[0], fehler: null };
  if (roh !== 'email' && roh !== 'post') return { weg: moeglich[0], fehler: 'Bitte als Versand E-Mail oder Post wählen.' };
  if (!moeglich.includes(roh)) return { weg: 'post', fehler: 'Dieser Empfänger hat keine E-Mail-Adresse. Bitte „ohne E-Mail (Post/persönlich)“ wählen.' };
  return { weg: roh, fehler: null };
}

export const VERSANDWEG_TEXT: Record<Versandweg, string> = { email: 'per E-Mail', post: 'per Post/persönlich' };
