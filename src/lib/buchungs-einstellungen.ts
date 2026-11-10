// Einstellungen des Erstgesprächs unter Einstellungen → Buchungsregeln (10.11.2026).
import { getSiteSetting, setSiteSetting } from './website-core-db';

export interface ErstgespraechEinstellung {
  online: boolean;
  vorOrt: boolean;
  /** An: Der Termin ist sofort gebucht. Aus: Anfrage im Postfach. */
  sofort: boolean;
}

export const ERSTGESPRAECH_VORGABE: ErstgespraechEinstellung = { online: true, vorOrt: true, sofort: false };

export async function ladeErstgespraech(brand: string): Promise<ErstgespraechEinstellung> {
  const [online, vorOrt, sofort] = await Promise.all([
    getSiteSetting(brand, 'erstgespraech_online'),
    getSiteSetting(brand, 'erstgespraech_vor_ort'),
    getSiteSetting(brand, 'erstgespraech_sofort'),
  ]);
  return {
    online: online === null || online === undefined ? ERSTGESPRAECH_VORGABE.online : online === 'true',
    vorOrt: vorOrt === null || vorOrt === undefined ? ERSTGESPRAECH_VORGABE.vorOrt : vorOrt === 'true',
    sofort: sofort === 'true',
  };
}

export async function speichereErstgespraech(brand: string, w: ErstgespraechEinstellung): Promise<void> {
  await Promise.all([
    setSiteSetting(brand, 'erstgespraech_online', String(w.online)),
    setSiteSetting(brand, 'erstgespraech_vor_ort', String(w.vorOrt)),
    setSiteSetting(brand, 'erstgespraech_sofort', String(w.sofort)),
  ]);
}

/**
 * Welcher Ort gilt für eine Buchung? Ist nur einer angeboten, gilt er ohne Rückfrage.
 * `undefined` heißt: Die Angabe des Kunden passt nicht zum Angebot.
 */
export function ortFuerBuchung(e: Pick<ErstgespraechEinstellung, 'online' | 'vorOrt'>, gewuenscht: unknown): string | null | undefined {
  if (e.online && !e.vorOrt) return 'online';
  if (e.vorOrt && !e.online) return 'vor-ort';
  if (gewuenscht === 'online' || gewuenscht === 'vor-ort') return gewuenscht;
  if (gewuenscht === null || gewuenscht === undefined || gewuenscht === '') return null;
  return undefined;
}
