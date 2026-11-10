import { describe, it, expect, vi } from 'vitest';

vi.mock('../messaging-db-pool', () => ({ pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));

import { POST } from '../../pages/api/anfrage/[token]/storno';
import { generateRequestToken } from '../appointment-requests';

function aufruf(accept: string) {
  const token = generateRequestToken();
  const request = new Request(`http://x/api/anfrage/${token}/storno`, {
    method: 'POST',
    headers: { accept, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'note=',
  });
  return { token, antwort: POST({ request, params: { token }, locals: { requestLogger: { error: vi.fn(), warn: vi.fn() } } } as never) };
}

describe('Storno vom Klientenlink', () => {
  it('führt den Browser zurück auf die Seite und meldet den Fehler dort', async () => {
    const { token, antwort } = aufruf('text/html');
    const r = await antwort;
    expect(r.status).toBe(303);
    expect(r.headers.get('Location')).toBe(`/anfrage/${token}?fehler=1`);
  });
  it('antwortet anderen Aufrufern weiter mit Daten', async () => {
    const r = await aufruf('application/json').antwort;
    expect(r.status).toBe(404);
  });
});
