// Rechnungswesen Stufe 3, T3: Leistung anlegen, ändern, stilllegen, aktivieren
// (K1, K3, K5). Nur Admins (K43). Löschen gibt es bewusst nicht.
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../lib/auth';
import {
  holeLeistung, listeKategorien, pruefeLeistung, setzeLeistungAktiv, speichereLeistung,
} from '../../../lib/billing-leistungen';
import { protokolliere, unterschied } from '../../../lib/akte-protokoll';

export const POST: APIRoute = async ({ request, redirect }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });

  const brand = process.env.BRAND || 'mentolder';
  const form = await request.formData();
  const text = (k: string) => String(form.get(k) ?? '');
  const aktion = text('aktion');
  const key = text('key').trim() || null;

  if (aktion === 'stilllegen' || aktion === 'aktivieren') {
    if (!key || !(await holeLeistung(brand, key))) return new Response('Leistung nicht gefunden', { status: 404 });
    await setzeLeistungAktiv(brand, key, aktion === 'aktivieren');
    await protokolliere(brand, session.email, { bereich: 'einstellungen', aktion: aktion === 'aktivieren' ? 'Leistung aktiviert' : 'Leistung stillgelegt', objekt: (await holeLeistung(brand, key))?.name ?? key });
    return redirect(`/admin/leistungen?gespeichert=${encodeURIComponent(key)}`, 303);
  }

  if (key && !(await holeLeistung(brand, key))) return new Response('Leistung nicht gefunden', { status: 404 });

  const eingabe = {
    name: text('name'), kategorieId: text('kategorieId'), beschreibung: text('beschreibung'),
    preis: text('preis'), nachVereinbarung: form.get('nachVereinbarung') === 'on',
    einheit: text('einheit'), dauerMin: text('dauerMin'),
    website: form.get('website') === 'on', hervorheben: form.get('hervorheben') === 'on',
  };
  const kategorien = await listeKategorien(brand);
  const { werte, fehler } = pruefeLeistung(eingabe, kategorien.map((k) => k.id));
  if (!werte) {
    const params = new URLSearchParams({ fehler: JSON.stringify(fehler), eingabe: JSON.stringify(eingabe) });
    params.set('bearbeiten', key ?? 'neu');
    return redirect(`/admin/leistungen?${params.toString()}#formular`, 303);
  }

  const vorherL = key ? await holeLeistung(brand, key) : null;
  const gespeichert = await speichereLeistung(brand, key, werte);
  // Prüfung P4: alle Felder, nur die geänderten.
  const felder = Object.keys(werte);
  const d = vorherL ? unterschied(vorherL as unknown as Record<string, unknown>, werte as unknown as Record<string, unknown>, felder) : null;
  if (!vorherL || d) await protokolliere(brand, session.email, { bereich: 'einstellungen', aktion: key ? 'Leistung geändert' : 'Leistung angelegt', objekt: werte.name,
    vorher: d?.vorher ?? null, nachher: d?.nachher ?? (werte as unknown as Record<string, unknown>) });
  return redirect(`/admin/leistungen?gespeichert=${encodeURIComponent(gespeichert)}`, 303);
};
