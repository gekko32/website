// components/website/src/pages/api/admin/inbox/[id]/action.ts
import type { APIRoute } from 'astro';
import { getSession, isAdmin } from '../../../../../lib/auth';
import { getInboxItem, updateInboxItemStatus, deleteInboxItem } from '../../../../../lib/messaging-db';
import { createUser, sendPasswordResetEmail } from '../../../../../lib/identity';
import { terminAnnehmen } from '../../../../../lib/termin-annehmen';
import { sendChatMessage } from '../../../../../lib/talk';
import { sendRegistrationApproved, sendRegistrationDeclined, sendEmail } from '../../../../../lib/email';
import { upsertCustomer, resolveBugTicket, pool } from '../../../../../lib/website-db';

const BRAND_NAME = process.env.BRAND_NAME || 'Workspace';
const PROD_DOMAIN = process.env.PROD_DOMAIN || '';
const SITE_URL   = process.env.SITE_URL || '';

export const POST: APIRoute = async ({ request, params , locals }) => {
  const session = await getSession(request.headers.get('cookie'));
  if (!session || !isAdmin(session)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const id = parseInt(params.id!, 10);
  if (isNaN(id)) {
    return new Response(JSON.stringify({ error: 'Invalid ID' }), { status: 400 });
  }

  const item = await getInboxItem(id);
  if (!item) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  }

  const body = await request.json() as { action: string; note?: string; agbAnhaengen?: boolean };
  const { action, note, agbAnhaengen } = body;

  // `delete` is the unconditional escape hatch — it bypasses the
  // "Already actioned" lock so admins can clear rows stuck in `actioned`
  // or `archived` (the only paths that previously had no remediation).
  // It deletes the row outright; nothing else changes for it.
  if (action === 'delete') {
    const deleted = await deleteInboxItem(id);
    if (deleted === 0) {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    }
    return new Response(null, { status: 204 });
  }

  if (item.status !== 'pending') {
    return new Response(JSON.stringify({ error: 'Already actioned' }), { status: 409 });
  }

  try {
    switch (action) {

      case 'approve_registration': {
        const p = item.payload as { email: string; firstName: string; lastName: string; phone?: string; company?: string };
        const fullName = `${p.firstName} ${p.lastName}`;

        const result = await createUser({ email: p.email, firstName: p.firstName, lastName: p.lastName, phone: p.phone, company: p.company });

        let userId = result.userId;

        // If user already exists (e.g. partial failure on prior attempt), look up the existing user
        // so we can still send the password reset and complete the approval.
        if (!result.success && result.error?.includes('bereits')) {
          const { listUsers } = await import('../../../../../lib/identity');
          const allUsers = await listUsers();
          const existing = allUsers.find(u => u.email?.toLowerCase() === p.email.toLowerCase());
          if (existing) {
            userId = existing.id;
          } else {
            return new Response(JSON.stringify({ error: `Keycloak-Fehler: ${result.error}` }), { status: 500 });
          }
        } else if (!result.success || !userId) {
          return new Response(JSON.stringify({ error: `Keycloak-Fehler: ${result.error}` }), { status: 500 });
        }

        await sendPasswordResetEmail(userId);
        // Emails are best-effort — upsertCustomer and inbox update must still succeed
        sendRegistrationApproved(p.email, fullName, request).catch(err =>
          locals.requestLogger.error({ err }, '[approve_registration] Failed to send approval email:')
        );
        await upsertCustomer({ name: fullName, email: p.email, phone: p.phone, company: p.company, keycloakUserId: userId });
        await updateInboxItemStatus(id, 'actioned', session.preferred_username);
        return new Response(JSON.stringify({ success: true, message: `${fullName} freigeschaltet` }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      case 'decline_registration': {
        const p = item.payload as { email: string; firstName: string; lastName: string };
        await sendRegistrationDeclined(p.email, `${p.firstName} ${p.lastName}`, undefined, request);
        await updateInboxItemStatus(id, 'actioned', session.preferred_username);
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      case 'approve_booking': {
        const p = item.payload as {
          name: string; email: string; phone?: string; typeLabel: string;
          slotStart: string; slotEnd: string; slotDisplay: string; date: string;
          serviceKey?: string; leistungKey?: string; projectId?: string;
          token?: string; state?: string; ort?: string | null;
        };
        // Rückruf ohne Termin: kein Kalender, kein Raum, keine Terminbestätigung.
        if (!p.slotStart) {
          const vermerk = p.state === 'offen'
            ? { state: 'bestaetigt', outcome: 'bestaetigt', caldavUid: null, decidedAt: new Date().toISOString(), decidedBy: session.preferred_username ?? null }
            : {};
          await pool.query(
            `UPDATE inbox_items SET payload = payload || $1::jsonb WHERE id = $2`,
            [JSON.stringify(vermerk), id],
          ).catch(err => locals.requestLogger.error({ err }, '[approve_booking] Failed to mark callback as done:'));
          await updateInboxItemStatus(id, 'actioned', session.preferred_username);
          return new Response(JSON.stringify({ success: true, details: ['Rückruf als erledigt vermerkt'] }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const ergebnis = await terminAnnehmen({
          id, p, request, log: locals.requestLogger, akteur: session.preferred_username ?? null, agbAnhaengen,
        });
        if (ergebnis.art !== 'ok') {
          return new Response(JSON.stringify({ error: 'Zu dieser Zeit steht schon ein Termin im Kalender. Bitte lehnen Sie die Anfrage ab oder klären Sie den Termin mit dem Kunden.' }), { status: 409 });
        }
        return new Response(JSON.stringify({ success: true, details: ergebnis.details }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      case 'decline_booking': {
        const p = item.payload as { name: string; email: string; typeLabel: string; slotDisplay: string; date: string; state?: string };
        const dateFormatted = new Date(p.date + 'T00:00:00').toLocaleDateString('de-DE', {
          weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
        });
        await sendEmail({
          to: p.email,
          subject: `Zu Ihrer Terminanfrage bei ${BRAND_NAME}`,
          text: `Hallo ${p.name},\n\nleider können wir den angefragten Termin (${p.typeLabel} am ${dateFormatted}, ${p.slotDisplay}) nicht bestätigen.\n\nBitte wählen Sie einen alternativen Termin unter https://web.${PROD_DOMAIN}/termin oder kontaktieren Sie uns direkt.\n\nMit freundlichen Grüßen\n${BRAND_NAME}`,
        }, request);
        // Stufe 3, T6: abgelehnte Buchungen werden nie zu Posten (auch Admin-Buchungen).
        await pool.query(
          `UPDATE inbox_items SET payload = payload || $2::jsonb WHERE id = $1`,
          [id, JSON.stringify({ abgelehnt: true, ...(p.state === 'offen' ? { state: 'abgelehnt', outcome: 'abgelehnt' } : {}) })],
        ).catch(err => locals.requestLogger.error({ err }, '[decline_booking] Failed to mark booking as declined:'));
        await updateInboxItemStatus(id, 'actioned', session.preferred_username);
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      case 'archive_contact': {
        await updateInboxItemStatus(id, 'archived', session.preferred_username);
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      case 'resolve_bug': {
        const resolveNote = note?.trim() ?? '';
        if (!resolveNote) {
          return new Response(JSON.stringify({ error: 'Bitte geben Sie eine Notiz an.' }), { status: 400 });
        }
        if (resolveNote.length > 500) {
          return new Response(JSON.stringify({ error: 'Max. 500 Zeichen.' }), { status: 400 });
        }
        const p = item.payload as { ticketId: string; reporterEmail: string; brand: string };
        await resolveBugTicket(p.ticketId, resolveNote,
          { label: session.preferred_username }, request);
        // No manual sendEmail() here — transitionTicket() handles the close-mail.
        await updateInboxItemStatus(id, 'actioned', session.preferred_username);
        return new Response(JSON.stringify({ success: true }),
          { headers: { 'Content-Type': 'application/json' } });
      }

      case 'close_user_message': {
        await updateInboxItemStatus(id, 'actioned', session.preferred_username);
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      case 'finalize_meeting': {
        const p = item.payload as {
          customerName: string; customerEmail: string; meetingType: string;
          meetingDate: string; roomToken?: string; projectId?: string;
        };
        const res = await fetch(`${SITE_URL}/api/meeting/finalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerName: p.customerName, customerEmail: p.customerEmail,
            meetingType: p.meetingType, meetingDate: p.meetingDate,
            roomToken: p.roomToken ?? undefined,
            projectId: p.projectId ?? undefined,
          }),
        });
        if (!res.ok) {
          return new Response(JSON.stringify({ error: 'Meeting-Finalisierung fehlgeschlagen.' }), { status: 500 });
        }
        const data = await res.json() as { results?: string[] };
        await updateInboxItemStatus(id, 'actioned', session.preferred_username);
        return new Response(JSON.stringify({ success: true, results: data.results ?? [] }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({ error: `Unbekannte Aktion: ${action}` }), { status: 400 });
    }
  } catch (err) {
    locals.requestLogger.error({ err }, '[inbox action ${action}] id=${id}');
    return new Response(JSON.stringify({ error: 'Interner Serverfehler.' }), { status: 500 });
  }
};
