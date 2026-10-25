// Beleg-Design (K115): kleines ZIP-Archiv schreiben (Word-Dateien .docx sind ZIP-Archive). Ohne Fremdpaket.
import { deflateRawSync } from 'zlib';

const CRC_TABELLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABELLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Dateien zu einem ZIP-Archiv packen (Deflate, UTF-8-Namen). */
export function zip(dateien: { name: string; inhalt: Buffer | string }[]): Buffer {
  const teile: Buffer[] = [];
  const verzeichnis: Buffer[] = [];
  let versatz = 0;
  for (const d of dateien) {
    const roh = typeof d.inhalt === 'string' ? Buffer.from(d.inhalt, 'utf8') : d.inhalt;
    const gepackt = deflateRawSync(roh);
    const name = Buffer.from(d.name, 'utf8');
    const crc = crc32(roh);
    const kopf = Buffer.alloc(30);
    kopf.writeUInt32LE(0x04034b50, 0); kopf.writeUInt16LE(20, 4); kopf.writeUInt16LE(0x0800, 6); kopf.writeUInt16LE(8, 8);
    kopf.writeUInt16LE(0, 10); kopf.writeUInt16LE(0x21, 12); kopf.writeUInt32LE(crc, 14);
    kopf.writeUInt32LE(gepackt.length, 18); kopf.writeUInt32LE(roh.length, 22); kopf.writeUInt16LE(name.length, 26); kopf.writeUInt16LE(0, 28);
    teile.push(kopf, name, gepackt);
    const zentral = Buffer.alloc(46);
    zentral.writeUInt32LE(0x02014b50, 0); zentral.writeUInt16LE(20, 4); zentral.writeUInt16LE(20, 6); zentral.writeUInt16LE(0x0800, 8);
    zentral.writeUInt16LE(8, 10); zentral.writeUInt16LE(0, 12); zentral.writeUInt16LE(0x21, 14); zentral.writeUInt32LE(crc, 16);
    zentral.writeUInt32LE(gepackt.length, 20); zentral.writeUInt32LE(roh.length, 24); zentral.writeUInt16LE(name.length, 28);
    zentral.writeUInt16LE(0, 30); zentral.writeUInt16LE(0, 32); zentral.writeUInt16LE(0, 34); zentral.writeUInt16LE(0, 36);
    zentral.writeUInt32LE(0, 38); zentral.writeUInt32LE(versatz, 42);
    verzeichnis.push(zentral, name);
    versatz += kopf.length + name.length + gepackt.length;
  }
  const vz = Buffer.concat(verzeichnis);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0); ende.writeUInt16LE(0, 4); ende.writeUInt16LE(0, 6);
  ende.writeUInt16LE(dateien.length, 8); ende.writeUInt16LE(dateien.length, 10);
  ende.writeUInt32LE(vz.length, 12); ende.writeUInt32LE(versatz, 16); ende.writeUInt16LE(0, 20);
  return Buffer.concat([...teile, vz, ende]);
}
