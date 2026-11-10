/**
 * Oeffentliche Origin der laufenden Instanz fuer Sitemap, robots.txt, hreflang und og:url.
 *
 * SITE_URL ist die tatsaechliche Adresse (massage.<domain> fuer BRAND=massage).
 * Ohne SITE_URL faellt sie auf das bisherige `https://web.<PROD_DOMAIN>` zurueck.
 */
export function siteOrigin(): string {
  const siteUrl = (process.env.SITE_URL ?? '').trim();
  if (siteUrl) return siteUrl.replace(/\/+$/, '');
  const prodDomain = process.env.PUBLIC_PROD_DOMAIN ?? process.env.PROD_DOMAIN ?? '';
  return prodDomain ? `https://web.${prodDomain}` : '';
}

/**
 * Adresse für Links in E-Mails. Hinter dem Proxy nennt die Anfrage selbst
 * nur die interne Adresse (localhost:4321), deshalb zuerst die öffentliche.
 */
export function oeffentlicheBasis(request: Request): string {
  return (siteOrigin() || new URL(request.url).origin).replace(/\/+$/, '');
}
