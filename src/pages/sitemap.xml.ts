import type { APIRoute } from 'astro';
import { getEffectiveReferenzen, getEffectiveServices } from '../lib/content';
import { siteOrigin } from '../lib/site-origin';
import { getGeschichten } from '../lib/auftritt';

const BRAND_ID = process.env.BRAND_ID ?? process.env.BRAND ?? 'mentolder';
// mentolder: /leistungen leitet seit dem neuen Auftritt weiter, dafür kommen die Geschichten dazu (K187).
const STATIC_PATHS = BRAND_ID === 'mentolder'
  ? ['/', '/kontakt', '/ueber-mich']
  : ['/', '/kontakt', '/ueber-mich', '/leistungen'];

export const GET: APIRoute = async () => {
  const services = await getEffectiveServices().catch(() => []);
  // /referenzen nur listen, wenn die Brand ein Referenzen-Bundle hat (massage hat keins).
  const hasReferenzen = await getEffectiveReferenzen().then(() => true, () => false);

  const servicePaths = services
    .filter((s) => !s.hidden)
    .map((s) => `/${s.slug}`);

  const geschichten = getGeschichten(BRAND_ID);
  const geschichtenPaths = geschichten.length > 0 ? ['/geschichten', ...geschichten.map((g) => `/geschichten/${g.slug}`)] : [];

  const allPaths = [...STATIC_PATHS, ...(hasReferenzen ? ['/referenzen'] : []), ...servicePaths, ...geschichtenPaths];
  const baseUrl = siteOrigin() || 'https://web.localhost';

  const urls = allPaths.map((path) => {
    const loc = path === '/' ? baseUrl : `${baseUrl}${path}`;
    return `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>${path === '/' ? '1.0' : '0.8'}</priority>\n  </url>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
