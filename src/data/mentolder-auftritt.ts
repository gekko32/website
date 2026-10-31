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
    zitat: '„Meine Technik und meine Website sollen einfach funktionieren.“',
    beleg: 'Ein fester Ansprechpartner, der zuhört und erklärt, ohne Fachchinesisch.',
    href: '/selbststaendige-vereine',
  },
  {
    titel: 'Kleine Unternehmen',
    zitat: '„Bei uns weiß keiner mehr, was wo liegt und wer was macht.“',
    beleg: 'Ich bringe Abläufe und Daten in eine Ordnung, bevor neue Software gekauft wird. Datenschutz inklusive.',
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

export const werIchBin = [
  '40 Jahre war ich bei der Polizei Hamburg, über 30 davon in Führung, zuletzt als Leiter der Videotechnik in der IT. Ich habe den Digitalfunk mit aufgebaut und im G20-Einsatz Gesichtserkennung eingeführt.',
  'Seit 2023 bin ich mit mentolder selbstständig und als systemischer Coach ausgebildet. KI nutze ich so, wie ich es bei der Polizei gelernt habe: Sie liefert schnell ein Ergebnis, aber ich prüfe es, bevor sich jemand darauf verlässt.',
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
