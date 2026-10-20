import type { APIRoute } from 'astro';
import { getEffectiveLeistungen } from '../../lib/content';
import { getSession, isAdmin } from '../../lib/auth';
import { katalogIntern, websiteLeistungen } from '../../lib/billing-leistungen';

// Stufe 3 T4 (K7): Besucher sehen nur aktive Website-Leistungen, Admins alle aktiven.
export const GET: APIRoute = async ({ locals, request }) => {
  try {
    const brand = process.env.BRAND || 'mentolder';
    const brandId = process.env.BRAND_ID ?? brand;
    const session = await getSession(request.headers.get('cookie')).catch(() => null);
    const cats = brandId === 'massage' ? await getEffectiveLeistungen()
      : session && isAdmin(session) ? await katalogIntern(brand)
      : await websiteLeistungen(brand);
    const flat = cats.flatMap(cat =>
      cat.services.map(svc => ({
        key: svc.key,
        name: svc.name,
        category: cat.title,
        durationMin: svc.durationMin ?? null,
      }))
    );
    return new Response(JSON.stringify(flat), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    locals.requestLogger.error({ err }, '[GET /api/leistungen] error:');
    return new Response(JSON.stringify({ error: 'Interner Serverfehler.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
