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
import { aktualisiereEntwurf, aendereFreieZeile, entferneFreieZeile, erstelleEntwurfAusPosten } from '../../../lib/billing-entwurf';
import { fuegeZumEntwurf, nimmVomEntwurf } from '../../../lib/billing-posten';
import { pool } from '../../../lib/website-db';
import { isE2ETestRequest } from '../../../lib/e2e-marker';
import { aktualisiereAngebotsentwurf } from '../../../lib/billing-angebot';
import { protokolliere, unterschied, type ProtokollBereich } from '../../../lib/akte-protokoll';

// Änderungsprotokoll (K94): Bereich und Text je Aktion; protokolliert wird jede erfolgreiche Aktion.
const AKTION_TEXT: Record<string, [ProtokollBereich, string]> = {
  nicht_abrechnen: ['posten', 'Posten ausgenommen'], abrechnen: ['posten', 'Posten wieder abrechnen'],
  preis: ['posten', 'Preis eingetragen'], vom_entwurf: ['posten', 'Vom Rechnungsentwurf genommen'],
  entwurf_verwerfen: ['posten', 'Vom Rechnungsentwurf genommen'], zum_entwurf: ['posten', 'Zum Rechnungsentwurf hinzugefügt'],
  freie_zeile_aendern: ['rechnung', 'Freie Zeile im Rechnungsentwurf geändert'], freie_zeile_entfernen: ['rechnung', 'Freie Zeile aus Rechnungsentwurf entfernt'],
  absage: ['posten', 'Absage vermerkt'], erlassen: ['posten', 'Ausfallhonorar erlassen'], loeschen: ['posten', 'Posten gelöscht'],
  sitzung: ['posten', 'Sitzung erfasst'], auftrag: ['auftrag', 'Auftrag angelegt'], auftrag_umbenennen: ['auftrag', 'Auftrag umbenannt'],
  auftrag_loeschen: ['auftrag', 'Auftrag gelöscht'], position: ['auftrag', 'Position angelegt'],
  position_aendern: ['posten', 'Position geändert'], loeschen_auftragsposition: ['auftrag', 'Position gelöscht'],
};
const POSTEN_FELDER = ['datum', 'datumBis', 'text', 'menge', 'einheit', 'preis', 'zustand'];

/** Stand eines Postens für vorher → nachher (null, wenn es ihn nicht gibt). */
async function postenStand(brand: string, id: string): Promise<Record<string, unknown> | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = (await pool.query(
    `SELECT datum::text AS datum, datum_bis::text AS datum_bis, text, menge::float AS menge, einheit, einzelpreis::float AS preis, zustand
       FROM abrechnungsposten WHERE brand = $1 AND id = $2`, [brand, id])).rows[0];
  return r ? { datum: r.datum, datumBis: r.datum_bis, text: r.text, menge: r.menge, einheit: r.einheit, preis: r.preis, zustand: r.zustand } : null;
}

/** Prüfung Stufe 4 Runde 2 (N2): bei gesperrten Auftragspositionen den richtigen Grund nennen. */
async function gesperrtGrund(brand: string, auftragId: string | null, sonst: string, auftragLoeschen = false): Promise<string> {
  if (!auftragId) return sonst;
  const a = await holeAuftrag(brand, auftragId);
  if (a?.stand === 'angeboten') return 'Das Angebot ist verschickt: Positionen sind gesperrt. Für Änderungen auf der Angebotsseite eine neue Fassung anlegen.';
  if (auftragLoeschen && a && a.modus === 'mit_angebot' && a.stand !== null) {
    return 'Zu diesem Auftrag gibt es ein verschicktes Angebot. Er bleibt als Verlauf in der Akte und lässt sich nicht löschen.';
  }
  return sonst;
}

export const POST: APIRoute = async ({ request, redirect }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });

  const brand = process.env.BRAND || 'mentolder';
  const form = await request.formData();
  const text = (k: string) => String(form.get(k) ?? '');
  const aktion = text('aktion');

  // Handtest 23.10.2026: Ein Rechnungsentwurf bleibt bis zum Festschreiben änderbar. Ändert sich ein
  // Posten, der auf einem Entwurf steht, wird der Entwurf danach neu aufgebaut. Kommt die Anfrage von
  // der Entwurfsseite (zurueck), geht es dorthin zurück.
  const zurueck = text('zurueck');
  // Nachtrag 24.10.2026 (K88): ebenso von der Seite eines Angebotsentwurfs.
  const zurEntwurfsseite = /^\/admin\/(rechnungen\/entwurf|angebote)\/[0-9a-f-]{36}$/i.test(zurueck);
  const pid = text('postenId');
  const vorher = /^[0-9a-f-]{36}$/i.test(pid) ? await rechnungDesPostens(brand, pid) : null;
  let entwurfNachher: string | null = vorher?.zustand === 'auf_entwurf' ? vorher.invoiceId : null;
  // K88: Ändert sich eine Position eines Auftrags, zieht ein Angebotsentwurf dazu seinen Betrag nach.
  let auftragNachher: string | null = vorher?.auftragId ?? null;
  // K94: Stand vorher für das Änderungsprotokoll.
  const postenVorher = vorher ? await postenStand(brand, pid) : null;
  const auftragVorher = /^[0-9a-f-]{36}$/i.test(text('auftragId')) ? await holeAuftrag(brand, text('auftragId')) : null;
  let protokollZusatz: string | null = null;
  const protokolliereErfolg = async (ziel: string) => {
    const eintrag = AKTION_TEXT[aktion];
    if (!eintrag || !/[?&]gespeichert=1/.test(ziel)) return;
    const klientId = ziel.match(/\/admin\/klienten\/([0-9a-f-]{36})/i)?.[1] ?? vorher?.klientId ?? auftragVorher?.klientId ?? null;
    const formular = Object.fromEntries(['datum', 'datumBis', 'text', 'menge', 'einheit', 'preis', 'titel', 'grund', 'von', 'leistungKey']
      .map((k) => [k, text(k)]).filter(([, v]) => v !== ''));
    let v: Record<string, unknown> | null = null;
    let n: Record<string, unknown> | null = formular;
    if (postenVorher) {
      const danach = await postenStand(brand, pid);
      // Prüfung P3: ganzer Stand vorher nur beim Löschen; ohne Unterschied nichts vorher/nachher.
      if (!danach) { v = postenVorher; n = null; } else {
        const d = unterschied(postenVorher, danach, POSTEN_FELDER);
        v = d?.vorher ?? null; n = d?.nachher ?? null;
      }
    } else if (aktion === 'auftrag_umbenennen' && auftragVorher) {
      v = { titel: auftragVorher.titel }; n = { titel: pruefeAuftragTitel(text('titel')).titel ?? text('titel').trim() };
    } else if (aktion === 'auftrag') {
      n = { ...formular, mitAngebot: form.get('mitAngebot') === 'on' ? 'ja' : 'nein' };
    }
    await protokolliere(brand, session.email, {
      bereich: eintrag[0], aktion: eintrag[1], klientId,
      objekt: (postenVorher?.text as string | undefined) ?? auftragVorher?.titel ?? (text('titel') || text('text') || null),
      beschreibung: protokollZusatz, vorher: v, nachher: n,
    });
  };
  const weiter = async (ziel: string, _status = 303): Promise<Response> => {
    let ergebnis: string | null = null;
    if (entwurfNachher) ergebnis = await aktualisiereEntwurf(brand, entwurfNachher);
    if (auftragNachher) await aktualisiereAngebotsentwurf(brand, auftragNachher);
    await protokolliereErfolg(ziel);
    if (zurEntwurfsseite) {
      if (ergebnis === 'verworfen') {
        return redirect(`/admin/klienten/${vorher?.klientId ?? ''}?fehler=${encodeURIComponent('Der Entwurf hatte keine Position mehr und wurde verworfen. Die Posten sind wieder offen.')}#abrechnung`, 303);
      }
      const q = new URLSearchParams((ziel.split('?')[1] ?? '').split('#')[0]);
      const f = q.get('fehler') ?? q.get('auftragFehler');
      return redirect(zurueck + (f ? `?fehler=${encodeURIComponent(f)}` : '?gespeichert=1'), 303);
    }
    return redirect(ziel, 303);
  };

  if (aktion === 'nicht_abrechnen' || aktion === 'abrechnen') {
    const postenId = text('postenId');
    if (!/^[0-9a-f-]{36}$/i.test(postenId)) return new Response('Posten nicht gefunden', { status: 404 });
    const klientId = await klientDesPostens(brand, postenId);
    if (!klientId) return new Response('Posten nicht gefunden', { status: 404 });
    const ok = await setzeAbrechnen(brand, postenId, aktion === 'abrechnen');
    const hinweis = ok ? 'gespeichert=1' : `fehler=${encodeURIComponent('Dieser Posten steht schon auf einer Rechnung und lässt sich hier nicht ändern.')}`;
    return weiter(`/admin/klienten/${klientId}?${hinweis}#abrechnung`, 303);
  }

  if (aktion === 'preis') {
    const postenId = text('postenId');
    if (!/^[0-9a-f-]{36}$/i.test(postenId)) return new Response('Posten nicht gefunden', { status: 404 });
    const klientId = await klientDesPostens(brand, postenId);
    if (!klientId) return new Response('Posten nicht gefunden', { status: 404 });
    const preis = pruefePreis(text('preis'));
    if (preis === null) {
      return weiter(`/admin/klienten/${klientId}?fehler=${encodeURIComponent('Bitte einen Preis ab 0 mit höchstens zwei Nachkommastellen eintragen.')}#abrechnung`, 303);
    }
    const ok = await setzePostenPreis(brand, postenId, preis);
    const hinweis = ok ? 'gespeichert=1' : `fehler=${encodeURIComponent('Dieser Posten steht schon auf einer Rechnung und lässt sich hier nicht ändern.')}`;
    return weiter(`/admin/klienten/${klientId}?${hinweis}#abrechnung`, 303);
  }

  // T10a: gewählte offene Posten → Rechnungsentwurf (K22, K23). Versand erst nach Prüfung unter Rechnungen.
  if (aktion === 'rechnung') {
    const klient = await getKlient(text('klientId'));
    if (!klient) return new Response('Klient nicht gefunden', { status: 404 });
    const ids = form.getAll('postenId').map(String);
    const r = await erstelleEntwurfAusPosten(brand, klient, ids, { isTestData: isE2ETestRequest(request) });
    // Handtest 23.10.2026: direkt zur Entwurfsseite – dort prüfen, ändern, verschicken.
    if (r.ok) {
      await protokolliere(brand, session.email, { bereich: 'rechnung', aktion: 'Rechnungsentwurf erstellt', klientId: klient.id, beschreibung: `${ids.length} Posten` });
      return redirect(`/admin/rechnungen/entwurf/${r.invoiceId}?neu=1`, 303);
    }
    return weiter(`/admin/klienten/${klient.id}?fehler=${encodeURIComponent(r.fehler)}#abrechnung`, 303);
  }

  // Handtest 23.10.2026: nur diesen Posten vom Entwurf nehmen (wieder offen); der Entwurf bleibt.
  if (aktion === 'vom_entwurf' || aktion === 'entwurf_verwerfen') {
    if (!vorher) return new Response('Posten nicht gefunden', { status: 404 });
    const invoiceId = await nimmVomEntwurf(brand, pid);
    const hinweis = invoiceId ? 'gespeichert=1' : `fehler=${encodeURIComponent('Nur Posten auf einem noch nicht festgeschriebenen Entwurf lassen sich herausnehmen. Festgeschriebene Rechnungen bitte stornieren.')}`;
    return weiter(`/admin/klienten/${vorher.klientId}?${hinweis}#abrechnung`, 303);
  }

  // Handtest 23.10.2026: weitere offene Posten auf einen Entwurf setzen (Entwurfsseite).
  if (aktion === 'zum_entwurf') {
    const invoiceId = text('invoiceId');
    const kopf = (await pool.query(`SELECT klient_id::text AS klient_id FROM billing_invoices WHERE id=$1 AND brand=$2 AND status='draft'`, [invoiceId, brand])).rows[0];
    if (!kopf?.klient_id) return new Response('Entwurf nicht gefunden', { status: 404 });
    const n = await fuegeZumEntwurf(brand, invoiceId, kopf.klient_id, form.getAll('postenId').map(String));
    entwurfNachher = invoiceId;
    protokollZusatz = `${n} Posten`;
    return weiter(`/admin/klienten/${kopf.klient_id}?${n > 0 ? 'gespeichert=1' : `fehler=${encodeURIComponent('Bitte mindestens einen offenen Posten mit Preis ankreuzen.')}`}`, 303);
  }

  // Handtest 23.10.2026: freie Positionen (ohne Posten, z. B. ältere Entwürfe) ändern oder entfernen.
  if (aktion === 'freie_zeile_aendern' || aktion === 'freie_zeile_entfernen') {
    const invoiceId = text('invoiceId');
    const kopf = (await pool.query(`SELECT klient_id::text AS klient_id FROM billing_invoices WHERE id=$1 AND brand=$2 AND status='draft'`, [invoiceId, brand])).rows[0];
    if (!kopf) return new Response('Entwurf nicht gefunden', { status: 404 });
    let ok = false;
    if (aktion === 'freie_zeile_entfernen') ok = await entferneFreieZeile(invoiceId, text('zeileId'));
    else {
      const { werte, fehler } = pruefePosition({ datum: text('datum'), datumBis: text('datumBis'), text: text('text'), menge: text('menge'), einheit: text('einheit'), preis: text('preis') });
      if (!werte) return weiter(`/admin/klienten/${kopf.klient_id}?fehler=${encodeURIComponent(fehler.map((x) => x.meldung).join(' '))}`, 303);
      ok = await aendereFreieZeile(invoiceId, text('zeileId'), werte);
    }
    entwurfNachher = invoiceId;
    return weiter(`/admin/klienten/${kopf.klient_id}?${ok ? 'gespeichert=1' : `fehler=${encodeURIComponent('Position nicht gefunden.')}`}`, 303);
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
    return weiter(`/admin/klienten/${klient.id}?${hinweis}#termine`, 303);
  }

  if (aktion === 'erlassen') {
    const postenId = text('postenId');
    if (!/^[0-9a-f-]{36}$/i.test(postenId)) return new Response('Posten nicht gefunden', { status: 404 });
    const klientId = await klientDesPostens(brand, postenId);
    if (!klientId) return new Response('Posten nicht gefunden', { status: 404 });
    const ok = await erlasseAusfall(brand, postenId, text('grund'));
    const hinweis = ok ? 'gespeichert=1' : `fehler=${encodeURIComponent('Nur offene Ausfallhonorare lassen sich erlassen.')}`;
    return weiter(`/admin/klienten/${klientId}?${hinweis}#abrechnung`, 303);
  }

  // T8: individuelle Aufträge (K8–K10)
  if (aktion === 'auftrag') {
    const klient = await getKlient(text('klientId'));
    if (!klient) return new Response('Klient nicht gefunden', { status: 404 });
    const { titel, fehler } = pruefeAuftragTitel(text('titel'));
    if (!titel) return weiter(`/admin/klienten/${klient.id}?auftragFehler=${encodeURIComponent(fehler!)}#auftraege`, 303);
    // Stufe 4 T15 (K44): „mit Angebot“ – Positionen erst nach Annahme abrechenbar.
    await legeAuftragAn(brand, klient.id, titel, form.get('mitAngebot') === 'on' ? 'mit_angebot' : 'ohne_angebot');
    return weiter(`/admin/klienten/${klient.id}?gespeichert=1#auftraege`, 303);
  }

  // Handtest L2: von Hand erfasste Posten löschen, solange sie auf keiner Rechnung stehen.
  if (aktion === 'loeschen') {
    const postenId = text('postenId');
    if (!/^[0-9a-f-]{36}$/i.test(postenId)) return new Response('Posten nicht gefunden', { status: 404 });
    const klientId = await klientDesPostens(brand, postenId);
    if (!klientId) return new Response('Posten nicht gefunden', { status: 404 });
    const ok = await loeschePosten(brand, postenId);
    const hinweis = ok ? 'gespeichert=1' : `fehler=${encodeURIComponent('Löschen geht nur bei von Hand erfassten Posten, die auf keiner Rechnung stehen. Andere bitte ausnehmen.')}`;
    return weiter(`/admin/klienten/${klientId}?${hinweis}#abrechnung`, 303);
  }

  // Handtest L2: ganzen Auftrag umbenennen oder löschen.
  if (aktion === 'auftrag_umbenennen' || aktion === 'auftrag_loeschen') {
    const auftragId = text('auftragId');
    if (!/^[0-9a-f-]{36}$/i.test(auftragId)) return new Response('Auftrag nicht gefunden', { status: 404 });
    const klientId = await klientDesAuftrags(brand, auftragId);
    if (!klientId) return new Response('Auftrag nicht gefunden', { status: 404 });
    if (aktion === 'auftrag_umbenennen') {
      const { titel, fehler } = pruefeAuftragTitel(text('titel'));
      if (!titel) return weiter(`/admin/klienten/${klientId}?auftragFehler=${encodeURIComponent(fehler!)}#auftraege`, 303);
      await benenneAuftragUm(brand, auftragId, titel);
    } else {
      const ok = await loescheAuftrag(brand, auftragId);
      if (!ok) return weiter(`/admin/klienten/${klientId}?auftragFehler=${encodeURIComponent(await gesperrtGrund(brand, auftragId, 'Dieser Auftrag hat Positionen auf einer Rechnung und lässt sich nicht mehr löschen.', true))}#auftraege`, 303);
    }
    return weiter(`/admin/klienten/${klientId}?gespeichert=1#auftraege`, 303);
  }

  if (aktion === 'loeschen_auftragsposition') {
    const postenId = text('postenId');
    if (!/^[0-9a-f-]{36}$/i.test(postenId)) return new Response('Posten nicht gefunden', { status: 404 });
    const klientId = await klientDesPostens(brand, postenId);
    if (!klientId) return new Response('Posten nicht gefunden', { status: 404 });
    const ok = await loeschePosten(brand, postenId);
    const auftragDesPostens = ok ? null : (await rechnungDesPostens(brand, postenId))?.auftragId ?? null;
    const hinweis = ok ? 'gespeichert=1' : `auftragFehler=${encodeURIComponent(await gesperrtGrund(brand, auftragDesPostens, 'Diese Position steht schon auf einer Rechnung und lässt sich nicht mehr löschen.'))}`;
    return weiter(`/admin/klienten/${klientId}?${hinweis}#auftraege`, 303);
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
      auftragNachher = auftragId;
      // Prüfung Stufe 4 (B1): verschicktes Angebot – Positionen nur über eine neue Fassung ändern.
      if ((await holeAuftrag(brand, auftragId))?.stand === 'angeboten') {
        return weiter(`/admin/klienten/${klientId}?auftragFehler=${encodeURIComponent('Das Angebot ist verschickt. Für Änderungen auf der Angebotsseite eine neue Fassung anlegen.')}#auftraege`, 303);
      }
      if (!werte) return weiter(`/admin/klienten/${klientId}?auftragFehler=${encodeURIComponent(fehler.map((f) => f.meldung).join(' '))}#auftraege`, 303);
      await legePositionAn(brand, klientId, auftragId, werte);
    } else {
      const postenId = text('postenId');
      if (!/^[0-9a-f-]{36}$/i.test(postenId)) return new Response('Posten nicht gefunden', { status: 404 });
      klientId = await klientDesPostens(brand, postenId);
      if (!klientId) return new Response('Posten nicht gefunden', { status: 404 });
      if (!werte) return weiter(`/admin/klienten/${klientId}?${fehlerParam}=${encodeURIComponent(fehler.map((f) => f.meldung).join(' '))}${anker}`, 303);
      const ok = await aenderePosition(brand, postenId, werte);
      if (!ok) {
        const auftragDesPostens = (await rechnungDesPostens(brand, postenId))?.auftragId ?? null;
        const meldung = await gesperrtGrund(brand, auftragDesPostens, 'Dieser Posten steht schon auf einer Rechnung (oder der Termin wurde abgesagt) und lässt sich nicht mehr ändern.');
        return weiter(`/admin/klienten/${klientId}?${fehlerParam}=${encodeURIComponent(meldung)}${anker}`, 303);
      }
    }
    return weiter(`/admin/klienten/${klientId}?gespeichert=1${anker}`, 303);
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
    return weiter(`/admin/klienten/${klient.id}?${params.toString()}#abrechnung`, 303);
  }
  await legeSitzungAn(brand, klient.id, werte);
  return weiter(`/admin/klienten/${klient.id}?gespeichert=1#abrechnung`, 303);
};
