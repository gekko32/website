// Rechnungswesen Stufe 3, T5: Sitzung von Hand erfassen, „nicht abrechnen“ umschalten
// (K11, K14). Nur Admins (K43).
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../lib/auth';
import { getKlient } from '../../../lib/klientenakte';
import { holeLeistung } from '../../../lib/billing-leistungen';
import {
  aenderePosition, klientDesAuftrags, klientDesPostens, legeAuftragAn, legePositionAn, legeSitzungAn,
  pruefeAuftragTitel, pruefePosition, pruefePreis, pruefeSitzung, setzeAbrechnen, setzePostenPreis,
} from '../../../lib/billing-posten';
import { erlasseAusfall, vermerkeAbsage } from '../../../lib/billing-ausfall';

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

  // T9: Absage eines gebuchten Termins vermerken (AE8) und Ausfallhonorar erlassen (K20)
  if (aktion === 'absage') {
    const klient = await getKlient(text('klientId'));
    if (!klient) return new Response('Klient nicht gefunden', { status: 404 });
    const von = text('von');
    if (von !== 'kunde' && von !== 'gerald' && von !== 'nicht_erschienen') return new Response('Unbekannte Absage', { status: 400 });
    const email = await vermerkeAbsage(brand, text('terminId'), von);
    const hinweis = email && email.toLowerCase() === klient.email.toLowerCase()
      ? 'gespeichert=1'
      : `fehler=${encodeURIComponent('Der Termin war schon abgesagt oder gehört nicht zu dieser Akte.')}`;
    return redirect(`/admin/klienten/${klient.id}?${hinweis}#termine`, 303);
  }

  if (aktion === 'erlassen') {
    const postenId = text('postenId');
    if (!/^[0-9a-f-]{36}$/i.test(postenId)) return new Response('Posten nicht gefunden', { status: 404 });
    const klientId = await klientDesPostens(brand, postenId);
    if (!klientId) return new Response('Posten nicht gefunden', { status: 404 });
    const ok = await erlasseAusfall(brand, postenId, text('grund'));
    const hinweis = ok ? 'gespeichert=1' : `fehler=${encodeURIComponent('Nur offene Ausfallhonorare lassen sich erlassen.')}`;
    return redirect(`/admin/klienten/${klientId}?${hinweis}#abrechnung`, 303);
  }

  // T8: individuelle Aufträge (K8–K10)
  if (aktion === 'auftrag') {
    const klient = await getKlient(text('klientId'));
    if (!klient) return new Response('Klient nicht gefunden', { status: 404 });
    const { titel, fehler } = pruefeAuftragTitel(text('titel'));
    if (!titel) return redirect(`/admin/klienten/${klient.id}?auftragFehler=${encodeURIComponent(fehler!)}#auftraege`, 303);
    await legeAuftragAn(brand, klient.id, titel);
    return redirect(`/admin/klienten/${klient.id}?gespeichert=1#auftraege`, 303);
  }

  if (aktion === 'position' || aktion === 'position_aendern') {
    const eingabe = { datum: text('datum'), text: text('text'), menge: text('menge'), einheit: text('einheit'), preis: text('preis') };
    const { werte, fehler } = pruefePosition(eingabe);
    let klientId: string | null;
    if (aktion === 'position') {
      const auftragId = text('auftragId');
      if (!/^[0-9a-f-]{36}$/i.test(auftragId)) return new Response('Auftrag nicht gefunden', { status: 404 });
      klientId = await klientDesAuftrags(brand, auftragId);
      if (!klientId) return new Response('Auftrag nicht gefunden', { status: 404 });
      if (!werte) return redirect(`/admin/klienten/${klientId}?auftragFehler=${encodeURIComponent(fehler.map((f) => f.meldung).join(' '))}#auftraege`, 303);
      await legePositionAn(brand, klientId, auftragId, werte);
    } else {
      const postenId = text('postenId');
      if (!/^[0-9a-f-]{36}$/i.test(postenId)) return new Response('Posten nicht gefunden', { status: 404 });
      klientId = await klientDesPostens(brand, postenId);
      if (!klientId) return new Response('Posten nicht gefunden', { status: 404 });
      if (!werte) return redirect(`/admin/klienten/${klientId}?auftragFehler=${encodeURIComponent(fehler.map((f) => f.meldung).join(' '))}#auftraege`, 303);
      const ok = await aenderePosition(brand, postenId, werte);
      if (!ok) return redirect(`/admin/klienten/${klientId}?auftragFehler=${encodeURIComponent('Diese Position steht schon auf einer Rechnung und lässt sich nicht mehr ändern.')}#auftraege`, 303);
    }
    return redirect(`/admin/klienten/${klientId}?gespeichert=1#auftraege`, 303);
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
