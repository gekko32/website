// Sagt ein Kunde ab oder bucht um, wird die alte Zeit im Kalender wieder frei (08.11.2026).
import { deleteCalendarEvent } from './caldav';
import { logger } from './logger';

/** Entfernt den Kalendereintrag der Buchung. Rückgabe: Hinweistext für die Mail an den Admin. */
export async function kalenderHinweis(payload: Record<string, unknown> | undefined): Promise<string> {
  const uid = payload?.caldavUid;
  if (typeof uid !== 'string' || uid === '') return '';
  const entfernt = await deleteCalendarEvent(uid).catch(() => false);
  if (entfernt) return '';
  logger.warn({ uid }, '[termin-freigeben] Kalendereintrag nicht entfernt');
  return 'ACHTUNG: Der Kalendereintrag konnte nicht entfernt werden. Bitte in Nextcloud von Hand löschen.\n\n';
}
