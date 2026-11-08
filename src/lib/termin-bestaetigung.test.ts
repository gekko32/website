import { describe, it, expect } from 'vitest';
import { bestaetigungsMail } from './termin-bestaetigung';
import { mergeContentEntries } from './content-db-merge';

const basis = { name: 'Anna <b>', typeLabel: 'Erstgespräch', datum: 'Montag, 09.11.2026', uhrzeit: '10:00 - 10:30', marke: 'mentolder' };

describe('Bestätigungsmail', () => {
  it('enthält den Verwalten-Link und den AGB-Hinweis nur, wenn sie gelten', () => {
    const ohne = bestaetigungsMail(basis);
    expect(ohne.text).not.toContain('umbuchen');
    expect(ohne.text).not.toContain('AGB');
    const mit = bestaetigungsMail({ ...basis, verwaltenUrl: 'https://x/anfrage/abc', agbAngehaengt: true });
    expect(mit.text).toContain('https://x/anfrage/abc');
    expect(mit.html).toContain('href="https://x/anfrage/abc"');
    expect(mit.text).toContain('AGB');
  });
  it('maskiert Eingaben im HTML', () => {
    expect(bestaetigungsMail(basis).html).toContain('Anna &lt;b&gt;');
  });
});

describe('Content-DB', () => {
  it('stürzt nicht ab, wenn die Datenbank echte Datumswerte liefert', () => {
    const q = { id: 'q', title: 'F', dimension_count: 1, created_at: new Date('2026-01-01T00:00:00Z') } as any;
    const c = { id: 'c', title: 'V', created_at: new Date('2026-02-01T00:00:00Z') } as any;
    const liste = mergeContentEntries([q], [], [c]);
    expect(liste.map((e) => e.id)).toEqual(['c', 'q']);
    expect(typeof liste[0].createdAt).toBe('string');
  });
});
