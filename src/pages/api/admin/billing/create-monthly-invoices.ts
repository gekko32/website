// Rechnungswesen Stufe 3, T10b: Monatslauf (K28, K29). Aufruf am Monatsersten durch den
// CronJob monthly-billing (X-Cron-Secret) oder von Hand unter Offene Posten. Es entstehen
// nur Entwürfe – verschickt wird erst nach Geralds Prüfung.
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../lib/auth';
import { monatslauf, vormonat } from '../../../../lib/billing-abrechnungslauf';

export const POST: APIRoute = async ({ request , locals }) => {
  const cronSecret  = request.headers.get('X-Cron-Secret');
  const session     = await getSession(request.headers.get('cookie'));
  const isCron      = !!cronSecret && !!process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET;
  const isAdminUser = !!session && isAdmin(session);
  // K43 (Prüfung L3, B5): ohne Anmeldung „nicht angemeldet“, angemeldet ohne Adminrecht 403.
  if (!isCron && !session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isCron && !isAdminUser) return new Response(null, { status: 403 });

  const url    = new URL(request.url);
  const dryRun = url.searchParams.get('dryRun') === 'true';

  const body = await request.json().catch(() => ({})) as { year?: unknown; month?: unknown };
  const standard = vormonat(new Date());
  const year  = body.year  === undefined ? standard.jahr  : Number(body.year);
  const month = body.month === undefined ? standard.monat : Number(body.month);
  if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return Response.json({ error: 'Bitte einen gültigen Monat wählen.' }, { status: 400 });
  }

  const brand = process.env.BRAND || 'mentolder';
  try {
    const r = await monatslauf(brand, year, month, { nurPlanen: dryRun });
    if (r.fehler.length > 0) locals.requestLogger.error({ fehler: r.fehler }, '[billing/monatslauf] einzelne Entwürfe gescheitert');
    return Response.json({
      dryRun, period: r.monat, created: r.angelegt, skipped: r.uebersprungen, errors: r.fehler,
      ...(dryRun ? { wouldCreate: r.geplant.length, preview: r.geplant } : {}),
    });
  } catch (err) {
    locals.requestLogger.error({ err }, '[api/admin/billing/create-monthly-invoices] POST error:');
    return Response.json({ error: 'monthly_invoices_failed' }, { status: 500 });
  }
};
