import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../../../lib/auth';
import { sendDunning } from '../../../../../../lib/invoice-dunning';

export const POST: APIRoute = async ({ request, params }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session || !isAdmin(session)) return new Response('Forbidden', { status: 403 });
  const id = params.id ?? '';
  if (!id) return new Response('Invalid id', { status: 400 });
  const r = await sendDunning(id, session.email ?? session.sub ?? 'admin');
  if (!r) return new Response(JSON.stringify({ error: 'send failed or already sent' }), {
    status: 409,
    headers: { 'Content-Type': 'application/json' },
  });
  return new Response(JSON.stringify({ ok: true, versand: r.weg, pdfPath: r.pdfPath }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
