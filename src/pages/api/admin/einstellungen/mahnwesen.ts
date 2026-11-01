// K165 (Handtest 01.11.2026): Mahnwesen-Einstellungen speichern (Gebühren, Zinsen, Frist, Abstand). Nur Admins.
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../lib/auth';
import { MAHN_FELDER, ladeMahnEinstellungen, pruefeMahnEinstellungen, speichereMahnEinstellungen } from '../../../../lib/mahn-einstellungen';
import { protokolliere, unterschied } from '../../../../lib/akte-protokoll';

export const POST: APIRoute = async ({ request, redirect }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });

  const form = await request.formData();
  const eingabe: Record<string, string> = {};
  for (const f of MAHN_FELDER) eingabe[f.key] = String(form.get(f.key) ?? '');
  const { werte, fehler } = pruefeMahnEinstellungen(eingabe);
  if (!werte) {
    const params = new URLSearchParams({ fehler: JSON.stringify(fehler), eingabe: JSON.stringify(eingabe) });
    return redirect(`/admin/einstellungen/regeln?${params.toString()}#mahnwesen`, 303);
  }
  const brand = process.env.BRAND || 'mentolder';
  const vorher = await ladeMahnEinstellungen(brand) as unknown as Record<string, unknown>;
  await speichereMahnEinstellungen(brand, werte);
  const d = unterschied(vorher, werte as unknown as Record<string, unknown>, Object.keys(werte));
  if (d) await protokolliere(brand, session.email, { bereich: 'einstellungen', aktion: 'Mahnwesen geändert', vorher: d.vorher, nachher: d.nachher });
  return redirect('/admin/einstellungen/regeln?mahnGespeichert=1#mahnwesen', 303);
};
