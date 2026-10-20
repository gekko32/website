// Rechnungswesen Stufe 3, T1: Regeln speichern (K17, K36, K39). Nur Admins (K43).
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../lib/auth';
import { REGEL_FELDER, pruefeRegeln, speichereRegeln } from '../../../../lib/billing-regeln';

export const POST: APIRoute = async ({ request, redirect }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });

  const form = await request.formData();
  const eingabe: Record<string, string> = {};
  for (const f of REGEL_FELDER) eingabe[f.key] = String(form.get(f.key) ?? '');

  const { werte, fehler } = pruefeRegeln(eingabe);
  if (!werte) {
    // Fehler und Eingaben zurück an die Seite, damit nichts verloren geht.
    const params = new URLSearchParams();
    params.set('fehler', JSON.stringify(fehler));
    params.set('eingabe', JSON.stringify(eingabe));
    return redirect(`/admin/einstellungen/regeln?${params.toString()}`, 303);
  }

  const brand = process.env.BRAND || 'mentolder';
  await speichereRegeln(brand, werte);
  return redirect('/admin/einstellungen/regeln?saved=1', 303);
};
