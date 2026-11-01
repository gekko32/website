// Inhalte des neuen mentolder-Auftritts (Startseite und Geschichten), Stand 31.10.2026.
// Bewusst außerhalb von content/*.json: die Zod-Schemas dort kennen diese Felder nicht.

export interface HilfeKarte {
  titel: string;
  zitat: string;
  beleg: string;
  href: string;
}

export const hilfeKarten: HilfeKarte[] = [
  {
    titel: 'Selbstständige & Vereine',
    zitat: '„Ich tippe dieselben Daten dreimal ab: in die Anmeldung, die Liste und die Rechnung.“',
    beleg: 'Ich verbinde Anmeldung, Termine, Mitglieder und Rechnungen, sodass jede Angabe nur einmal erfasst wird.',
    href: '/selbststaendige-vereine',
  },
  {
    titel: 'Kleine Unternehmen',
    zitat: '„Bei uns weiß keiner mehr, was wo liegt und wer was macht.“',
    beleg: 'Ich mache die Abläufe sichtbar, ordne sie und entwickle eine Lösung, die Ihre Programme verbindet.',
    href: '/kleine-unternehmen',
  },
  {
    titel: 'Verwaltung',
    zitat: '„Wir sollen KI einführen. Wie, ohne dass es schiefgeht?“',
    beleg: '40 Jahre Polizei Hamburg, Gesichtserkennung im G20-Einsatz, Digitalfunk.',
    href: '/verwaltung',
  },
  {
    titel: 'Coaching',
    zitat: '„Ich trage Verantwortung und will klarer sehen.“',
    beleg: 'Systemischer Coach, über 30 Jahre selbst Führungskraft.',
    href: '/fuehrung-persoenlichkeit',
  },
];

export interface Beispiel {
  bereich: string;
  titel: string;
  vorher: string;
  loesung: string;
  stand: string;
}

// Bewusst ohne Namen von Kunden (Gerald, 01.11.2026).
export const beispiele: Beispiel[] = [
  {
    bereich: 'Stadtführungen',
    titel: 'Touren, Einsätze und Anfragen in einem System',
    vorher: 'Termine, Einsatzplanung und Anfragen liefen über E-Mail, Telefon und Listen.',
    loesung: 'Ein Kalender aller Touren, die Einsatzplanung der Guides und Anfragen für Leihfahrräder an einer Stelle.',
    stand: 'In Entwicklung',
  },
  {
    bereich: 'Eigene Plattform',
    titel: 'Vom Termin bis zur Mahnung',
    vorher: 'Termine, Kundendaten und Rechnungen wären sonst in getrennten Programmen gelandet.',
    loesung: 'Terminbuchung, Kundenportal, Rechnungen und Mahnwesen greifen ineinander. Jede Angabe wird einmal erfasst, Belege entstehen automatisch.',
    stand: 'Im Einsatz bei mentolder',
  },
  {
    bereich: 'Verein',
    titel: 'Von der Liste zur Vereinsverwaltung',
    vorher: 'Mitglieder, Beiträge und Termine wurden in verschiedenen Listen gepflegt.',
    loesung: 'Anforderungsanalyse, Aufbereitung und Übernahme der Daten, Einführung einer Vereinssoftware und ein Ausblick, was sich darüber hinaus noch nutzen lässt.',
    stand: 'Beratung und Einführung',
  },
  {
    bereich: 'Coaching',
    titel: 'Ein digitales Aufstellungsbrett',
    vorher: 'Systemische Aufstellungen brauchten ein Brett und Figuren im selben Raum.',
    loesung: 'Ein eigenes Werkzeug, mit dem Klienten online gemeinsam aufstellen können, selbst entwickelt und betrieben.',
    stand: 'Im Einsatz',
  },
];

export const werIchBin = [
  '40 Jahre war ich bei der Polizei Hamburg, über 30 davon in Führung, zuletzt als Leiter der Videotechnik in der IT. Ich habe den Digitalfunk mit aufgebaut und im G20-Einsatz Gesichtserkennung eingeführt.',
  'Seit 2023 bin ich mit mentolder selbstständig. Heute analysiere ich Arbeitsabläufe und entwickle daraus individuelle digitale Lösungen. Ich bin außerdem ausgebildeter systemischer Coach. KI nutze ich so, wie ich es bei der Polizei gelernt habe: Sie liefert schnell ein Ergebnis, aber ich prüfe es, bevor sich jemand darauf verlässt.',
];

export interface Geschichte {
  slug: string;
  title: string;
  zeit: string;
  teaser: string;
  order: number;
  Content: any;
}

const dateien = import.meta.glob<{ frontmatter: Omit<Geschichte, 'slug' | 'Content'>; Content: any }>(
  './geschichten/*.md',
  { eager: true },
);

export const geschichten: Geschichte[] = Object.entries(dateien)
  .map(([pfad, mod]) => ({
    slug: pfad.replace(/^.*\/(.+)\.md$/, '$1'),
    ...mod.frontmatter,
    Content: mod.Content,
  }))
  .sort((a, b) => a.order - b.order);
