// Rechnungswesen Stufe 3, T1: Regeln speichern (K17, K36, K39). Nur Admins (K43).
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../lib/auth';
import { REGEL_FELDER, pruefeRegeln, speichereRegeln } from '../../../../lib/billing-regeln';
import { pruefeEinheiten, speichereEinheiten } from '../../../../lib/billing-einheiten';
import { protokolliere } from '../../../../lib/akte-protokoll';

export const POST: APIRoute = async ({ request, redirect }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });

  const form = await request.formData();
  const eingabe: Record<string, string> = {};
  for (const f of REGEL_FELDER) eingabe[f.key] = String(form.get(f.key) ?? '');

  const { werte, fehler } = pruefeRegeln(eingabe);
  // Einheitenliste (eine je Zeile) auf derselben Seite.
  eingabe.einheiten = String(form.get('einheiten') ?? '');
  const einheiten = pruefeEinheiten(eingabe.einheiten);
  if (einheiten.fehler) fehler.push({ key: 'einheiten', meldung: einheiten.fehler });
  if (!werte || !einheiten.werte) {
    // Fehler und Eingaben zurück an die Seite, damit nichts verloren geht.
    const params = new URLSearchParams();
    params.set('fehler', JSON.stringify(fehler));
    params.set('eingabe', JSON.stringify(eingabe));
    return redirect(`/admin/einstellungen/regeln?${params.toString()}`, 303);
  }

  const brand = process.env.BRAND || 'mentolder';
  await speichereRegeln(brand, werte);
  await speichereEinheiten(brand, einheiten.werte);
  await protokolliere(brand, session.email, { bereich: 'einstellungen', aktion: 'Regeln gespeichert', nachher: { ...werte, einheiten: einheiten.werte.join(', ') } as Record<string, unknown> });
  return redirect('/admin/einstellungen/regeln?saved=1', 303);
};
