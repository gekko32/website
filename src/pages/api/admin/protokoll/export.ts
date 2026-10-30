// K161 (Handtest 30.10.2026, H37): Änderungsprotokoll als CSV – mit denselben Filtern wie die Seite.
// Semikolon und UTF-8 mit BOM, damit Excel Umlaute und Spalten richtig liest.
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../lib/auth';
import { leseProtokoll, BEREICH_TEXT, type ProtokollBereich, type ProtokollZeile } from '../../../../lib/akte-protokoll';

const MAX_ZEILEN = 20_000;

/** Ein CSV-Feld: in Anführungszeichen, innere Anführungszeichen verdoppelt; Formelzeichen entschärft. */
export function csvFeld(wert: unknown): string {
  let s = wert === null || wert === undefined ? '' : typeof wert === 'string' ? wert : JSON.stringify(wert);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function protokollCsv(zeilen: ProtokollZeile[]): string {
  const kopf = ['Zeitpunkt', 'Wer', 'Klient', 'Bereich', 'Aktion', 'Objekt', 'Beschreibung', 'Vorher', 'Nachher'];
  const zeit = (iso: string) => new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  const reihen = zeilen.map((z) => [zeit(z.am), z.wer, z.klientName, BEREICH_TEXT[z.bereich] ?? z.bereich, z.aktion, z.objekt,
    z.beschreibung, z.vorher, z.nachher].map(csvFeld).join(';'));
  return `﻿${[kopf.map(csvFeld).join(';'), ...reihen].join('\r\n')}\r\n`;
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });

  const brand = process.env.BRAND || 'mentolder';
  const q = url.searchParams;
  const bereich = (Object.keys(BEREICH_TEXT) as ProtokollBereich[]).find((b) => b === q.get('bereich'));
  const filter = {
    klientId: q.get('klient') || undefined, bereich, wer: (q.get('wer') ?? '').slice(0, 100) || undefined,
    suche: (q.get('suche') ?? '').slice(0, 100), von: q.get('von') || undefined, bis: q.get('bis') || undefined,
  };
  const alle: ProtokollZeile[] = [];
  for (let offset = 0; alle.length < MAX_ZEILEN; offset += 500) {
    const { zeilen, mehr } = await leseProtokoll(brand, { ...filter, limit: 500, offset });
    alle.push(...zeilen);
    if (!mehr) break;
  }
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }).replace(/-/g, '');
  // Prüfung F6: nicht stillschweigend kürzen.
  let csv = protokollCsv(alle);
  if (alle.length >= MAX_ZEILEN) csv += `${csvFeld(`Hinweis: auf ${MAX_ZEILEN} Einträge gekürzt – bitte mit Filtern (Zeitraum) einschränken.`)}\r\n`;
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${heute}_Aenderungsprotokoll_mentolder.csv"`,
      'Cache-Control': 'no-store',
    },
  });
};
