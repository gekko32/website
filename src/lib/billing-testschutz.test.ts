// Schutz der Live-Daten vor Test-Schnittstellen (Vorfall 21.10.2026: purge-all-test-data
// hat eine von Hand angelegte Klientenakte gelöscht).
import { describe, expect, it } from 'vitest';
import { testschnittstelleGesperrt } from './billing-testschutz';

describe('Test-Schnittstellen sind ohne ausdrückliche Freigabe gesperrt', () => {
  it.each([
    '/sdlc/api/systemtest/purge-all-test-data',
    '/sdlc/api/systemtest/cleanup-fixtures',
    '/sdlc/api/systemtest/seed',
    '/sdlc/api/testdata/purge',
    '/sdlc/api/testdata/seed',
    '/SDLC/api/systemtest/purge-all-test-data',
    '/sdlc/api/systemtest/../systemtest/purge-all-test-data',
    '/sdlc//api/systemtest/purge-all-test-data',
  ])('%s gesperrt', (pfad) => {
    expect(testschnittstelleGesperrt(pfad, {})).toBe(true);
  });

  it.each(['/admin/klienten', '/api/admin/posten', '/sdlc/api/ki/catalog', '/api/booking'])('%s frei', (pfad) => {
    expect(testschnittstelleGesperrt(pfad, {})).toBe(false);
  });

  it('nur mit SYSTEMTEST_FREIGABE=ja (z. B. auf einem Testserver) erreichbar', () => {
    expect(testschnittstelleGesperrt('/sdlc/api/systemtest/purge-all-test-data', { SYSTEMTEST_FREIGABE: 'ja' })).toBe(false);
    expect(testschnittstelleGesperrt('/sdlc/api/systemtest/purge-all-test-data', { SYSTEMTEST_FREIGABE: 'true' })).toBe(true);
  });
});
