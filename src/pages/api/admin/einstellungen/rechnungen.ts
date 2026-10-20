import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../lib/auth';
import { setSiteSetting } from '../../../../lib/website-db';
import { setTaxMode } from '../../../../lib/tax-monitor';
import { normalisiereUstId, pruefeSteuerangaben } from '../../../../lib/billing-absender';
import { pruefeZahlungsziel } from '../../../../lib/billing-regeln';

const STRING_KEYS = ['invoice_sender_name','invoice_sender_street','invoice_sender_city','invoice_sender_phone','invoice_bank_iban','invoice_bank_bic','invoice_bank_name','invoice_tax_number','invoice_manager'] as const;

export const POST: APIRoute = async ({ request, redirect }) => {
  const session = await getSession(request.headers.get('cookie'));
  // Stufe 3 (K43): ohne Anmeldung „nicht angemeldet“, ohne Admin-Recht verboten.
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });

  const form = await request.formData();
  const brand = process.env.BRAND || 'mentolder';

  // Stufe 3 (K36a, K39): Ins USt-IdNr.-Feld nur eine gültige USt-IdNr., Zahlungsziel
  // 0–365 Tage. Bei einem Fehler wird gar nichts gespeichert und die Seite zeigt den Grund.
  const ustRoh = ((form.get('invoice_vat_id') as string) ?? '').trim();
  const steuerRoh = ((form.get('invoice_tax_number') as string) ?? '').trim();
  const ustFehler = pruefeSteuerangaben(ustRoh, steuerRoh);
  const zahlungsziel = pruefeZahlungsziel(form.get('invoice_payment_days') as string | null);
  if (ustFehler.length > 0 || zahlungsziel.fehler) {
    const params = new URLSearchParams({ ustEingabe: ustRoh, zahlungszielEingabe: String(form.get('invoice_payment_days') ?? '') });
    if (ustFehler.length > 0) params.set('ustFehler', ustFehler[0].meldung);
    if (zahlungsziel.fehler) params.set('zahlungszielFehler', zahlungsziel.fehler);
    return redirect(`/admin/einstellungen/rechnungen?${params.toString()}`, 303);
  }

  const saves: Promise<void>[] = [];
  saves.push(setSiteSetting(brand, 'invoice_vat_id', ustRoh === '' ? '' : normalisiereUstId(ustRoh)));
  saves.push(setSiteSetting(brand, 'invoice_payment_days', String(zahlungsziel.wert)));

  for (const key of STRING_KEYS) {
    saves.push(setSiteSetting(brand, key, (form.get(key) as string)?.trim() ?? ''));
  }

  const rawMode = form.get('tax_mode') as string;
  // Steuersatz: bei Kleinunternehmer immer 0, sonst geparst aus Form (float, geklammert auf 0–100)
  const isKleinunternehmer = rawMode === 'kleinunternehmer';
  const rawRate = parseFloat(form.get('invoice_tax_rate') as string);
  const taxRate = isKleinunternehmer ? 0 : (isNaN(rawRate) ? 19 : Math.max(0, Math.min(100, rawRate)));
  saves.push(setSiteSetting(brand, 'invoice_tax_rate', String(taxRate)));

  if (rawMode === 'kleinunternehmer' || rawMode === 'regelbesteuerung') {
    saves.push(setTaxMode(brand, rawMode, { notes: 'Manuell geändert über Einstellungen' }));
  }

  await Promise.all(saves);
  return redirect('/admin/einstellungen/rechnungen?saved=1', 303);
};
