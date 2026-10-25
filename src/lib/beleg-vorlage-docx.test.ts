import { describe, it, expect } from 'vitest';
import { inflateRawSync } from 'zlib';
import { zip, crc32 } from './zip-schreiber';
import { briefbogenDocx } from './beleg-vorlage-docx';

/** ZIP lesen (nur das, was zip() schreibt): Name → Inhalt. */
function entpacke(b: Buffer): Map<string, Buffer> {
  const m = new Map<string, Buffer>();
  let i = 0;
  while (b.readUInt32LE(i) === 0x04034b50) {
    const gross = b.readUInt32LE(i + 18), nameLen = b.readUInt16LE(i + 26), extraLen = b.readUInt16LE(i + 28);
    const name = b.subarray(i + 30, i + 30 + nameLen).toString('utf8');
    const start = i + 30 + nameLen + extraLen;
    const inhalt = inflateRawSync(b.subarray(start, start + gross));
    expect(crc32(inhalt)).toBe(b.readUInt32LE(i + 14));
    m.set(name, inhalt);
    i = start + gross;
  }
  return m;
}

const absender = {
  name: 'mentolder', address: 'Barckhausenstr. 79', postalCode: '21335', city: 'Lüneburg', country: 'DE', vatId: '', taxNumber: '33/023/05100',
  iban: 'DE58100110012774381324', bic: 'NTSBDEB1XXX', bankName: 'N26', email: 'info@mentolder.de', phone: '+49 151', website: 'mentolder.de', inhaber: 'Gerald Korczewski',
};

describe('Blanko-Briefbogen als Word-Datei (K115)', () => {
  it('zip(): gültige Einträge, Prüfsummen stimmen', () => {
    const z = entpacke(zip([{ name: 'a.txt', inhalt: 'Hallo Äpfel' }, { name: 'b/c.bin', inhalt: Buffer.from([1, 2, 3]) }]));
    expect(z.get('a.txt')!.toString()).toBe('Hallo Äpfel');
    expect([...z.get('b/c.bin')!]).toEqual([1, 2, 3]);
  });
  it('Rechnung: alle Teile, Platzhalter, Fußzeile aus den Einstellungen, Logo', () => {
    const z = entpacke(briefbogenDocx('rechnung', absender, { einleitung: 'vielen Dank & Grüße <Test>', kleinunternehmerAktiv: true, zahlungszielTage: 14 }));
    for (const n of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/header1.xml', 'word/footer1.xml', 'word/_rels/document.xml.rels']) {
      expect(z.has(n)).toBe(true);
    }
    const dok = z.get('word/document.xml')!.toString();
    expect(dok).toContain('RECHNUNG NR. [Nummer]');
    expect(dok).toContain('[Straße Hausnummer]');
    expect(dok).toContain('vielen Dank &amp; Grüße &lt;Test&gt;'); // korrekt maskiert
    expect(dok).toContain('§ 19 UStG');
    expect(dok).toContain('Zahlung innerhalb von 14 Tagen');
    const fuss = z.get('word/footer1.xml')!.toString();
    expect(fuss).toContain('Inhaber: Gerald Korczewski');
    expect(fuss).toContain('IBAN: DE58 1001 1001 2774 3813 24');
    expect(z.get('word/header1.xml')!.toString()).toContain('RECHNUNG');
    expect(z.has('word/media/logo.png')).toBe(true);
  });
  it('Prüfung B5: Steuerzeichen entfernt, Zeilenumbrüche als <w:br/>', () => {
    const steuer = String.fromCharCode(1) + String.fromCharCode(11);
    const z = entpacke(briefbogenDocx('rechnung', { ...absender, name: `mentolder${steuer}` }, { einleitung: `Zeile 1${String.fromCharCode(10)}Zeile 2`, kleinunternehmerAktiv: false, zahlungszielTage: 14 }));
    const dok = z.get('word/document.xml')!.toString();
    const fuss = z.get('word/footer1.xml')!.toString();
    for (const c of [1, 11]) { expect(dok.includes(String.fromCharCode(c))).toBe(false); expect(fuss.includes(String.fromCharCode(c))).toBe(false); }
    expect(dok).toContain('Zeile 1</w:t><w:br/><w:t xml:space="preserve">Zeile 2');
    expect(dok).toContain('[Satz] %');
  });
  it('Brief: ohne Tabelle und ohne Titel', () => {
    const dok = entpacke(briefbogenDocx('brief', absender, { kleinunternehmerAktiv: true, zahlungszielTage: 14 })).get('word/document.xml')!.toString();
    expect(dok).toContain('[Betreff]');
    expect(dok).not.toContain('Gesamtsumme');
  });
});
