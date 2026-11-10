// Rechnungswesen Stufe 3, T9 (K21): öffentliche Absageregel für das Buchungsformular.
// Liefert nur die Werte, die ohnehin in den AGB stehen.
import type { APIRoute } from 'astro';
import { ladeRegelTokenWerte } from '../../lib/billing-regeln';
import { ladeErstgespraech, ERSTGESPRAECH_VORGABE } from '../../lib/buchungs-einstellungen';

export const GET: APIRoute = async () => {
  const brand = process.env.BRAND || 'mentolder';
  const werte = await ladeRegelTokenWerte(brand);
  const erstgespraech = await ladeErstgespraech(brand).catch(() => ERSTGESPRAECH_VORGABE);
  return new Response(JSON.stringify({ ausfallFrist: werte.ausfallFrist, ausfallHoehe: werte.ausfallHoehe, erstgespraech }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
