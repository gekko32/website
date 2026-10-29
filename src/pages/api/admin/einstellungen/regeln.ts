// Rechnungswesen Stufe 3, T1: Regeln speichern (K17, K36, K39). Nur Admins (K43).
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../lib/auth';
import { REGEL_FELDER, pruefeRegeln, speichereRegeln, ladeRegeln } from '../../../../lib/billing-regeln';
import { pruefeEinheiten, speichereEinheiten, ladeEinheiten } from '../../../../lib/billing-einheiten';
import { protokolliere, unterschied } from '../../../../lib/akte-protokoll';
import { leseKundennummerStand, pruefeNaechsteKundennummer, setzeNaechsteKundennummer, kundennummerText } from '../../../../lib/kundennummer';

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
  // K146 (Handtest 29.10.2026): nächste Kundennummer – nur, wenn sie sich ändert.
  const kdStand = await leseKundennummerStand().catch(() => null);
  const kdRoh = form.get('naechste_kundennummer');
  let kdNeu: number | null = null;
  // Prüfung C4: gegen den Wert beim Laden der Seite vergleichen, nicht gegen den aktuellen Zähler –
  // sonst setzt Speichern anderer Regeln den Zähler zurück, wenn inzwischen ein Klient entstand.
  const kdVorher = Number(form.get('naechste_kundennummer_vorher') ?? NaN);
  if (kdStand && typeof kdRoh === 'string' && kdRoh.trim() !== '') {
    const kd = pruefeNaechsteKundennummer(kdRoh);
    if (kd.fehler) { eingabe.naechste_kundennummer = kdRoh; fehler.push({ key: 'naechste_kundennummer', meldung: kd.fehler }); }
    else if (kd.wert !== kdVorher) kdNeu = kd.wert;
  }
  if (!werte || !einheiten.werte || fehler.some((f) => f.key === 'naechste_kundennummer')) {
    // Fehler und Eingaben zurück an die Seite, damit nichts verloren geht.
    const params = new URLSearchParams();
    params.set('fehler', JSON.stringify(fehler));
    params.set('eingabe', JSON.stringify(eingabe));
    return redirect(`/admin/einstellungen/regeln?${params.toString()}`, 303);
  }

  const brand = process.env.BRAND || 'mentolder';
  // Prüfung C5: Kundennummer zuerst – scheitert sie, ist noch nichts gespeichert.
  if (kdStand && kdNeu !== null) {
    try {
      await setzeNaechsteKundennummer(kdNeu);
    } catch {
      const params = new URLSearchParams();
      params.set('fehler', JSON.stringify([{ key: 'naechste_kundennummer', meldung: 'Die Kundennummer ließ sich nicht setzen. Nichts gespeichert, bitte erneut versuchen.' }]));
      params.set('eingabe', JSON.stringify(eingabe));
      return redirect(`/admin/einstellungen/regeln?${params.toString()}`, 303);
    }
    await protokolliere(brand, session.email, { bereich: 'einstellungen', aktion: 'Nächste Kundennummer geändert',
      vorher: { naechste: kundennummerText(kdStand.naechste) }, nachher: { naechste: kundennummerText(kdNeu) } });
  }
  const vorherR = { ...(await ladeRegeln(brand)), einheiten: (await ladeEinheiten(brand)).join(', ') } as Record<string, unknown>;
  await speichereRegeln(brand, werte);
  await speichereEinheiten(brand, einheiten.werte);
  const nachherR = { ...werte, einheiten: einheiten.werte.join(', ') } as Record<string, unknown>;
  const d = unterschied(vorherR, nachherR, Object.keys(nachherR));
  if (d) await protokolliere(brand, session.email, { bereich: 'einstellungen', aktion: 'Regeln geändert', vorher: d.vorher, nachher: d.nachher });
  return redirect('/admin/einstellungen/regeln?saved=1', 303);
};
