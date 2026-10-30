import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSiteSetting = vi.fn();
const sendEmail = vi.fn();
vi.mock('./website-db', () => ({ getSiteSetting: (...a: unknown[]) => getSiteSetting(...a) }));
vi.mock('./email', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock('./logger', () => ({ logger: { warn: vi.fn() } }));

import { mahnungsMailText, meldeNeueMahnungen } from './mahnung-meldung';

const offen = [{ id: 'd1', invoiceId: 'i1', invoiceNumber: 'RE-2026-0005', level: 1, customerEmail: '', customerName: 'Test Ohne Mail',
  outstanding: 60, feeAmount: 0, interestAmount: 0, pdfPath: '' }];

beforeEach(() => { getSiteSetting.mockReset(); sendEmail.mockReset(); sendEmail.mockResolvedValue(true); });

describe('Mahnungs-Mail an Gerald (K160)', () => {
  it('nennt Klient, Rechnung, Stufe, Betrag und den Link', () => {
    const t = mahnungsMailText(1, offen, 'https://web.mentolder.de/admin/rechnungen?status=mahnwesen');
    expect(t).toContain('eine neue Mahnung');
    expect(t).toContain('Test Ohne Mail: Rechnung RE-2026-0005, Mahnstufe 1');
    expect(t).toContain('status=mahnwesen');
  });

  it('schickt nur bei neuen Mahnungen und wenn der Schalter nicht aus ist', async () => {
    getSiteSetting.mockResolvedValue(null);
    process.env.CONTACT_EMAIL = 'info@mentolder.de';
    await meldeNeueMahnungen('mentolder', 0, offen);
    expect(sendEmail).not.toHaveBeenCalled();
    await meldeNeueMahnungen('mentolder', 1, offen);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe('info@mentolder.de');
    getSiteSetting.mockImplementation(async (_b: string, k: string) => (k === 'notify_mahnung' ? 'false' : null));
    await meldeNeueMahnungen('mentolder', 2, offen);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
