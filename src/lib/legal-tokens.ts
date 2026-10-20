import type { Stammdaten } from './website-db';

export const STAMMDATEN_FIELDS: (keyof Stammdaten)[] =
  ['name', 'role', 'email', 'phone', 'street', 'zip', 'city', 'ustId', 'website', 'avatarInitials'];

export const STAMMDATEN_TOKENS = STAMMDATEN_FIELDS.map((f) => `{{stammdaten.${f}}}`);

const TOKEN_RE = /\{\{\s*stammdaten\.([a-zA-Z]+)\s*\}\}/g;

export function resolveTokens(html: string, sd: Partial<Stammdaten>): string {
  return html.replace(TOKEN_RE, (_m, key: string) => String(sd[key as keyof Stammdaten] ?? ''));
}

// Rechnungswesen Stufe 3 T2: Werte aus Einstellungen → Regeln / Rechnungen (K37, K38).
// Bewusst ohne Datenbank-Import, weil der Admin-Editor diese Datei im Browser lädt.
export const REGEL_TOKENS = ['{{regeln.ausfallFrist}}', '{{regeln.ausfallHoehe}}', '{{regeln.zahlungsziel}}'];

export interface RegelTokenWerte { ausfallFrist: string; ausfallHoehe: string; zahlungsziel: string }

const REGEL_TOKEN_RE = /\{\{\s*regeln\.([a-zA-Z]+)\s*\}\}/g;

export function resolveRegelTokens(html: string, werte: RegelTokenWerte): string {
  return html.replace(REGEL_TOKEN_RE, (m, key: string) =>
    key in werte ? werte[key as keyof RegelTokenWerte] : m);
}

export function proposeRetokenize(html: string, sd: Partial<Stammdaten>): { result: string; replacements: { from: string; to: string }[] } {
  const replacements: { from: string; to: string }[] = [];
  let result = html;
  // Process longest values first to avoid partial overlaps
  const entries = STAMMDATEN_FIELDS
    .map((f) => ({ field: f, value: sd[f] as string }))
    .filter((e) => e.value && e.value.length > 2)
    .sort((a, b) => b.value.length - a.value.length);
  for (const { field, value } of entries) {
    const token = `{{stammdaten.${field}}}`;
    if (result.includes(value)) {
      replacements.push({ from: value, to: token });
      result = result.replaceAll(value, token);
    }
  }
  return { result, replacements };
}
