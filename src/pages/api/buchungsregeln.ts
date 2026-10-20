// Rechnungswesen Stufe 3, T9 (K21): öffentliche Absageregel für das Buchungsformular.
// Liefert nur die Werte, die ohnehin in den AGB stehen.
import type { APIRoute } from 'astro';
import { ladeRegelTokenWerte } from '../../lib/billing-regeln';

export const GET: APIRoute = async () => {
  const werte = await ladeRegelTokenWerte(process.env.BRAND || 'mentolder');
  return new Response(JSON.stringify({ ausfallFrist: werte.ausfallFrist, ausfallHoehe: werte.ausfallHoehe }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
