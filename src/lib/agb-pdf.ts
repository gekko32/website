// Die AGB als HTML (Seite /agb) und als PDF (Anhang der Terminbestätigung, 08.11.2026).
// Quelle ist immer der aktuelle Text aus dem Content Hub mit den Werten aus den Einstellungen.
import { getLegalPage } from './website-db';
import type { Stammdaten } from './website-db';
import { getDefaultAgb } from './legal-defaults';
import { resolveTokens, resolveRegelTokens } from './legal-tokens';
import { getEffectiveStammdaten } from './content';
import { ladeRegelTokenWerte } from './billing-regeln';

export async function ladeAgbHtml(brand: string, brandId: string): Promise<string> {
  const sd = await getEffectiveStammdaten().catch(() => ({} as Stammdaten));
  const stored = await getLegalPage(brand, 'agb').catch(() => null);
  const regelWerte = await ladeRegelTokenWerte(brand);
  return resolveRegelTokens(resolveTokens(stored?.trim() ? stored : getDefaultAgb(brandId), sd), regelWerte);
}

export function agbDruckfassung(inhalt: string): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>AGB</title><style>
    body { font: 10.5pt/1.5 Helvetica, Arial, sans-serif; color: #1a1a1a; }
    h1 { font-size: 18pt; margin: 0 0 12pt; } h2 { font-size: 12.5pt; margin: 14pt 0 5pt; }
    p, li { margin: 0 0 6pt; } a { color: inherit; }
  </style></head><body>${inhalt}</body></html>`;
}

export async function erzeugeAgbPdf(brand: string, brandId: string): Promise<Buffer> {
  // Erst hier laden: Der PDF-Dienst startet einen Browser.
  const { generatePdf } = await import('./signing/pdf-service');
  return generatePdf(agbDruckfassung(await ladeAgbHtml(brand, brandId)));
}
