// Markengebundene Regeln des mentolder-Auftritts (SPEZ-NEUER-AUFTRITT K187, K193, K197).
// Andere Marken bekommen hier nie etwas zurück und behalten ihr bisheriges Verhalten (K189).

/** Alte mentolder-Adressen → neues Ziel (301). */
const ALTE_SEITEN: Record<string, string> = {
  '/leistungen': '/#hilfe',
  '/coaching': '/fuehrung-persoenlichkeit',
  '/beratung': '/kleine-unternehmen',
  '/50plus-digital': '/',
};

export function weiterleitungFuer(brand: string, pfad: string): string | null {
  if (brand !== 'mentolder') return null;
  return ALTE_SEITEN[pfad] ?? null;
}

export interface Anliegen { value: string; label: string }

/** Auswahl im Kontaktformular; undefined = Standardliste der Komponente. */
export function kontaktAnliegen(brand: string): Anliegen[] | undefined {
  if (brand !== 'mentolder') return undefined;
  return [
    { value: 'allgemein', label: 'Allgemeine Frage' },
    { value: 'erstgespraech', label: 'Erstgespräch (kostenlos, 45 Minuten)' },
    { value: 'selbststaendige-vereine', label: 'Selbstständige & Vereine' },
    { value: 'kleine-unternehmen', label: 'Kleine Unternehmen' },
    { value: 'verwaltung', label: 'Verwaltung' },
    { value: 'coaching', label: 'Coaching' },
    { value: 'feedback', label: 'Feedback' },
  ];
}

/** Dauer des kostenlosen Erstgesprächs in Minuten. */
export function erstgespraechMinuten(brand: string): number {
  return brand === 'mentolder' ? 45 : 30;
}
