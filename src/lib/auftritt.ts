// Inhalte des mentolder-Auftritts (Startseite, Beispiele, Geschichten) aus dem Content-Bundle.
// Gepflegt über Admin → Inhalte (SPEZ-NEUER-AUFTRITT K199–K201).
import { bundleAuftritt, bundleGeschichten } from './content-bundle';
import type { AuftrittContent, Geschichte } from '../content-schema';

const BRAND = process.env.BRAND_ID ?? process.env.BRAND ?? 'mentolder';

export function getAuftritt(brand: string = BRAND): AuftrittContent {
  const a = bundleAuftritt(brand);
  return { ...a, beispiele: a.beispiele.filter((b) => b.sichtbar) };
}

/** Nur sichtbare Geschichten, sortiert (K210). */
export function getGeschichten(brand: string = BRAND): Geschichte[] {
  return bundleGeschichten(brand)
    .filter((g) => g.sichtbar)
    .sort((a, b) => a.order - b.order);
}
