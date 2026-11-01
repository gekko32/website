// Zod schemas for the mentolder Auftritt domains (SPEZ-NEUER-AUFTRITT K199–K201):
// auftritt (Für-wen-Karten, Beispiele, „Wer ich bin“) and geschichten.
// Pure module — no DB / API / website-db imports (S2 acyclic-website gate).
import { z } from 'zod';

export interface FuerWenKarte { titel: string; zitat: string; beleg: string; href: string }
export interface Beispiel {
  bereich: string; titel: string; vorher: string; loesung: string; stand: string; sichtbar: boolean;
}
export interface AuftrittUeberschriften { beispieleKicker: string; beispieleTitel: string; werIchBinKicker: string }
export interface AuftrittContent {
  ueberschriften?: AuftrittUeberschriften;
  fuerWen: FuerWenKarte[];
  beispiele: Beispiel[];
  werIchBin: string[];
}

const pflicht = (feld: string) => z.string().trim().min(1, `${feld} fehlt`);

export const AuftrittSchema = z.object({
  ueberschriften: z.object({
    beispieleKicker: pflicht('Kicker Beispiele'),
    beispieleTitel: pflicht('Überschrift Beispiele'),
    werIchBinKicker: pflicht('Kicker „Wer ich bin“'),
  }).optional(),
  fuerWen: z.array(z.object({
    titel: pflicht('Titel'),
    zitat: pflicht('Satz'),
    beleg: pflicht('Beleg'),
    href: z.string().regex(/^\/[a-z0-9\-/#]*$/, 'Ziel muss mit / beginnen'),
  })),
  beispiele: z.array(z.object({
    bereich: pflicht('Bereich'),
    titel: pflicht('Titel'),
    vorher: pflicht('Vorher'),
    loesung: pflicht('Lösung'),
    stand: pflicht('Stand'),
    sichtbar: z.boolean().default(true),
  })),
  werIchBin: z.array(pflicht('Absatz')),
}) satisfies z.ZodType<AuftrittContent>;

export interface Geschichte {
  slug: string; title: string; zeit: string; teaser: string; order: number; sichtbar: boolean; text: string;
}

export const GeschichtenSchema = z.array(z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Adresse: nur Kleinbuchstaben, Ziffern und Bindestriche'),
  title: pflicht('Titel'),
  zeit: pflicht('Zeitraum'),
  teaser: pflicht('Kurztext'),
  order: z.number().int(),
  sichtbar: z.boolean(),
  text: pflicht('Text'),
})).superRefine((liste, ctx) => {
  const gesehen = new Set<string>();
  liste.forEach((g, i) => {
    if (gesehen.has(g.slug)) {
      ctx.addIssue({ code: 'custom', path: [i, 'slug'], message: `Adresse „${g.slug}“ doppelt` });
    }
    gesehen.add(g.slug);
  });
}) satisfies z.ZodType<Geschichte[]>;
