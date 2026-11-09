// Freie Zeiträume eines Abschnitts für den Kalender im Admin (Gerald 09.11.2026).
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../lib/auth';
import { getFreeTimeWindows } from '../../../../lib/website-db';
import { istEchterTag } from '../../../../lib/termin-planung';

const BRAND = process.env.BRAND || 'mentolder';
const antwort = (daten: unknown, status = 200) => new Response(JSON.stringify(daten), { status, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ request, url, locals }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return antwort({ error: 'Unauthorized' }, 401);
  if (!isAdmin(session)) return antwort({ error: 'Forbidden' }, 403);
  const von = url.searchParams.get('von');
  const bis = url.searchParams.get('bis');
  if (!istEchterTag(von) || !istEchterTag(bis)) return antwort({ error: 'von und bis sind Pflicht.' }, 400);
  try {
    return antwort(await getFreeTimeWindows(BRAND, von, bis));
  } catch (err) {
    locals.requestLogger.error({ err }, '[time-windows]');
    return antwort({ error: 'Interner Serverfehler.' }, 500);
  }
};
