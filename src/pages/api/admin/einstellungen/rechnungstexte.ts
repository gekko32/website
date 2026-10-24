// Rechnungstexte speichern (Einstellungen → Rechnungstexte). Nur Admins (K43).
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../lib/auth';
import { RECHNUNGSTEXT_FELDER, pruefeRechnungstexte, speichereRechnungstexte, ladeRechnungstexte } from '../../../../lib/billing-rechnungstexte';
import { protokolliere, unterschied } from '../../../../lib/akte-protokoll';

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
  const vorher = await ladeRechnungstexte(process.env.BRAND || 'mentolder').catch(() => null);
  await speichereRechnungstexte(process.env.BRAND || 'mentolder', werte);
  const d = vorher ? unterschied(vorher as unknown as Record<string, unknown>, werte as unknown as Record<string, unknown>, RECHNUNGSTEXT_FELDER.map((f) => f.key)) : null;
  if (d) await protokolliere(process.env.BRAND || 'mentolder', session.email, { bereich: 'einstellungen', aktion: 'Rechnungstexte geändert', vorher: d.vorher, nachher: d.nachher });
  return redirect('/admin/einstellungen/rechnungstexte?saved=1', 303);
};
