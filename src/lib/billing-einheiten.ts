// Einheitenliste (Stunde, Tag, Vortrag …) für Positionen und Sitzungen. Gerald pflegt sie unter
// Einstellungen → Regeln; in den Formularen erscheint sie als Auswahl, eigene Eingaben bleiben möglich.
import { getSiteSetting, setSiteSetting } from './website-db';

export const EINHEITEN_STANDARD = ['Stunde', 'Tag', 'Halbtag', 'Session', 'Vortrag', 'Workshop', 'Pauschal', 'Stück', 'km'];
const KEY = 'einheiten_liste';

export function einheitenAusText(text: string): string[] {
  const gesehen = new Set<string>();
  const liste: string[] = [];
  for (const zeile of text.split(/\r?\n/)) {
    const e = zeile.trim();
    if (e === '' || gesehen.has(e.toLowerCase())) continue;
    gesehen.add(e.toLowerCase());
    liste.push(e);
  }
  return liste;
}

export function pruefeEinheiten(text: string): { werte: string[] | null; fehler: string | null } {
  const werte = einheitenAusText(text);
  if (werte.length === 0) return { werte: null, fehler: 'Bitte mindestens eine Einheit eintragen.' };
  if (werte.length > 50) return { werte: null, fehler: 'Höchstens 50 Einheiten.' };
  if (werte.some((e) => e.length > 40)) return { werte: null, fehler: 'Eine Einheit darf höchstens 40 Zeichen haben.' };
  return { werte, fehler: null };
}

export async function ladeEinheiten(brand: string): Promise<string[]> {
  try {
    const roh = await getSiteSetting(brand, KEY);
    return roh ? (pruefeEinheiten(roh).werte ?? EINHEITEN_STANDARD) : EINHEITEN_STANDARD;
  } catch {
    return EINHEITEN_STANDARD;
  }
}

export async function speichereEinheiten(brand: string, werte: string[]): Promise<void> {
  await setSiteSetting(brand, KEY, werte.join('\n'));
}
