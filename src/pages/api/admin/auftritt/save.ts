import type { APIRoute } from 'astro';
import { handleAdminSave } from '../../../../lib/content-publish-handler';

// SPEZ-NEUER-AUFTRITT K199–K201: speichert content/<brand>/auftritt.json über die Publish-Pipeline
// (Zod 422, baseSha-Abgleich 409, Bot-PR mit Auto-Merge).
const BRAND = process.env.BRAND || 'mentolder';

export const POST: APIRoute = async (ctx) =>
  handleAdminSave(ctx, { brand: BRAND, domain: 'auftritt' });
