// Nachtrag Stufe 4 (K102, K103, K105): Notiz oder Dokument anlegen, Eintrag zurückziehen. Nur Admins.
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../lib/auth';
import { getKlient } from '../../../../lib/klientenakte';
import { holeAngebot } from '../../../../lib/billing-angebot';
import { legeEintragAn, zieheZurueck, holeEintrag, dateiAusFormular, WEG_TEXT, istWeg } from '../../../../lib/akte-dokumente';
import { protokolliere } from '../../../../lib/akte-protokoll';

// Rücksprung nur in die Akte oder auf eine Angebotsseite.
const ZURUECK = /^\/admin\/(klienten|angebote)\/[0-9a-f-]{36}$/i;

export const POST: APIRoute = async ({ request, redirect }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });
  const brand = process.env.BRAND || 'mentolder';
  // Prüfung D6: übergroße Uploads gar nicht erst einlesen.
  if (Number(request.headers.get('content-length') ?? 0) > 16 * 1024 * 1024) return new Response('Die Datei ist größer als 15 MB.', { status: 413 });
  let form: FormData;
  try { form = await request.formData(); } catch { return new Response('Ungültiges Formular', { status: 400 }); }
  const text = (k: string) => String(form.get(k) ?? '');
  const zurueckRoh = text('zurueck');
  const ziel = (hinweis: string) => `${ZURUECK.test(zurueckRoh) ? zurueckRoh : '/admin/klienten'}?${hinweis}#notizen`;

  if (text('aktion') === 'zurueckziehen') {
    const e = await holeEintrag(brand, text('id'));
    if (!e) return new Response('Eintrag nicht gefunden', { status: 404 });
    // K148 (Handtest 29.10.2026, H20): Antwort-Vermerke nur über „Vermerk korrigieren“ auf der Angebotsseite.
    if (e.angebotId && (e.art === 'annahme' || e.art === 'ablehnung')) {
      return redirect(ziel(`eintragFehler=${encodeURIComponent('Annahme und Ablehnung bitte auf der Angebotsseite über „Vermerk korrigieren“ ändern.')}`), 303);
    }
    const ok = await zieheZurueck(brand, e.id, session.email, text('grund'));
    if (ok) await protokolliere(brand, session.email, { bereich: e.angebotId ? 'angebot' : 'stammdaten', aktion: 'Notiz/Dokument zurückgezogen', klientId: e.klientId,
      objekt: e.dateiName ?? e.notiz?.slice(0, 80) ?? null, beschreibung: text('grund').trim() || null });
    return redirect(ziel(ok ? 'eintragGespeichert=1' : `eintragFehler=${encodeURIComponent('Der Eintrag war schon zurückgezogen.')}`), 303);
  }

  const klient = await getKlient(text('klientId'));
  if (!klient) return new Response('Klient nicht gefunden', { status: 404 });
  const angebotId = text('angebotId') || null;
  const angebot = angebotId ? await holeAngebot(brand, angebotId) : null;
  if (angebotId && (!angebot || angebot.klientId !== klient.id)) return new Response('Angebot nicht gefunden', { status: 404 });
  const datei = await dateiAusFormular(form.get('datei'));
  const r = await legeEintragAn(brand, {
    klientId: klient.id, angebotId, art: 'notiz', weg: text('weg'), datum: text('datum'), notiz: text('notiz'), datei,
  }, session.email);
  if (!r.ok) return redirect(ziel(`eintragFehler=${encodeURIComponent(r.fehler)}`), 303);
  await protokolliere(brand, session.email, {
    bereich: angebot ? 'angebot' : 'stammdaten', aktion: datei ? 'Dokument abgelegt' : 'Notiz angelegt', klientId: klient.id,
    objekt: angebot?.number ?? datei?.name ?? null,
    nachher: { datum: text('datum'), weg: istWeg(text('weg')) ? WEG_TEXT[text('weg') as keyof typeof WEG_TEXT] : null, notiz: text('notiz').trim().slice(0, 200), datei: datei?.name },
  });
  return redirect(ziel('eintragGespeichert=1'), 303);
};
