export interface ContentEntry {
  type: 'questionnaire' | 'vorlage' | 'vertrag';
  id: string;
  title: string;
  status?: string;
  meta?: string;
  createdAt?: string;
  detailHref: string;
}

import type { QTemplate } from './questionnaire-db/types';
import type { Template } from './coaching-db';
import type { DocumentTemplate } from './documents-db';

// Die Datenbank liefert echte Datumswerte; sortiert wird unten als Text (sonst Absturz, 08.11.2026).
function alsText(d: unknown): string | undefined {
  if (d === null || d === undefined) return undefined;
  return d instanceof Date ? d.toISOString() : String(d);
}

export function mergeContentEntries(
  questionnaires: QTemplate[],
  vorlagen: Template[],
  contracts: DocumentTemplate[],
): ContentEntry[] {
  const result: ContentEntry[] = [];

  for (const q of questionnaires) {
    result.push({
      type: 'questionnaire',
      id: q.id,
      title: q.title,
      meta: `${q.dimension_count} Dimensionen`,
      createdAt: alsText(q.created_at),
      detailHref: '/admin/coaching/sessions',
    });
  }

  for (const v of vorlagen) {
    result.push({
      type: 'vorlage',
      id: v.id,
      title: v.surfaceRef ?? v.snippetId,
      status: v.status,
      meta: `v${v.version}/${v.targetSurface}`,
      createdAt: v.createdAt instanceof Date ? v.createdAt.toISOString() : String(v.createdAt),
      detailHref: '/admin/knowledge/templates',
    });
  }

  for (const c of contracts) {
    result.push({
      type: 'vertrag',
      id: c.id,
      title: c.title,
      createdAt: alsText(c.created_at),
      detailHref: '/admin/dokumente',
    });
  }

  result.sort((a, b) => {
    if (!a.createdAt || !b.createdAt) return 0;
    return b.createdAt.localeCompare(a.createdAt);
  });

  return result;
}