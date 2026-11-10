// Pausen zwischen Terminen und Feiertage speichern (Gerald 08.11.2026). Nur Admins.
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../lib/auth';
import { saveBookingBuffers, saveHolidays } from '../../../../lib/website-core-db';
import { MAX_BUFFER_MIN } from '../../../../lib/business-settings';
import { leseFeiertage } from '../../../../lib/termin-planung';
import { speichereErstgespraech } from '../../../../lib/buchungs-einstellungen';

const BRAND = process.env.BRAND || 'mentolder';

export const POST: APIRoute = async ({ request, redirect }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });

  const form = await request.formData();
  const zurueck = (fehler: string) => redirect(`/admin/einstellungen/termine?fehler=${encodeURIComponent(fehler)}`, 303);
  const minuten = (name: string) => Number(String(form.get(name) ?? '0').trim() || '0');
  const preMin = minuten('pause_vor');
  const postMin = minuten('pause_nach');
  for (const m of [preMin, postMin]) {
    if (!Number.isInteger(m) || m < 0 || m > MAX_BUFFER_MIN) return zurueck(`Pausen bitte als ganze Minuten von 0 bis ${MAX_BUFFER_MIN} angeben.`);
  }
  const erst = {
    online: form.get('erstgespraech_online') === 'true',
    vorOrt: form.get('erstgespraech_vor_ort') === 'true',
    telefon: form.get('erstgespraech_telefon') === 'true',
    sofort: form.get('erstgespraech_sofort') === 'true',
  };
  if (!erst.online && !erst.vorOrt && !erst.telefon) return zurueck('Bitte mindestens eine Art anbieten: online, vor Ort oder telefonisch.');
  const feiertage = leseFeiertage(String(form.get('feiertage') ?? ''));
  if (feiertage.fehler) return zurueck(feiertage.fehler);

  await Promise.all([saveBookingBuffers(BRAND, { preMin, postMin }), saveHolidays(BRAND, feiertage.werte), speichereErstgespraech(BRAND, erst)]);
  return redirect('/admin/einstellungen/termine?saved=1', 303);
};
