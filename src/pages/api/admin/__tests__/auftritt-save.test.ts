// SPEZ-NEUER-AUFTRITT K202, K204, K207: Leistungsseiten, Auftritt und Geschichten gehen über die Publish-Pipeline.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  publishContent: vi.fn(),
  readMainContent: vi.fn(),
  getSession: vi.fn(),
  isAdmin: vi.fn(),
}));

vi.mock('../../../../lib/content-publish', () => ({
  publishContent: mocks.publishContent,
  readMainContent: mocks.readMainContent,
}));
vi.mock('../../../../lib/auth', () => ({
  getSession: mocks.getSession,
  isAdmin: mocks.isAdmin,
}));

const adminCtx = { requestLogger: { error: vi.fn() } };

function req(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'workspace_session=test' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.publishContent.mockReset();
  mocks.readMainContent.mockReset();
  mocks.getSession.mockResolvedValue({ email: 'admin@example.com' });
  mocks.isAdmin.mockReturnValue(true);
});

describe('service-page/save', () => {
  it('veröffentlicht die geänderte services.json (bisher passierte nichts)', async () => {
    mocks.readMainContent.mockRejectedValue(new Error('kein Token'));
    mocks.publishContent.mockResolvedValue({ ok: true, sha: 'abc', prNumber: 7, prUrl: 'https://x/pr/7' });
    const { POST } = await import('../service-page/save');
    const url = 'http://x/api/admin/service-page/save?slug=verwaltung';
    const res = await POST({
      request: req(url, { headline: 'Neu', intro: 'Intro', forWhom: [], pricing: [] }),
      url: new URL(url),
      locals: adminCtx,
    } as never);
    expect(res.status).toBe(200);
    const aufruf = mocks.publishContent.mock.calls[0][0];
    expect(aufruf.domain).toBe('services');
    const verwaltung = aufruf.payload.find((s: { slug: string }) => s.slug === 'verwaltung');
    expect(verwaltung.pageContent.headline).toBe('Neu');
  });
});

describe('auftritt/save und geschichten/save', () => {
  it('reicht baseSha weiter und meldet einen Konflikt mit 409', async () => {
    mocks.publishContent.mockResolvedValue({ ok: false, status: 409, currentSha: 'neu', currentValue: [] });
    const { POST } = await import('../geschichten/save');
    const res = await POST({
      request: req('http://x/api/admin/geschichten/save', { payload: [], baseSha: 'alt' }),
      locals: adminCtx,
    } as never);
    expect(res.status).toBe(409);
    expect(mocks.publishContent.mock.calls[0][0]).toMatchObject({ domain: 'geschichten', baseSha: 'alt' });
  });

  it('meldet fehlende Pflichtfelder mit 422', async () => {
    mocks.publishContent.mockResolvedValue({ ok: false, status: 422, errors: ['beispiele.0.titel: Titel fehlt'] });
    const { POST } = await import('../auftritt/save');
    const res = await POST({
      request: req('http://x/api/admin/auftritt/save', { payload: {}, baseSha: null }),
      locals: adminCtx,
    } as never);
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toEqual(['beispiele.0.titel: Titel fehlt']);
  });
});
