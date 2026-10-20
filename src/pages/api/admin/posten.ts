// Rechnungswesen Stufe 3, T5: Sitzung von Hand erfassen, „nicht abrechnen“ umschalten
// (K11, K14). Nur Admins (K43).
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../lib/auth';
import { getKlient } from '../../../lib/klientenakte';
import { holeLeistung } from '../../../lib/billing-leistungen';
import { klientDesPostens, legeSitzungAn, pruefePreis, pruefeSitzung, setzeAbrechnen, setzePostenPreis } from '../../../lib/billing-posten';

export const POST: APIRoute = async ({ request, redirect }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });

  const brand = process.env.BRAND || 'mentolder';
  const form = await request.formData();
  const text = (k: string) => String(form.get(k) ?? '');
  const aktion = text('aktion');

  if (aktion === 'nicht_abrechnen' || aktion === 'abrechnen') {
    const postenId = text('postenId');
    if (!/^[0-9a-f-]{36}$/i.test(postenId)) return new Response('Posten nicht gefunden', { status: 404 });
    const klientId = await klientDesPostens(brand, postenId);
    if (!klientId) return new Response('Posten nicht gefunden', { status: 404 });
    const ok = await setzeAbrechnen(brand, postenId, aktion === 'abrechnen');
    const hinweis = ok ? 'gespeichert=1' : `fehler=${encodeURIComponent('Dieser Posten steht schon auf einer Rechnung und lässt sich hier nicht ändern.')}`;
    return redirect(`/admin/klienten/${klientId}?${hinweis}#abrechnung`, 303);
  }

  if (aktion === 'preis') {
    const postenId = text('postenId');
    if (!/^[0-9a-f-]{36}$/i.test(postenId)) return new Response('Posten nicht gefunden', { status: 404 });
    const klientId = await klientDesPostens(brand, postenId);
    if (!klientId) return new Response('Posten nicht gefunden', { status: 404 });
    const preis = pruefePreis(text('preis'));
    if (preis === null) {
      return redirect(`/admin/klienten/${klientId}?fehler=${encodeURIComponent('Bitte einen Preis ab 0 mit höchstens zwei Nachkommastellen eintragen.')}#abrechnung`, 303);
    }
    const ok = await setzePostenPreis(brand, postenId, preis);
    const hinweis = ok ? 'gespeichert=1' : `fehler=${encodeURIComponent('Dieser Posten steht schon auf einer Rechnung und lässt sich hier nicht ändern.')}`;
    return redirect(`/admin/klienten/${klientId}?${hinweis}#abrechnung`, 303);
  }

  if (aktion !== 'sitzung') return new Response('Unbekannte Aktion', { status: 400 });

  const klient = await getKlient(text('klientId'));
  if (!klient) return new Response('Klient nicht gefunden', { status: 404 });

  const eingabe = {
    datum: text('datum'), leistungKey: text('leistungKey'), menge: text('menge'),
    preis: text('preis'), text: text('text'), nichtAbrechnen: form.get('nichtAbrechnen') === 'on',
  };
  const leistung = eingabe.leistungKey ? await holeLeistung(brand, eingabe.leistungKey) : null;
  const { werte, fehler } = pruefeSitzung(eingabe, leistung);
  if (!werte) {
    const params = new URLSearchParams({ sitzungFehler: JSON.stringify(fehler), sitzungEingabe: JSON.stringify(eingabe) });
    return redirect(`/admin/klienten/${klient.id}?${params.toString()}#abrechnung`, 303);
  }
  await legeSitzungAn(brand, klient.id, werte);
  return redirect(`/admin/klienten/${klient.id}?gespeichert=1#abrechnung`, 303);
};
