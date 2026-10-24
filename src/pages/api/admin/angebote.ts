// Rechnungswesen Stufe 4, T16/T17: Angebote anlegen, verwerfen, verschicken, neue Fassung,
// Antwort vermerken (K47–K55). Nur Admins (K69).
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../lib/auth';
import { getKlient } from '../../../lib/klientenakte';
import {
  erstelleAngebotsentwurf, holeAngebot, neueFassung, pruefeGueltigBis, verwirfAngebot, versendeAngebot, angebotVorschau,
  pruefeAntwortDatum, vermerkeAnnahme, vermerkeAblehnung, setzeGueltigBis, markiereVorlage, angebotAusVorlage,
} from '../../../lib/billing-angebot';
import { pruefeAuftragTitel } from '../../../lib/billing-posten';
import { protokolliere, type ProtokollEintrag } from '../../../lib/akte-protokoll';
import { erzeugeAngebotsPdf } from '../../../lib/billing-angebot-pdf';
import { legeEintragAn, pruefeDatei, dateiAusFormular, istWeg, WEG_TEXT } from '../../../lib/akte-dokumente';
import { pruefeVersandweg } from '../../../lib/billing-versand';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });
  const brand = process.env.BRAND || 'mentolder';
  // Änderungsprotokoll (K94): jede erfolgreiche Angebotsaktion.
  const log = (e: Omit<ProtokollEintrag, 'bereich'>) => protokolliere(brand, session.email, { bereich: 'angebot', ...e });

  // Versand kommt als JSON aus der Prüfseite, alles andere als Formular.
  if ((request.headers.get('content-type') ?? '').includes('application/json')) {
    const body = await request.json().catch(() => ({})) as { aktion?: string; id?: string; versand?: unknown; gueltigBis?: string };
    if (body.aktion === 'gueltig_bis' && body.id) {
      // Prüfung Stufe 4 (B5): „gültig bis“ des Entwurfs sofort speichern.
      const heuteG = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
      const gb = pruefeGueltigBis(body.gueltigBis, heuteG);
      if (!gb.wert) return json(422, { error: gb.fehler });
      const vorherA = await holeAngebot(brand, body.id);
      if (!(await setzeGueltigBis(brand, body.id, gb.wert))) return json(409, { error: 'Nur bei Entwürfen änderbar.' });
      await log({ aktion: '„Gültig bis“ geändert', klientId: vorherA?.klientId, objekt: vorherA?.number, vorher: { gueltigBis: vorherA?.gueltigBis }, nachher: { gueltigBis: gb.wert } });
      return json(200, { ok: true });
    }
    if (body.aktion !== 'versenden' || !body.id) return json(400, { error: 'Unbekannte Aktion' });
    const a = await holeAngebot(brand, body.id);
    if (!a) return json(404, { error: 'Angebot nicht gefunden' });
    const vorschau = await angebotVorschau(brand, a);
    const versand = pruefeVersandweg(body.versand, vorschau.empfaenger?.email);
    if (versand.fehler) return json(422, { error: versand.fehler });
    const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    const g = pruefeGueltigBis(body.gueltigBis ?? a.gueltigBis, heute);
    if (!g.wert) return json(422, { error: g.fehler });
    // K100: bei E-Mail nur nummerieren; die Mail geht erst aus dem Mail-Fenster (`/angebote/[id]/mail`).
    const r = await versendeAngebot(brand, a.id, {
      weg: versand.weg, gueltigBis: g.wert, ohneVersandvermerk: versand.weg === 'email',
      dokument: (fertig) => erzeugeAngebotsPdf(brand, fertig, fertig.positionen, fertig.empfaenger!),
    });
    if (!r.ok) return json(422, { error: r.fehler });
    await log({ aktion: versand.weg === 'post' ? 'Angebot verschickt (Post/persönlich)' : 'Angebot nummeriert, E-Mail vorbereitet', klientId: a.klientId, objekt: r.angebot.number,
      nachher: { betrag: r.angebot.brutto, gueltigBis: r.angebot.gueltigBis } });
    const pdfUrl = `/api/admin/angebote/${a.id}/pdf`;
    if (versand.weg === 'post') return json(200, { ok: true, number: r.angebot.number, versand: 'post', pdfUrl });
    return json(200, { ok: true, number: r.angebot.number, versand: 'email', mail: true });
  }

  const form = await request.formData();
  const text = (k: string) => String(form.get(k) ?? '');
  const aktion = text('aktion');
  const uuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

  if (aktion === 'erstellen') {
    const klient = await getKlient(text('klientId'));
    if (!klient || !uuid(text('auftragId'))) return new Response('Nicht gefunden', { status: 404 });
    const r = await erstelleAngebotsentwurf(brand, klient, text('auftragId'));
    if (!r.ok) return redirect(`/admin/klienten/${klient.id}?auftragFehler=${encodeURIComponent(r.fehler)}#auftraege`, 303);
    await log({ aktion: 'Angebotsentwurf erstellt', klientId: klient.id, objekt: (await holeAngebot(brand, r.id))?.auftragTitel ?? null });
    return redirect(`/admin/angebote/${r.id}`, 303);
  }

  const id = text('id');
  const a = id ? await holeAngebot(brand, id) : null;
  if (!a) return new Response('Angebot nicht gefunden', { status: 404 });

  if (aktion === 'verwerfen') {
    const ok = await verwirfAngebot(brand, a.id);
    if (ok) await log({ aktion: 'Angebotsentwurf verworfen', klientId: a.klientId, objekt: a.auftragTitel });
    return redirect(ok ? `/admin/klienten/${a.klientId}?gespeichert=1#auftraege` : `/admin/angebote/${a.id}?fehler=${encodeURIComponent('Nur Entwürfe lassen sich verwerfen.')}`, 303);
  }
  // Nachtrag 24.10.2026 (K86): als Vorlage markieren / Markierung entfernen.
  if (aktion === 'vorlage_markieren' || aktion === 'vorlage_entfernen') {
    const r = await markiereVorlage(brand, a.id, aktion === 'vorlage_markieren' ? text('vorlageName') : null);
    if (r.ok) await log({ aktion: aktion === 'vorlage_markieren' ? 'Als Vorlage markiert' : 'Vorlagen-Markierung entfernt', klientId: a.klientId, objekt: a.number,
      vorher: { vorlageName: a.vorlageName }, nachher: { vorlageName: aktion === 'vorlage_markieren' ? text('vorlageName').trim() : null } });
    return redirect(`/admin/angebote/${a.id}?${r.ok ? 'gespeichert=1' : `fehler=${encodeURIComponent(r.fehler)}`}#vorlage`, 303);
  }
  // K87: neues Angebot aus diesem Angebot (für denselben oder einen anderen Klienten).
  if (aktion === 'aus_vorlage') {
    const ziel = await getKlient(text('zielKlientId'));
    if (!ziel) return redirect(`/admin/angebote/${a.id}?fehler=${encodeURIComponent('Bitte einen Klienten wählen.')}#vorlage`, 303);
    const { titel, fehler } = pruefeAuftragTitel(text('titel'));
    if (!titel) return redirect(`/admin/angebote/${a.id}?fehler=${encodeURIComponent(fehler!)}#vorlage`, 303);
    let r: Awaited<ReturnType<typeof angebotAusVorlage>>;
    try {
      r = await angebotAusVorlage(brand, a.id, ziel, titel);
    } catch (err) {
      // Prüfung A2: verständliche Meldung statt Fehlerseite; der halbe Auftrag ist schon entfernt.
      locals.requestLogger.error({ err }, '[angebote] aus Vorlage fehlgeschlagen');
      return redirect(`/admin/angebote/${a.id}?fehler=${encodeURIComponent('Das neue Angebot konnte nicht angelegt werden. Bitte noch einmal versuchen.')}#vorlage`, 303);
    }
    if (r.ok) await log({ aktion: 'Neues Angebot aus Vorlage', klientId: ziel.id, objekt: titel, beschreibung: `Grundlage: ${a.number}${a.klientId !== ziel.id ? ' (anderer Klient)' : ''}` });
    return redirect(r.ok ? `/admin/angebote/${r.id}?neu=1` : `/admin/angebote/${a.id}?fehler=${encodeURIComponent(r.fehler)}#vorlage`, 303);
  }
  if (aktion === 'neue_fassung') {
    const r = await neueFassung(brand, a.id);
    if (r.ok) await log({ aktion: 'Neue Fassung angelegt', klientId: a.klientId, objekt: a.number, beschreibung: `${a.number} steht jetzt auf „ersetzt“` });
    return redirect(r.ok ? `/admin/angebote/${r.id}` : `/admin/angebote/${a.id}?fehler=${encodeURIComponent(r.fehler)}`, 303);
  }
  // T17 (K52–K55): Antwort des Kunden von Hand vermerken.
  if (aktion === 'angenommen' || aktion === 'abgelehnt') {
    const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    const d = pruefeAntwortDatum(text('datum'), a.versendetAm ?? a.datum, heute);
    if (!d.wert) return redirect(`/admin/angebote/${a.id}?fehler=${encodeURIComponent(d.fehler!)}`, 303);
    // K101: Nachweis (Weg, Notiz, Datei) vorher prüfen – sonst wäre die Antwort vermerkt, der Nachweis aber nicht.
    const datei = await dateiAusFormular(form.get('datei'));
    const dateiFehler = pruefeDatei(datei);
    if (dateiFehler) return redirect(`/admin/angebote/${a.id}?fehler=${encodeURIComponent(dateiFehler)}`, 303);
    const r = aktion === 'angenommen'
      ? await vermerkeAnnahme(brand, a.id, d.wert)
      : await vermerkeAblehnung(brand, a.id, d.wert, text('grund'));
    if (!r.ok) return redirect(`/admin/angebote/${a.id}?fehler=${encodeURIComponent(r.fehler)}`, 303);
    const weg = istWeg(text('weg')) ? text('weg') : null;
    const notiz = [aktion === 'abgelehnt' && text('grund').trim() ? `Grund: ${text('grund').trim()}` : '', text('notiz').trim()].filter(Boolean).join('\n');
    if (a.klientId && (weg || notiz || datei)) {
      const e = await legeEintragAn(brand, { klientId: a.klientId, angebotId: a.id, art: aktion === 'angenommen' ? 'annahme' : 'ablehnung',
        weg, datum: d.wert, notiz: notiz || `${aktion === 'angenommen' ? 'Annahme' : 'Ablehnung'} vermerkt`, datei }, session.email);
      if (!e.ok) locals.requestLogger.warn({ fehler: e.fehler }, '[angebote] Nachweis nicht gespeichert');
    }
    await log({ aktion: aktion === 'angenommen' ? 'Annahme vermerkt' : 'Ablehnung vermerkt', klientId: a.klientId, objekt: a.number,
      nachher: { am: d.wert, weg: weg ? WEG_TEXT[weg as keyof typeof WEG_TEXT] : null, grund: aktion === 'abgelehnt' ? text('grund').trim() || null : null,
        notiz: text('notiz').trim().slice(0, 200), datei: datei?.name } });
    return redirect(`/admin/angebote/${a.id}?gespeichert=1`, 303);
  }
  return new Response('Unbekannte Aktion', { status: 400 });
};
