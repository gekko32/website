import { describe, it, expect, vi } from 'vitest';

vi.mock('./website-db', () => ({ pool: { query: vi.fn() } }));
vi.mock('./billing-empfaenger', async (orig) => ({
  ...(await orig<typeof import('./billing-empfaenger')>()),
  kundennummerVon: async (id: string | null) => (id ? 'M1090' : undefined),
}));

const {
  dateiTeil, namensTeil, zeitraumTeil, belegDateiname, rechnungsArt, mahnungsArt,
  rechnungsDateiname, angebotsDateiname, mahnungsDateiname, inTransaktion, MAX_LAENGE,
} = await import('./beleg-dateiname');

const NAME_RE = /^[A-Za-z0-9_-]+\.(pdf|xml)$/;

describe('Sprechende Dateinamen (K117–K122)', () => {
  it('K118: Umlaute ausgeschrieben, Akzente weg, Sonderzeichen → „-“, kein „_“ im Feld', () => {
    expect(dateiTeil('Müller & Söhne GmbH')).toBe('Mueller-Soehne-GmbH');
    expect(dateiTeil('Straße_Größe')).toBe('Strasse-Groesse');
    expect(dateiTeil('José Łódź / Ærø')).toBe('Jose-Lodz-Aero');
    expect(dateiTeil('  --x--  ')).toBe('x');
    expect(dateiTeil(null)).toBe('');
  });
  it('Name: Person nach Nachnamen, Firma mit z. Hd.', () => {
    expect(namensTeil({ name: 'Anna Müller' })).toBe('Mueller-Anna');
    expect(namensTeil({ name: 'Anna Maria Müller' })).toBe('Mueller-Anna-Maria');
    expect(namensTeil({ name: 'Cher' })).toBe('Cher');
    expect(namensTeil({ name: 'Vera Vorlage', company: 'Vorlagen GmbH' })).toBe('Vorlagen-GmbH-zHd-Vera-Vorlage');
    expect(namensTeil({ name: 'Vorlagen GmbH', company: 'Vorlagen GmbH' })).toBe('Vorlagen-GmbH');
  });
  it('Prüfung N6: Komma, Titel, Namenszusätze', () => {
    expect(namensTeil({ name: 'Müller, Anna' })).toBe('Mueller-Anna');
    expect(namensTeil({ name: 'Dr. Anna Müller' })).toBe('Mueller-Anna-Dr');
    expect(namensTeil({ name: 'Prof. Dr. Anna Müller' })).toBe('Mueller-Anna-Prof-Dr');
    expect(namensTeil({ name: 'Anna von der Heide' })).toBe('von-der-Heide-Anna');
    expect(namensTeil({ name: 'Dr. Müller' })).toBe('Mueller-Dr');
  });
  it('Leistungszeitraum: Tag, Monat, Spanne', () => {
    expect(zeitraumTeil('2026-11-03', '2026-11-03')).toBe('20261103');
    expect(zeitraumTeil('2026-11-03', null)).toBe('20261103');
    expect(zeitraumTeil('2026-11-01', '2026-11-30')).toBe('Nov-2026');
    expect(zeitraumTeil('2026-03-02', '2026-03-20')).toBe('Maer-2026');
    expect(zeitraumTeil('2026-11-20', '2026-12-15')).toBe('20261120-bis-20261215');
    expect(zeitraumTeil(null, null)).toBe('');
  });
  it('K117: Aufbau JJJJMMTT_Art_Nummer_Kundennr_Name_Inhalt.pdf wie im Beispiel', () => {
    expect(belegDateiname({
      datum: '2026-11-24', art: 'Rechnung', nummer: 'RE-2026-0012', kundennummer: 'M1088',
      name: namensTeil({ name: 'Anna Müller' }), inhalt: 'Coaching-Nov-2026',
    })).toBe('20261124_Rechnung_RE-2026-0012_M1088_Mueller-Anna_Coaching-Nov-2026.pdf');
  });
  it('leere Felder entfallen ohne doppelte „_“', () => {
    expect(belegDateiname({ datum: '2026-11-24', art: 'Rechnung', nummer: 'RE-1', kundennummer: null, name: '', inhalt: '' }))
      .toBe('20261124_Rechnung_RE-1.pdf');
  });
  it('K118: höchstens 120 Zeichen – erst Inhalt, dann Name gekürzt; nie „-_“ am Schnitt', () => {
    const n = belegDateiname({
      datum: '2026-11-24', art: 'Rechnung', nummer: 'RE-2026-0012', kundennummer: 'M1088',
      name: 'Sehr-Langer-Firmenname-Mit-Vielen-Woertern-GmbH-und-Co-KG-zHd-Maximiliane-Mustermann-Schulze',
      inhalt: 'Ein-ausgesprochen-langer-Auftragstitel-der-niemals-in-einen-Dateinamen-passt-Nov-2026',
    });
    expect(n.length).toBeLessThanOrEqual(MAX_LAENGE);
    expect(n).toMatch(NAME_RE);
    expect(n).not.toMatch(/-_|-\.pdf$|__/);
    expect(n.startsWith('20261124_Rechnung_RE-2026-0012_M1088_')).toBe(true);
  });
  it('Art des Schreibens', () => {
    expect(rechnungsArt('regular')).toBe('Rechnung');
    expect(rechnungsArt('gutschrift')).toBe('Gutschrift');
    expect(rechnungsArt('prepayment')).toBe('Anzahlungsrechnung');
    expect(rechnungsArt('final')).toBe('Schlussrechnung');
    expect([1, 2, 3].map(mahnungsArt)).toEqual(['Zahlungserinnerung', 'Mahnung-1', 'Mahnung-2']);
  });

  const zeile = {
    number: 'RE-2026-0012', status: 'open', kind: 'regular', datum: new Date('2026-11-24T00:00:00+01:00'),
    empfaenger: { name: 'Anna Müller', email: 'a@b.de', company: null }, kunde_name: 'Alt', kunde_firma: null,
    von: '2026-11-01', bis: '2026-11-30', kundennummer: 'M1088', bezug: null,
  };
  it('K119: Rechnung aus der Datenbank – Empfänger-Kopie, Auftragstitel, Zeitraum', async () => {
    const abfrage = vi.fn()
      .mockResolvedValueOnce({ rows: [zeile] })
      .mockResolvedValueOnce({ rows: [{ titel: 'Coaching', n: '1', ohne: '0' }] });
    expect(await rechnungsDateiname('inv-1', abfrage))
      .toBe('20261124_Rechnung_RE-2026-0012_M1088_Mueller-Anna_Coaching-Nov-2026.pdf');
  });
  it('mehrere Aufträge oder keine Auftragstabelle → nur Zeitraum; XML-Endung', async () => {
    const mehrere = vi.fn().mockResolvedValueOnce({ rows: [zeile] }).mockResolvedValueOnce({ rows: [{ titel: 'A', n: '2', ohne: '0' }] });
    expect(await rechnungsDateiname('inv-1', mehrere)).toBe('20261124_Rechnung_RE-2026-0012_M1088_Mueller-Anna_Nov-2026.pdf');
    const ohne = vi.fn().mockResolvedValueOnce({ rows: [zeile] }).mockRejectedValueOnce(new Error('relation does not exist'));
    expect(await rechnungsDateiname('inv-1', ohne, 'xml')).toBe('20261124_Rechnung_RE-2026-0012_M1088_Mueller-Anna_Nov-2026.xml');
  });
  it('Gutschrift: Inhalt ist die Bezugsrechnung; Firma ohne Kopie aus dem Rechnungskunden', async () => {
    const abfrage = vi.fn().mockResolvedValueOnce({ rows: [{
      ...zeile, number: 'GS-2026-0002', kind: 'gutschrift', datum: '2026-12-01', empfaenger: null,
      kunde_name: 'Vera Vorlage', kunde_firma: 'Vorlagen GmbH', bezug: 'RE-2026-0012',
    }] }).mockResolvedValueOnce({ rows: [] });
    expect(await rechnungsDateiname('gs-1', abfrage))
      .toBe('20261201_Gutschrift_GS-2026-0002_M1088_Vorlagen-GmbH-zHd-Vera-Vorlage_zu-RE-2026-0012.pdf');
  });
  it('Fehler oder unbekannte Rechnung → null (Aufrufer nimmt die Nummer)', async () => {
    expect(await rechnungsDateiname('x', vi.fn().mockRejectedValue(new Error('down')))).toBeNull();
    expect(await rechnungsDateiname('x', vi.fn().mockResolvedValue({ rows: [] }))).toBeNull();
  });
  it('Angebot: Auftragstitel als Inhalt; Entwurf statt interner Kennung', async () => {
    const a = {
      datum: '2026-11-02', number: 'AN-2026-0003-2', status: 'verschickt', klientId: 'k1', auftragTitel: 'Strategietag',
      empfaenger: { name: 'Vera Vorlage', company: 'Vorlagen GmbH' },
    } as never;
    expect(await angebotsDateiname(a)).toBe('20261102_Angebot_AN-2026-0003-2_M1090_Vorlagen-GmbH-zHd-Vera-Vorlage_Strategietag.pdf');
    expect(await angebotsDateiname({ ...(a as object), status: 'entwurf', number: 'ENTWURF-AB12', klientId: null } as never))
      .toBe('20261102_Angebot_Entwurf_Vorlagen-GmbH-zHd-Vera-Vorlage_Strategietag.pdf');
    // Prüfung N5: Entwurf ohne gespeicherten Empfänger → Empfänger der Vorschau
    expect(await angebotsDateiname({ ...(a as object), status: 'entwurf', empfaenger: null, klientId: null } as never, { name: 'Anna Müller' }))
      .toBe('20261102_Angebot_Entwurf_Mueller-Anna_Strategietag.pdf');
    // Prüfung N4: Fehler → Nummer
    expect(await angebotsDateiname({ ...(a as object), datum: undefined, empfaenger: { get name(): string { throw new Error('x'); } } } as never))
      .toBe('AN-2026-0003-2.pdf');
  });
  it('Prüfung N1: freie Zeilen (ohne Auftrag) → kein Auftragstitel', async () => {
    const abfrage = vi.fn().mockResolvedValueOnce({ rows: [zeile] }).mockResolvedValueOnce({ rows: [{ titel: 'Strategietag', n: '1', ohne: '1' }] });
    expect(await rechnungsDateiname('inv-1', abfrage)).toBe('20261124_Rechnung_RE-2026-0012_M1088_Mueller-Anna_Nov-2026.pdf');
    expect(abfrage.mock.calls[1][0]).toMatch(/FROM billing_invoice_line_items l\s+LEFT JOIN abrechnungsposten/);
  });
  it('Prüfung N4: Mahnung mit ungültigem Datum → kein Absturz', () => {
    const n = mahnungsDateiname({ stufe: 1, datum: new Date('kaputt'), rechnungsnummer: 'RE-1', rechnungsdatum: null, empfaenger: { name: 'A B' } });
    expect(n).toBe('Zahlungserinnerung_RE-1_B-A.pdf');
  });
  it('Mahnung: Art wie auf dem PDF, Nummer der Rechnung, „zu Rechnung vom …“', () => {
    expect(mahnungsDateiname({
      stufe: 2, datum: '2026-12-15', rechnungsnummer: 'RE-2026-0012', rechnungsdatum: '2026-11-24',
      kundennummer: 'M1088', empfaenger: { name: 'Anna Müller' },
    })).toBe('20261215_Mahnung-1_RE-2026-0012_M1088_Mueller-Anna_zu-Rechnung-vom-20261124.pdf');
  });
  it('inTransaktion: Sicherungspunkt – Fehler wird zurückgerollt und weitergegeben', async () => {
    const calls: string[] = [];
    const client = { query: vi.fn(async (s: string) => { calls.push(s); if (s === 'KAPUTT') throw new Error('x'); return { rows: [] }; }) };
    const q = inTransaktion(client);
    await q('SELECT 1', []);
    await expect(q('KAPUTT', [])).rejects.toThrow('x');
    expect(calls).toEqual(['SAVEPOINT beleg_dateiname', 'SELECT 1', 'RELEASE SAVEPOINT beleg_dateiname',
      'SAVEPOINT beleg_dateiname', 'KAPUTT', 'ROLLBACK TO SAVEPOINT beleg_dateiname']);
  });
});
