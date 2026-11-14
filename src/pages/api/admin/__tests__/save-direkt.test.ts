// Admin-Speichern 422 (14.11.2026): Die Admin-Bereiche Startseite, Über mich,
// FAQ und Kontakt schicken ihre Daten direkt, ohne `{ payload, baseSha }`.
// Die Endpunkte lasen nur `body.payload` und reichten damit `undefined`
// an publishContent weiter → Zod 422. Beide Formen müssen ankommen.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIRoute } from 'astro';

const mocks = vi.hoisted(() => ({
  publishContent: vi.fn(),
  getSession: vi.fn(),
  isAdmin: vi.fn(),
}));

vi.mock('../../../../lib/content-publish', () => ({
  publishContent: mocks.publishContent,
}));
vi.mock('../../../../lib/auth', () => ({
  getSession: mocks.getSession,
  isAdmin: mocks.isAdmin,
}));

function req(body: unknown): Request {
  return new Request('http://x/api/admin/x/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'workspace_session=test' },
    body: JSON.stringify(body),
  });
}

const ctx = (request: Request) =>
  ({ request, redirect: () => new Response(null), locals: { requestLogger: { error: vi.fn() } } }) as unknown as Parameters<APIRoute>[0];

const faelle: Array<{ name: string; domain: string; laden: () => Promise<{ POST: APIRoute }>; daten: unknown }> = [
  { name: 'startseite', domain: 'homepage', laden: () => import('../startseite/save'), daten: { hero: { title: 'T' } } },
  { name: 'uebermich', domain: 'ueber-mich', laden: () => import('../uebermich/save'), daten: { pageHeadline: 'Ü' } },
  { name: 'faq', domain: 'faq', laden: () => import('../faq/save'), daten: [{ question: 'F?', answer: 'A' }] },
  { name: 'kontakt', domain: 'kontakt', laden: () => import('../kontakt/save'), daten: { intro: 'Hallo' } },
];

beforeEach(() => {
  mocks.publishContent.mockReset();
  mocks.getSession.mockResolvedValue({ email: 'admin@example.com' });
  mocks.isAdmin.mockReturnValue(true);
  mocks.publishContent.mockResolvedValue({ ok: true, sha: 'S', blobSha: 'B', prNumber: 1, prUrl: 'u' });
});

describe('Admin-Speichern nimmt Daten direkt und in der Hülle an', () => {
  for (const f of faelle) {
    it(`${f.name}: Daten direkt kommen als payload an`, async () => {
      const { POST } = await f.laden();
      const res = await POST(ctx(req(f.daten)));
      expect(res.status).toBe(200);
      const [arg] = mocks.publishContent.mock.calls[0] as [{ domain: string; payload: unknown; baseSha: unknown }];
      expect(arg.domain).toBe(f.domain);
      expect(arg.payload).toEqual(f.daten);
      expect(arg.baseSha).toBeNull();
    });

    it(`${f.name}: { payload, baseSha } wird weiter verstanden`, async () => {
      const { POST } = await f.laden();
      const res = await POST(ctx(req({ payload: f.daten, baseSha: 'ALT' })));
      expect(res.status).toBe(200);
      const [arg] = mocks.publishContent.mock.calls[0] as [{ payload: unknown; baseSha: unknown }];
      expect(arg.payload).toEqual(f.daten);
      expect(arg.baseSha).toBe('ALT');
    });
  }
});
