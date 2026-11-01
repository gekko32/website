// K164 (Handtest 01.11.2026): Mahnungen werden nur noch über die Prüfseite verschickt –
// /api/admin/billing/dunning/[id]/mail (E-Mail) bzw. …/post (Postversand vermerken).
import type { APIRoute } from 'astro';

export const POST: APIRoute = async () =>
  new Response(JSON.stringify({ error: 'Bitte die Mahnung unter Admin → Mahnungen prüfen und von dort verschicken.' }), {
    status: 410, headers: { 'Content-Type': 'application/json' },
  });
