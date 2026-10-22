// Rechnungswesen Stufe 3, T10b: Monatslauf über Abrechnungsposten (K28, K29).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const monatslauf = vi.fn();
const getSession = vi.fn();
vi.mock('../../../../lib/billing-abrechnungslauf', async (orig) => ({
  ...(await orig<typeof import('../../../../lib/billing-abrechnungslauf')>()),
  monatslauf: (...a: unknown[]) => monatslauf(...a),
}));
vi.mock('../../../../lib/auth', () => ({
  getSession: (...a: unknown[]) => getSession(...a),
  isAdmin: (s: { admin?: boolean }) => s?.admin === true,
}));

import { POST } from './create-monthly-invoices';

type RouteContext = Parameters<typeof POST>[0];
const requestLogger = { info: vi.fn(), error: vi.fn() };

const req = (opts: { secret?: string; body?: unknown; query?: string } = {}) =>
  new Request(`https://web.example.test/api/admin/billing/create-monthly-invoices${opts.query ?? ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.secret ? { 'X-Cron-Secret': opts.secret } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
const aufruf = (r: Request) => POST({ request: r, locals: { requestLogger } } as unknown as RouteContext);
const leer = { angelegt: 0, fehler: [], monat: '2026-11', uebersprungen: 0, geplant: [] };

let savedSecret: string | undefined;
beforeEach(() => {
  savedSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-secret';
  monatslauf.mockReset();
  getSession.mockReset();
  getSession.mockResolvedValue(null);
  requestLogger.error.mockReset();
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;
});

describe('POST /api/admin/billing/create-monthly-invoices', () => {
  it('K43: ohne Anmeldung und ohne richtigen Schlüssel abgewiesen', async () => {
    expect((await aufruf(req())).status).toBe(403);
    expect((await aufruf(req({ secret: 'falsch' }))).status).toBe(403);
    delete process.env.CRON_SECRET;
    expect((await aufruf(req({ secret: 'test-secret' }))).status).toBe(403);
    expect(monatslauf).not.toHaveBeenCalled();
  });

  it('CronJob am Monatsersten: läuft für den Vormonat', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-01T05:00:00Z'));
    monatslauf.mockResolvedValueOnce({ ...leer, angelegt: 2 });
    const res = await aufruf(req({ secret: 'test-secret' }));
    vi.useRealTimers();
    expect(res.status).toBe(200);
    expect(monatslauf).toHaveBeenCalledWith('mentolder', 2026, 11, { nurPlanen: false });
    expect(await res.json()).toMatchObject({ created: 2, period: '2026-11' });
  });

  it('von Hand als Admin mit gewähltem Monat', async () => {
    getSession.mockResolvedValue({ admin: true });
    monatslauf.mockResolvedValueOnce(leer);
    await aufruf(req({ body: { year: 2026, month: 10 } }));
    expect(monatslauf).toHaveBeenCalledWith('mentolder', 2026, 10, { nurPlanen: false });
  });

  it('Vorschau (dryRun) legt nichts an', async () => {
    getSession.mockResolvedValue({ admin: true });
    monatslauf.mockResolvedValueOnce({ ...leer, geplant: [{ klient: 'ACME', posten: 3 }] });
    const res = await aufruf(req({ body: { year: 2026, month: 10 }, query: '?dryRun=true' }));
    expect(monatslauf).toHaveBeenCalledWith('mentolder', 2026, 10, { nurPlanen: true });
    expect(await res.json()).toMatchObject({ dryRun: true, wouldCreate: 1 });
  });

  it('ungültiger Monat abgelehnt', async () => {
    getSession.mockResolvedValue({ admin: true });
    expect((await aufruf(req({ body: { year: 2026, month: 13 } }))).status).toBe(400);
    expect(monatslauf).not.toHaveBeenCalled();
  });

  it('einzelne gescheiterte Entwürfe brechen den Lauf nicht ab, werden aber gemeldet', async () => {
    monatslauf.mockResolvedValueOnce({ ...leer, angelegt: 1, fehler: ['ACME: Bei „X“ fehlt noch der Preis.'] });
    const res = await aufruf(req({ secret: 'test-secret' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 1, errors: ['ACME: Bei „X“ fehlt noch der Preis.'] });
    expect(requestLogger.error).toHaveBeenCalled();
  });

  it('500 mit fester Fehlermeldung, wenn die Datenbank ausfällt', async () => {
    monatslauf.mockRejectedValueOnce(new Error('db down'));
    const res = await aufruf(req({ secret: 'test-secret' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'monthly_invoices_failed' });
  });
});
