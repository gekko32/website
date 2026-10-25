// Beleg-Design (K115): Blanko-Briefbogen als Word-Datei herunterladen – Rechnung, Angebot oder allgemeiner Brief.
// Nur Admins; Werte aus Einstellungen → Rechnungen und Rechnungstexte.
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../lib/auth';
import { ladeAbsender } from '../../../../lib/billing-absender';
import { ladeRechnungstexte } from '../../../../lib/billing-rechnungstexte';
import { ladeZahlungsziel } from '../../../../lib/billing-regeln';
import { resolveEffectiveTaxMode } from '../../../../lib/tax-monitor';
import { briefbogenDocx, type VorlagenArt } from '../../../../lib/beleg-vorlage-docx';

const NAMEN: Record<VorlagenArt, string> = { rechnung: 'Rechnung', angebot: 'Angebot', brief: 'Brief' };

export const GET: APIRoute = async ({ request, url }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return new Response('Nicht angemeldet', { status: 401 });
  if (!isAdmin(session)) return new Response('Forbidden', { status: 403 });
  const brand = process.env.BRAND || 'mentolder';
  const art: VorlagenArt = url.searchParams.get('art') === 'angebot' ? 'angebot' : url.searchParams.get('art') === 'brief' ? 'brief' : 'rechnung';
  const [absender, texte, ziel, steuer] = await Promise.all([
    ladeAbsender(brand), ladeRechnungstexte(brand), ladeZahlungsziel(brand), resolveEffectiveTaxMode(brand),
  ]);
  const docx = briefbogenDocx(art, absender, {
    einleitung: art === 'rechnung' ? texte.invoice_intro_text : art === 'angebot' ? texte.angebot_intro_text : undefined,
    schluss: art === 'rechnung' ? texte.invoice_outro_text : art === 'angebot' ? texte.angebot_outro_text : undefined,
    kleinunternehmer: texte.invoice_kleinunternehmer_notice, kleinunternehmerAktiv: steuer === 'kleinunternehmer', zahlungszielTage: ziel,
  });
  return new Response(new Uint8Array(docx), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="mentolder-Briefbogen-${NAMEN[art]}.docx"`,
      'Cache-Control': 'no-store',
    },
  });
};
