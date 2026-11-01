import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../lib/auth';
import { bundleServices } from '../../../../lib/content-bundle';
import { publishContent, readMainContent } from '../../../../lib/content-publish';
import { publishResultToResponse } from '../../../../lib/content-publish-handler';
import type { ServiceOverride } from '../../../../lib/website-db';
import { config } from '../../../../config/index';

const BRAND = process.env.BRAND || 'mentolder';

export const POST: APIRoute = async ({ request, url , locals }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session || !isAdmin(session)) return new Response('Forbidden', { status: 403 });

  const slug = url.searchParams.get('slug');
  if (!slug) return new Response(JSON.stringify({ error: 'slug required' }), {
    status: 400, headers: { 'Content-Type': 'application/json' },
  });

  // Request payload shape, restricted to the fields read below.
  interface ServicePageSaveBody {
    introNote?: string;
    sections?: Array<{ title: string; items: string[] }>;
    cardTitle?: string;
    cardDescription?: string;
    cardIcon?: string;
    cardFeatures?: string[];
    cardPrice?: string;
    headline?: string;
    intro?: string;
    forWhom?: string[];
    pricing?: Array<{ label: string; price: string; unit?: string; highlight?: boolean }>;
    faq?: Array<{ question: string; answer: string }>;
    seoTitle?: string;
    seoDescription?: string;
  }

  let body: ServicePageSaveBody;
  try { body = (await request.json()) as ServicePageSaveBody; }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
    status: 400, headers: { 'Content-Type': 'application/json' },
  }); }

  try {
    // Vom neuesten Stand in main ausgehen; ohne GitHub-Zugang (lokal) vom ausgelieferten Bundle.
    const fromMain = await readMainContent(BRAND, 'services').then((r) => r.value).catch(() => null);
    const existing = (Array.isArray(fromMain) ? fromMain : (bundleServices(BRAND) ?? [])) as ServiceOverride[];
    const staticSvc = config.services.find(s => s.slug === slug);
    const idx = existing.findIndex((s) => s.slug === slug);

    // Build sections: introNote als __introNote__ wenn vorhanden
    const introNoteItems = body.introNote?.trim()
      ? body.introNote.split('\n\n').filter(Boolean)
      : null;
    const sections = [
      ...(introNoteItems ? [{ title: '__introNote__', items: introNoteItems }] : []),
      ...(body.sections ?? []),
    ];

    const prev = (idx >= 0 ? existing[idx] : null) as (ServiceOverride & { hidden?: boolean }) | null;
    const isCatalogLinked = !!(prev?.leistungCategoryId);

    // Vorhandene Felder (z. B. iconSpriteId, stripeServiceKey) behalten, nur die Formularfelder überschreiben.
    const override: ServiceOverride & { hidden?: boolean } = {
      ...(prev ?? {}),
      slug,
      title: body.cardTitle ?? staticSvc?.title ?? slug,
      description: body.cardDescription ?? staticSvc?.description ?? '',
      icon: body.cardIcon ?? staticSvc?.icon ?? '✨',
      features: body.cardFeatures ?? staticSvc?.features ?? [],
      hidden: prev?.hidden ?? false,
      // Preserve catalog linkage — strip legacy price/pricing when linked
      ...(prev?.leistungCategoryId ? { leistungCategoryId: prev.leistungCategoryId } : {}),
      ...(prev?.headlineKey ? { headlineKey: prev.headlineKey } : {}),
      ...(prev?.headlinePrefix != null ? { headlinePrefix: prev.headlinePrefix } : {}),
      // Preserve catalog linkage — strip legacy price when linked
      price: isCatalogLinked ? '' : (body.cardPrice ?? staticSvc?.price ?? ''),
      pageContent: {
        headline: body.headline ?? '',
        intro: body.intro ?? '',
        forWhom: body.forWhom ?? [],
        sections,
        pricing: isCatalogLinked ? [] : (body.pricing ?? []),
        faq: body.faq ?? [],
        seoTitle: body.seoTitle || undefined,
        seoDescription: body.seoDescription || undefined,
      },
    };

    if (idx >= 0) existing[idx] = override;
    else existing.push(override);

    // SPEZ-NEUER-AUFTRITT K202: bisher wurde hier nichts gespeichert (Antwort 202 ohne Veröffentlichung).
    // Jetzt geht die geänderte services.json über die Publish-Pipeline (Zod 422, PR, Auto-Merge).
    const editor = session.email ?? session.name ?? 'unknown';
    const result = await publishContent({ brand: BRAND, domain: 'services', payload: existing, baseSha: null, editor });
    return publishResultToResponse(result);
  } catch (err) {
    locals.requestLogger.error({ err }, '[service-page/save] DB error:');
    return new Response(JSON.stringify({ error: 'DB error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
