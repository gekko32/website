// Reine Hilfen für die Terminplanung (08.11.2026): wiederkehrende Zeiträume und Feiertage.

export const MAX_SERIE_TAGE = 370;

const tagAlsUtc = (key: string): number => Date.parse(`${key}T00:00:00Z`);
const utcAlsTag = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const TAG_MS = 86_400_000;

export function istEchterTag(key: unknown): key is string {
  return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key)
    && !Number.isNaN(tagAlsUtc(key)) && utcAlsTag(tagAlsUtc(key)) === key;
}

/** Alle Tage von `von` bis `bis` an den Wochentagen 1 (Montag) bis 7 (Sonntag). */
export function serienTage(von: string, bis: string, wochentage: number[]): string[] {
  const tage: string[] = [];
  for (let t = tagAlsUtc(von); t <= tagAlsUtc(bis); t += TAG_MS) {
    const iso = new Date(t).getUTCDay() || 7;
    if (wochentage.includes(iso)) tage.push(utcAlsTag(t));
  }
  return tage;
}

/** Berührende Zeiträume (10–12 und 12–14) gelten nicht als Überschneidung. */
export function ueberschneiden(
  a: { winStart: string; winEnd: string },
  b: { winStart: string; winEnd: string },
): boolean {
  return a.winStart < b.winEnd && b.winStart < a.winEnd;
}

export function pruefeSerie(e: { von?: unknown; bis?: unknown; wochentage?: unknown; winStart?: unknown; winEnd?: unknown }): string | null {
  if (!istEchterTag(e.von) || !istEchterTag(e.bis)) return 'Bitte Start- und Enddatum angeben.';
  if (e.bis < e.von) return 'Das Enddatum liegt vor dem Startdatum.';
  if ((tagAlsUtc(e.bis) - tagAlsUtc(e.von)) / TAG_MS > MAX_SERIE_TAGE) return 'Eine Serie darf höchstens ein Jahr umfassen.';
  if (!Array.isArray(e.wochentage) || e.wochentage.length === 0 || !e.wochentage.every((w) => Number.isInteger(w) && w >= 1 && w <= 7)) {
    return 'Bitte mindestens einen Wochentag auswählen.';
  }
  const zeit = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (typeof e.winStart !== 'string' || typeof e.winEnd !== 'string' || !zeit.test(e.winStart) || !zeit.test(e.winEnd)) {
    return 'Bitte Von und Bis als Uhrzeit angeben.';
  }
  if (e.winStart >= e.winEnd) return 'Von muss vor Bis liegen.';
  return null;
}

/** Eine Zeile je Tag, als 24.12.2026 oder 2026-12-24. */
export function leseFeiertage(text: string): { werte: string[]; fehler: string | null } {
  const werte = new Set<string>();
  for (const roh of text.split(/\r?\n/)) {
    const z = roh.trim();
    if (!z) continue;
    const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(z);
    const key = de ? `${de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}` : z;
    if (!istEchterTag(key)) return { werte: [], fehler: `„${z}“ ist kein gültiges Datum.` };
    werte.add(key);
  }
  return { werte: [...werte].sort(), fehler: null };
}

export function feiertagDeutsch(key: string): string {
  const [j, m, t] = key.split('-');
  return `${t}.${m}.${j}`;
}

/** Ostersonntag nach dem gregorianischen Kalender (Meeus/Jones/Butcher). */
function ostersonntag(jahr: number): number {
  const a = jahr % 19, b = Math.floor(jahr / 100), c = jahr % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(jahr, monat - 1, tag);
}

/** Die neun Feiertage, die in ganz Deutschland gelten. */
export function bundesweiteFeiertage(jahr: number): string[] {
  const ostern = ostersonntag(jahr);
  const fest = (m: number, t: number) => utcAlsTag(Date.UTC(jahr, m - 1, t));
  const beweglich = (abstand: number) => utcAlsTag(ostern + abstand * TAG_MS);
  return [
    fest(1, 1), beweglich(-2), beweglich(1), fest(5, 1), beweglich(39), beweglich(50),
    fest(10, 3), fest(12, 25), fest(12, 26),
  ].sort();
}
