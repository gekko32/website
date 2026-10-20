// Rechnungstexte speichern (Einstellungen → Rechnungstexte). Nur Admins (K43).
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../lib/auth';
import { RECHNUNGSTEXT_FELDER, pruefeRechnungstexte, speichereRechnungstexte } from '../../../../lib/billing-rechnungstexte';

export const POST: APIRoute = async ({ request, redirect }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });

  const form = await request.formData();
  const eingabe = Object.fromEntries(RECHNUNGSTEXT_FELDER.map((f) => [f.key, String(form.get(f.key) ?? '')]));
  const { werte, fehler } = pruefeRechnungstexte(eingabe);
  if (!werte) {
    const params = new URLSearchParams({ fehler: JSON.stringify(fehler), eingabe: JSON.stringify(eingabe) });
    return redirect(`/admin/einstellungen/rechnungstexte?${params.toString()}`, 303);
  }
  await speichereRechnungstexte(process.env.BRAND || 'mentolder', werte);
  return redirect('/admin/einstellungen/rechnungstexte?saved=1', 303);
};
