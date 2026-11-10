// Wiederkehrende Zeiträume eintragen oder wieder entfernen (Gerald 08.11.2026).
// Legt echte Einzelfenster an, einzelne Tage bleiben also von Hand änderbar.
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../lib/auth';
import { addFreeTimeWindow, getFreeTimeWindows, removeFreeTimeWindowsExakt } from '../../../../lib/website-db';
import { pruefeSerie, pruefeTage, serienTage, ueberschneiden } from '../../../../lib/termin-planung';

const BRAND = process.env.BRAND || 'mentolder';
const antwort = (daten: unknown, status = 200) => new Response(JSON.stringify(daten), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return antwort({ error: 'Unauthorized' }, 401);
  if (!isAdmin(session)) return antwort({ error: 'Forbidden' }, 403);
  try {
    const e = await request.json();
    // Einzelne Tage aus dem Kalender oder eine Serie nach Wochentagen.
    const fehler = Array.isArray(e.tage) ? pruefeTage(e) : pruefeSerie(e);
    if (fehler) return antwort({ error: fehler }, 400);
    const tage: string[] = Array.isArray(e.tage) ? [...new Set<string>(e.tage)].sort() : serienTage(e.von, e.bis, e.wochentage);

    if (e.entfernen === true) {
      return antwort({ entfernt: await removeFreeTimeWindowsExakt(BRAND, tage, e.winStart, e.winEnd) });
    }

    const vorhanden = await getFreeTimeWindows(BRAND, tage[0], tage[tage.length - 1]);
    let angelegt = 0;
    let uebersprungen = 0;
    for (const tag of tage) {
      if (vorhanden.some((w) => w.date === tag && ueberschneiden(w, e))) { uebersprungen++; continue; }
      await addFreeTimeWindow(BRAND, tag, e.winStart, e.winEnd);
      angelegt++;
    }
    return antwort({ angelegt, uebersprungen });
  } catch (err) {
    locals.requestLogger.error({ err }, '[time-windows/serie]');
    return antwort({ error: 'Interner Serverfehler.' }, 500);
  }
};
