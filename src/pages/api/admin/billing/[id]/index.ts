import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../../lib/auth';
import { getDraftInvoiceDetail } from '../../../../../lib/stripe-billing';

export const GET: APIRoute = async ({ request, params }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response(null, { status: 403 });
  const detail = await getDraftInvoiceDetail(params.id!);
  if (!detail) return new Response(null, { status: 404 });
  return Response.json(detail);
};
