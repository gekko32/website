// Rechnungswesen Stufe 4, T17 (K53): Hinweis auf der Rechnung, aus welchen Angeboten die Posten
// stammen. Eigene Datei, damit billing-entwurf und billing-angebot sich nicht gegenseitig importieren.

export function gemaessAngebotText(nummern: string[]): string | null {
  const n = [...new Set(nummern)].sort();
  if (n.length === 0) return null;
  return n.length === 1 ? `gemäß Angebot ${n[0]}` : `gemäß Angeboten ${n.join(', ')}`;
}
