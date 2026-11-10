import { describe, it, expect, vi } from 'vitest';

vi.mock('./website-core-db', () => ({ getSiteSetting: vi.fn(), setSiteSetting: vi.fn() }));

import { getSiteSetting } from './website-core-db';
import { ladeErstgespraech, ortFuerBuchung } from './buchungs-einstellungen';

const lesen = getSiteSetting as unknown as ReturnType<typeof vi.fn>;

describe('Erstgespräch-Einstellungen', () => {
  it('bietet ohne Einstellung beides an und bucht nicht sofort', async () => {
    lesen.mockResolvedValue(null);
    expect(await ladeErstgespraech('m')).toEqual({ online: true, vorOrt: true, telefon: false, sofort: false });
  });
  it('liest die gespeicherten Werte', async () => {
    lesen.mockImplementation(async (_b: string, k: string) => (k === 'erstgespraech_vor_ort' ? 'false' : 'true'));
    expect(await ladeErstgespraech('m')).toEqual({ online: true, vorOrt: false, telefon: true, sofort: true });
  });
});

describe('Ort einer Buchung', () => {
  it('fragt bei nur einem Angebot nicht nach', () => {
    expect(ortFuerBuchung({ online: true, vorOrt: false, telefon: false }, 'vor-ort')).toBe('online');
    expect(ortFuerBuchung({ online: false, vorOrt: true, telefon: false }, null)).toBe('vor-ort');
    expect(ortFuerBuchung({ online: false, vorOrt: false, telefon: true }, null)).toBe('telefon');
  });
  it('übernimmt bei beiden Angeboten die Wahl und weist Unsinn ab', () => {
    const beide = { online: true, vorOrt: true, telefon: false };
    expect(ortFuerBuchung(beide, 'vor-ort')).toBe('vor-ort');
    expect(ortFuerBuchung(beide, undefined)).toBeNull();
    expect(ortFuerBuchung(beide, 'mond')).toBeUndefined();
    expect(ortFuerBuchung(beide, 'telefon')).toBeUndefined();
  });
});
