import { describe, it, expect } from 'vitest';
import { serienTage, ueberschneiden, pruefeSerie, pruefeTage, leseFeiertage, bundesweiteFeiertage, feiertageFuerLand, istEchterTag, monatsRaster, zeitListe } from './termin-planung';

describe('Serien', () => {
  it('findet die richtigen Wochentage, auch über die Zeitumstellung', () => {
    // 09.11.2026 ist ein Montag.
    expect(serienTage('2026-11-09', '2026-11-22', [2, 4])).toEqual(['2026-11-10', '2026-11-12', '2026-11-17', '2026-11-19']);
    expect(serienTage('2026-03-23', '2026-04-03', [7])).toEqual(['2026-03-29']);
    expect(serienTage('2026-11-15', '2026-11-15', [7])).toEqual(['2026-11-15']);
  });
  it('erkennt Überschneidungen, Berühren ist erlaubt', () => {
    const z = (winStart: string, winEnd: string) => ({ winStart, winEnd });
    expect(ueberschneiden(z('10:00', '12:00'), z('11:00', '13:00'))).toBe(true);
    expect(ueberschneiden(z('10:00', '12:00'), z('12:00', '14:00'))).toBe(false);
    expect(ueberschneiden(z('09:00', '17:00'), z('10:00', '11:00'))).toBe(true);
  });
  it('weist ungültige Eingaben ab', () => {
    const gut = { von: '2026-11-09', bis: '2026-12-09', wochentage: [2], winStart: '14:00', winEnd: '17:00' };
    expect(pruefeSerie(gut)).toBeNull();
    expect(pruefeSerie({ ...gut, bis: '2026-11-01' })).toMatch(/Enddatum/);
    expect(pruefeSerie({ ...gut, bis: '2028-01-01' })).toMatch(/Jahr/);
    expect(pruefeSerie({ ...gut, wochentage: [] })).toMatch(/Wochentag/);
    expect(pruefeSerie({ ...gut, wochentage: [8] })).toMatch(/Wochentag/);
    expect(pruefeSerie({ ...gut, winEnd: '13:00' })).toMatch(/vor Bis/);
    expect(pruefeSerie({ ...gut, winStart: '25:00' })).toMatch(/Uhrzeit/);
    expect(pruefeSerie({ ...gut, von: '2026-02-31' })).toMatch(/Enddatum/);
  });
});

describe('Kalender', () => {
  it('baut Monate mit Montag als erstem Tag', () => {
    // 01.11.2026 ist ein Sonntag.
    const w = monatsRaster(2026, 11);
    expect(w[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(w[1][0]).toBe('2026-11-02');
    expect(w.flat().filter(Boolean)).toHaveLength(30);
    expect(w.every((z) => z.length === 7)).toBe(true);
    expect(monatsRaster(2028, 2).flat().filter(Boolean)).toHaveLength(29);
  });
  it('liefert Uhrzeiten zum Scrollen', () => {
    const z = zeitListe(6, 22, 15);
    expect(z[0]).toBe('06:00');
    expect(z[1]).toBe('06:15');
    expect(z[z.length - 1]).toBe('22:00');
  });
  it('prüft die Tagesauswahl', () => {
    const gut = { tage: ['2026-11-10'], winStart: '14:00', winEnd: '17:00' };
    expect(pruefeTage(gut)).toBeNull();
    expect(pruefeTage({ ...gut, tage: [] })).toMatch(/mindestens/);
    expect(pruefeTage({ ...gut, tage: ['2026-02-31'] })).toMatch(/ungültig/);
    expect(pruefeTage({ ...gut, winEnd: '10:00' })).toMatch(/vor Bis/);
  });
});

describe('Feiertage', () => {
  it('berücksichtigt das Bundesland', () => {
    expect(feiertageFuerLand(2027, 'HH')).toContain('2027-10-31');
    expect(feiertageFuerLand(2027, 'HH')).not.toContain('2027-01-06');
    const by = feiertageFuerLand(2027, 'BY');
    expect(by).toContain('2027-01-06');
    expect(by).toContain('2027-05-27'); // Fronleichnam
    expect(by).toContain('2027-11-01');
    expect(by).not.toContain('2027-10-31');
    expect(feiertageFuerLand(2026, 'SN')).toContain('2026-11-18'); // Buß- und Bettag
    expect(feiertageFuerLand(2027, 'BE')).toContain('2027-03-08');
  });
  it('liest deutsche und technische Schreibweise', () => {
    expect(leseFeiertage('24.12.2026\n\n2026-12-31\n 1.1.2027 ').werte).toEqual(['2026-12-24', '2026-12-31', '2027-01-01']);
    expect(leseFeiertage('31.02.2026').fehler).toMatch(/gültiges/);
  });
  it('kennt die bundesweiten Feiertage 2027', () => {
    // Ostersonntag 2027 ist der 28. März.
    expect(bundesweiteFeiertage(2027)).toEqual([
      '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-01', '2027-05-06', '2027-05-17',
      '2027-10-03', '2027-12-25', '2027-12-26',
    ]);
    expect(bundesweiteFeiertage(2026).every(istEchterTag)).toBe(true);
  });
});
