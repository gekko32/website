// Leistungszeitraum als Text für Akte, Rechnung und PDF. Eigene Datei ohne Datenbank,
// damit auch invoice-pdf.ts sie nutzen kann (Rechnungswesen Stufe 3).

/**
 * Leistungszeitraum für Anzeige und Rechnung (Handtest 21.10.2026): ohne Ende ein Tag,
 * sonst kompakt „20.–22.10.2026“, „28.10.–02.11.2026“ oder „30.12.2026–02.01.2027“.
 */
export function leistungszeitraum(von: string, bis?: string | null): string {
  const [vj, vm, vt] = von.split('-');
  if (!bis || bis === von) return `${vt}.${vm}.${vj}`;
  const [bj, bm, bt] = bis.split('-');
  if (vj !== bj) return `${vt}.${vm}.${vj}–${bt}.${bm}.${bj}`;
  if (vm !== bm) return `${vt}.${vm}.–${bt}.${bm}.${bj}`;
  return `${vt}.–${bt}.${bm}.${bj}`;
}

/** T10a: „Leistung: 05.–07.11.2026“ je Rechnungsposition; null ohne Datum (Rechnung von Hand). */
export function leistungsdatumZeile(z: { leistungVon?: string | null; leistungBis?: string | null }): string | null {
  return z.leistungVon ? `Leistung: ${leistungszeitraum(z.leistungVon, z.leistungBis)}` : null;
}
