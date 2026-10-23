// Rechnungswesen Stufe 3, T5: Sitzung von Hand erfassen, „nicht abrechnen“ umschalten
// (K11, K14); T10a: Rechnung aus gewählten Posten. Nur Admins (K43).
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../lib/auth';
import { getKlient } from '../../../lib/klientenakte';
import { holeLeistung } from '../../../lib/billing-leistungen';
import {
  aenderePosition, loeschePosten, rechnungDesPostens, holeAuftrag, klientDesAuftrags, benenneAuftragUm, loescheAuftrag, klientDesPostens, legeAuftragAn, legePositionAn, legeSitzungAn,
  pruefeAuftragTitel, pruefePosition, pruefePreis, pruefeSitzung, setzeAbrechnen, setzePostenPreis,
} from '../../../lib/billing-posten';
import { erlasseAusfall, vermerkeAbsage } from '../../../lib/billing-ausfall';
import { erstelleEntwurfAusPosten, verwirfEntwurf } from '../../../lib/billing-entwurf';
import { isE2ETestRequest } from '../../../lib/e2e-marker';

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

  // T10a: gewählte offene Posten → Rechnungsentwurf (K22, K23). Versand erst nach Prüfung unter Rechnungen.
  if (aktion === 'rechnung') {
    const klient = await getKlient(text('klientId'));
    if (!klient) return new Response('Klient nicht gefunden', { status: 404 });
    const ids = form.getAll('postenId').map(String);
    const r = await erstelleEntwurfAusPosten(brand, klient, ids, { isTestData: isE2ETestRequest(request) });
    const hinweis = r.ok ? `entwurf=${encodeURIComponent(r.number)}` : `fehler=${encodeURIComponent(r.fehler)}`;
    return redirect(`/admin/klienten/${klient.id}?${hinweis}#abrechnung`, 303);
  }

  // Handtest 22.10.2026: gesperrten Posten wieder änderbar machen – Entwurf, auf dem er steht, verwerfen.
  if (aktion === 'entwurf_verwerfen') {
    const postenId = text('postenId');
    if (!/^[0-9a-f-]{36}$/i.test(postenId)) return new Response('Posten nicht gefunden', { status: 404 });
    const r = await rechnungDesPostens(brand, postenId);
    if (!r) return new Response('Posten nicht gefunden', { status: 404 });
    const ok = r.zustand === 'auf_entwurf' && r.invoiceId !== null && await verwirfEntwurf(brand, r.invoiceId);
    const hinweis = ok ? 'gespeichert=1' : `fehler=${encodeURIComponent('Nur Posten auf einem noch nicht festgeschriebenen Entwurf lassen sich so freigeben. Festgeschriebene Rechnungen bitte stornieren.')}`;
    return redirect(`/admin/klienten/${r.klientId}?${hinweis}#abrechnung`, 303);
  }

  // T9: Absage eines gebuchten Termins vermerken (AE8) und Ausfallhonorar erlassen (K20)
  if (aktion === 'absage') {
    const klient = await getKlient(text('klientId'));
    if (!klient) return new Response('Klient nicht gefunden', { status: 404 });
    const von = text('von');
    if (von !== 'kunde' && von !== 'gerald' && von !== 'nicht_erschienen') return new Response('Unbekannte Absage', { status: 400 });
    const email = await vermerkeAbsage(brand, text('terminId'), von, klient.email);
    const hinweis = email
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
    // Stufe 4 T15 (K44): „mit Angebot“ – Positionen erst nach Annahme abrechenbar.
    await legeAuftragAn(brand, klient.id, titel, form.get('mitAngebot') === 'on' ? 'mit_angebot' : 'ohne_angebot');
    return redirect(`/admin/klienten/${klient.id}?gespeichert=1#auftraege`, 303);
  }

  // Handtest L2: von Hand erfasste Posten löschen, solange sie auf keiner Rechnung stehen.
  if (aktion === 'loeschen') {
    const postenId = text('postenId');
    if (!/^[0-9a-f-]{36}$/i.test(postenId)) return new Response('Posten nicht gefunden', { status: 404 });
    const klientId = await klientDesPostens(brand, postenId);
    if (!klientId) return new Response('Posten nicht gefunden', { status: 404 });
    const ok = await loeschePosten(brand, postenId);
    const hinweis = ok ? 'gespeichert=1' : `fehler=${encodeURIComponent('Löschen geht nur bei von Hand erfassten Posten, die auf keiner Rechnung stehen. Andere bitte ausnehmen.')}`;
    return redirect(`/admin/klienten/${klientId}?${hinweis}#abrechnung`, 303);
  }

  // Handtest L2: ganzen Auftrag umbenennen oder löschen.
  if (aktion === 'auftrag_umbenennen' || aktion === 'auftrag_loeschen') {
    const auftragId = text('auftragId');
    if (!/^[0-9a-f-]{36}$/i.test(auftragId)) return new Response('Auftrag nicht gefunden', { status: 404 });
    const klientId = await klientDesAuftrags(brand, auftragId);
    if (!klientId) return new Response('Auftrag nicht gefunden', { status: 404 });
    if (aktion === 'auftrag_umbenennen') {
      const { titel, fehler } = pruefeAuftragTitel(text('titel'));
      if (!titel) return redirect(`/admin/klienten/${klientId}?auftragFehler=${encodeURIComponent(fehler!)}#auftraege`, 303);
      await benenneAuftragUm(brand, auftragId, titel);
    } else {
      const ok = await loescheAuftrag(brand, auftragId);
      if (!ok) return redirect(`/admin/klienten/${klientId}?auftragFehler=${encodeURIComponent('Dieser Auftrag hat Positionen auf einer Rechnung und lässt sich nicht mehr löschen.')}#auftraege`, 303);
    }
    return redirect(`/admin/klienten/${klientId}?gespeichert=1#auftraege`, 303);
  }

  if (aktion === 'loeschen_auftragsposition') {
    const postenId = text('postenId');
    if (!/^[0-9a-f-]{36}$/i.test(postenId)) return new Response('Posten nicht gefunden', { status: 404 });
    const klientId = await klientDesPostens(brand, postenId);
    if (!klientId) return new Response('Posten nicht gefunden', { status: 404 });
    const ok = await loeschePosten(brand, postenId);
    const hinweis = ok ? 'gespeichert=1' : `auftragFehler=${encodeURIComponent('Diese Position steht schon auf einer Rechnung und lässt sich nicht mehr löschen.')}`;
    return redirect(`/admin/klienten/${klientId}?${hinweis}#auftraege`, 303);
  }

  if (aktion === 'position' || aktion === 'position_aendern') {
    const eingabe = { datum: text('datum'), datumBis: text('datumBis'), text: text('text'), menge: text('menge'), einheit: text('einheit'), preis: text('preis') };
    const { werte, fehler } = pruefePosition(eingabe);
    // Änderung aus der Abrechnungsliste (Handtest L2) oder aus einem Auftrag.
    const inAbrechnung = text('bereich') === 'abrechnung';
    const anker = inAbrechnung ? '#abrechnung' : '#auftraege';
    const fehlerParam = inAbrechnung ? 'fehler' : 'auftragFehler';
    let klientId: string | null;
    if (aktion === 'position') {
      const auftragId = text('auftragId');
      if (!/^[0-9a-f-]{36}$/i.test(auftragId)) return new Response('Auftrag nicht gefunden', { status: 404 });
      klientId = await klientDesAuftrags(brand, auftragId);
      if (!klientId) return new Response('Auftrag nicht gefunden', { status: 404 });
      // Prüfung Stufe 4 (B1): verschicktes Angebot – Positionen nur über eine neue Fassung ändern.
      if ((await holeAuftrag(brand, auftragId))?.stand === 'angeboten') {
        return redirect(`/admin/klienten/${klientId}?auftragFehler=${encodeURIComponent('Das Angebot ist verschickt. Für Änderungen auf der Angebotsseite eine neue Fassung anlegen.')}#auftraege`, 303);
      }
      if (!werte) return redirect(`/admin/klienten/${klientId}?auftragFehler=${encodeURIComponent(fehler.map((f) => f.meldung).join(' '))}#auftraege`, 303);
      await legePositionAn(brand, klientId, auftragId, werte);
    } else {
      const postenId = text('postenId');
      if (!/^[0-9a-f-]{36}$/i.test(postenId)) return new Response('Posten nicht gefunden', { status: 404 });
      klientId = await klientDesPostens(brand, postenId);
      if (!klientId) return new Response('Posten nicht gefunden', { status: 404 });
      if (!werte) return redirect(`/admin/klienten/${klientId}?${fehlerParam}=${encodeURIComponent(fehler.map((f) => f.meldung).join(' '))}${anker}`, 303);
      const ok = await aenderePosition(brand, postenId, werte);
      if (!ok) return redirect(`/admin/klienten/${klientId}?${fehlerParam}=${encodeURIComponent('Dieser Posten steht schon auf einer Rechnung (oder der Termin wurde abgesagt) und lässt sich nicht mehr ändern.')}${anker}`, 303);
    }
    return redirect(`/admin/klienten/${klientId}?gespeichert=1${anker}`, 303);
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
