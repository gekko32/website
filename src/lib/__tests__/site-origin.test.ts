import { afterEach, describe, expect, it, vi } from 'vitest';
import { siteOrigin, oeffentlicheBasis } from '../site-origin';

describe('siteOrigin', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('prefers SITE_URL so massage.<domain> is not rewritten to web.<domain>', () => {
    vi.stubEnv('SITE_URL', 'https://massage.example.test/');
    vi.stubEnv('PROD_DOMAIN', 'example.test');
    expect(siteOrigin()).toBe('https://massage.example.test');
  });

  it('falls back to web.<PROD_DOMAIN> without SITE_URL', () => {
    vi.stubEnv('SITE_URL', '');
    vi.stubEnv('PUBLIC_PROD_DOMAIN', undefined as unknown as string);
    vi.stubEnv('PROD_DOMAIN', 'brand.test');
    expect(siteOrigin()).toBe('https://web.brand.test');
  });

  it('returns an empty origin when neither is set', () => {
    vi.stubEnv('SITE_URL', '');
    vi.stubEnv('PUBLIC_PROD_DOMAIN', undefined as unknown as string);
    vi.stubEnv('PROD_DOMAIN', undefined as unknown as string);
    expect(siteOrigin()).toBe('');
  });
});

describe('oeffentlicheBasis', () => {
  it('nimmt für Mail-Links die öffentliche statt der internen Adresse', () => {
    const vorher = process.env.SITE_URL;
    process.env.SITE_URL = 'https://web.example.de/';
    expect(oeffentlicheBasis(new Request('http://localhost:4321/api/booking'))).toBe('https://web.example.de');
    if (vorher === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = vorher;
  });
});
