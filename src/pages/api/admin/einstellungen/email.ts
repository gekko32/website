import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../lib/auth';
import { setSiteSetting } from '../../../../lib/website-db';
import { sendEmailMitGrund } from '../../../../lib/email';
import { speicherePostausgang, loeschePostausgang, vermerkeAbsender } from '../../../../lib/mail-postausgang';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const json = (daten: unknown, status = 200) =>
  new Response(JSON.stringify(daten), { status, headers: { 'Content-Type': 'application/json' } });

// E-Mail-Versand im Adminbereich (SPEZ-EMAIL-VERSAND): Absender, Postausgang, Testmail, zurück zur
// Server-Einstellung. Antworten enthalten nie das Passwort (K80).
export const POST: APIRoute = async ({ request, locals }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session) return json({ error: 'Nicht angemeldet.' }, 401);
  if (!isAdmin(session)) return json({ error: 'Kein Zugriff.' }, 403);
  const brand = process.env.BRAND || 'mentolder';
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const text = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '');

  try {
    switch (body.aktion) {
      case 'absender': {
        const name = text('name');
        const adresse = text('adresse');
        if (!name) return json({ error: 'Absendername darf nicht leer sein.' }, 400);
        if (adresse && !EMAIL_RE.test(adresse)) return json({ error: 'Ungültige Absenderadresse.' }, 400);
        await setSiteSetting(brand, 'email_from_name', name);
        // E3: leer = Benutzername des Postfachs.
        await setSiteSetting(brand, 'email_from_address', adresse);
        await vermerkeAbsender(brand, session.email, name, adresse);
        return json({ ok: true });
      }
      case 'postausgang': {
        const r = await speicherePostausgang(brand, {
          anbieter: text('anbieter'), host: text('host'), port: text('port'), sicherheit: text('sicherheit'),
          benutzer: text('benutzer'), passwort: typeof body.passwort === 'string' ? body.passwort : '',
        }, session.email);
        return r.ok ? json({ ok: true }) : json({ error: r.grund, detail: r.detail }, r.status);
      }
      case 'testmail': {
        const an = text('an');
        if (!EMAIL_RE.test(an)) return json({ error: 'Bitte eine gültige Adresse für die Testmail eintragen.' }, 400);
        const r = await sendEmailMitGrund({
          to: an, subject: 'Testmail aus dem Adminbereich',
          text: 'Diese Testmail kommt aus Einstellungen → E-Mail. Wenn sie angekommen ist, funktioniert der Postausgang.',
        });
        return r.ok ? json({ ok: true }) : json({ error: r.grund, detail: r.detail }, 502);
      }
      case 'zuruecksetzen':
        await loeschePostausgang(brand, session.email);
        return json({ ok: true });
      default:
        return json({ error: 'Unbekannte Aktion.' }, 400);
    }
  } catch (err) {
    locals.requestLogger.error({ err }, '[einstellungen/email]');
    return json({ error: 'Interner Fehler.' }, 500);
  }
};
