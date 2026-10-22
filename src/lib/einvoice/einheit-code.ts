// Rechnungswesen Stufe 3, T10a: Die Einheiten aus Einstellungen → Regeln („Stunde“,
// „Session“ …) sind deutsche Wörter. Die E-Rechnung verlangt einen Code nach
// UN/ECE Recommendation 20 (BT-130); ein freies Wort macht die Rechnung ungültig.
// Was kein bekannter Zeitbegriff ist, wird „C62“ (Stück/Einheit).

const CODES: [RegExp, string][] = [
  [/^(stunden?|std\.?|h)$/i, 'HUR'],
  [/^(tage?|tg\.?)$/i, 'DAY'],
  [/^(minuten?|min\.?)$/i, 'MIN'],
  [/^(wochen?)$/i, 'WEE'],
  [/^(monate?|monat)$/i, 'MON'],
];

export function einheitCode(einheit: string | null | undefined): string {
  const e = (einheit ?? '').trim();
  // Schon ein Code (z. B. HUR, C62 aus älteren Rechnungen) bleibt, wie er ist.
  if (/^[A-Z0-9]{2,3}$/.test(e)) return e;
  for (const [muster, code] of CODES) if (muster.test(e)) return code;
  return 'C62';
}
