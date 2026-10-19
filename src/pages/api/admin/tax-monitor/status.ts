import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../lib/auth';
import {
  getYearRevenue, checkThreshold, getTaxMode, mussRegelbesteuern,
  THRESHOLD_KLEIN, THRESHOLD_WARNING, THRESHOLD_HARD,
} from '../../../../lib/tax-monitor';

export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session || !isAdmin(session)) return new Response('Unauthorized', { status: 401 });
  const brand = process.env.BRAND || 'mentolder';
  const year  = new Date().getFullYear();
  const [revenue, prevYearRevenue, taxMode] = await Promise.all([
    getYearRevenue(brand, year), getYearRevenue(brand, year - 1), getTaxMode(brand),
  ]);
  const status = checkThreshold(revenue);
  return new Response(JSON.stringify({
    year, revenue, prevYearRevenue, taxMode, status,
    // true = schon die Plattform-Umsätze verlangen Regelbesteuerung (§ 19 UStG ab 2025)
    mussRegelbesteuern: mussRegelbesteuern(prevYearRevenue, revenue),
    thresholdWarning: THRESHOLD_WARNING, thresholdKlein: THRESHOLD_KLEIN, thresholdHard: THRESHOLD_HARD,
    percentToLimit: Math.min(100, (revenue / THRESHOLD_KLEIN) * 100),
  }), { headers: { 'Content-Type': 'application/json' } });
};
