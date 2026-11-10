// Eine Buchung annehmen: im Postfach durch den Admin oder sofort beim Buchen des
// Erstgesprächs, wenn das unter Buchungsregeln eingeschaltet ist (10.11.2026).
import { createCalendarEvent, getAllBookings } from './caldav';
import { bestaetigungsMail } from './termin-bestaetigung';
import { erzeugeAgbPdf } from './agb-pdf';
import { createTalkRoom, inviteGuestByEmail, sendChatMessage } from './talk';
import { sendEmail } from './email';
import { upsertCustomer, createMeeting, claimBrettLinkPost, pool } from './website-db';
import { updateInboxItemStatus } from './messaging-db';
import { berlinDayKey } from './caldav-cache';

const BRAND_NAME = process.env.BRAND_NAME || 'Workspace';
const SITE_URL = process.env.SITE_URL || '';

export interface BuchungsDaten {
  name: string; email: string; phone?: string | null; typeLabel: string;
  slotStart: string; slotEnd: string; slotDisplay: string; date: string;
  leistungKey?: string | null; projectId?: string | null;
  token?: string; state?: string; ort?: string | null;
}

export type AnnahmeErgebnis =
  | { art: 'ok'; details: string[] }
  | { art: 'belegt' }
  | { art: 'kalenderfehler' };

interface Protokoll { error: (daten: unknown, text: string) => void }

export async function terminAnnehmen(o: {
  id: number;
  p: BuchungsDaten;
  request: Request;
  log: Protokoll;
  akteur: string | null;
  agbAnhaengen?: boolean;
  /** Bei der Sofortbuchung darf nichts bestätigt werden, was nicht im Kalender steht. */
  kalenderPflicht?: boolean;
}): Promise<AnnahmeErgebnis> {
  const { id, p, request, log, akteur } = o;
  const start = new Date(p.slotStart);
  const ende = new Date(p.slotEnd);
  const entscheidung = (uid: string | null) => (p.state === 'offen'
    ? { state: 'bestaetigt', outcome: 'bestaetigt', caldavUid: uid, decidedAt: new Date().toISOString(), decidedBy: akteur }
    : {});

  // Je Kalendertag immer nur eine Annahme gleichzeitig: Zwei Kunden können denselben Termin wählen.
  const sperre = await pool.connect();
  const sperrName = `termin-${berlinDayKey(start)}`;
  await sperre.query('SELECT pg_advisory_lock(hashtext($1))', [sperrName]);
  try {
    const belegt = await getAllBookings().catch(() => null);
    if (belegt === null && o.kalenderPflicht) return { art: 'kalenderfehler' };
    if (belegt?.some((b) => b.status !== 'CANCELLED' && b.start < ende && b.end > start)) return { art: 'belegt' };

    const datum = new Date(p.date + 'T00:00:00').toLocaleDateString('de-DE', {
      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    });
    const details: string[] = [];
    const vorOrt = p.ort === 'vor-ort';

    // Vor Ort braucht keinen Besprechungsraum.
    const room = vorOrt ? null : await createTalkRoom({
      name: `${p.typeLabel}: ${p.name}`,
      description: `${p.typeLabel} mit ${p.name} (${p.email}) am ${datum}, ${p.slotDisplay}`,
    });
    if (room) {
      await inviteGuestByEmail(room.token, p.email);
      details.push(`Talk-Raum erstellt: ${room.url}`);
    } else {
      details.push(vorOrt ? 'Vor Ort: kein Talk-Raum' : 'Talk-Raum konnte nicht erstellt werden');
    }

    const kalender = await createCalendarEvent({
      summary: `${p.typeLabel}: ${p.name}`,
      description: `Termin mit ${p.name} (${p.email})\nTyp: ${p.typeLabel}${p.ort ? `\nOrt: ${vorOrt ? 'Vor Ort' : 'Online'}` : ''}${room ? `\nMeeting: ${room.url}` : ''}`,
      start, end: ende,
      attendeeEmail: p.email, attendeeName: p.name,
    });
    if (!kalender && o.kalenderPflicht) return { art: 'kalenderfehler' };
    details.push(kalender ? 'Kalendereintrag erstellt' : 'Kalendereintrag fehlgeschlagen');

    // AGB als Anhang nur auf Wunsch. Scheitert das PDF, geht die Bestätigung trotzdem raus.
    let anhang: { filename: string; content: Buffer }[] | undefined;
    if (o.agbAnhaengen === true) {
      try {
        anhang = [{ filename: 'AGB.pdf', content: await erzeugeAgbPdf(process.env.BRAND || 'mentolder', process.env.BRAND_ID ?? process.env.BRAND ?? 'mentolder') }];
        details.push('AGB als PDF angehängt');
      } catch (err) {
        log.error({ err }, '[termin-annehmen] AGB-PDF fehlgeschlagen:');
        details.push('AGB konnten nicht angehängt werden');
      }
    }
    const basisUrl = (SITE_URL || new URL(request.url).origin).replace(/\/$/, '');
    await sendEmail({
      to: p.email,
      ...bestaetigungsMail({
        name: p.name, typeLabel: p.typeLabel, datum, uhrzeit: p.slotDisplay, marke: BRAND_NAME,
        ort: p.ort ? (vorOrt ? 'Vor Ort' : 'Online') : null,
        meetingUrl: room?.url ?? null,
        verwaltenUrl: p.token ? `${basisUrl}/anfrage/${p.token}` : null,
        agbAngehaengt: !!anhang,
      }),
      attachments: anhang,
    }, request);
    details.push('Bestätigungs-E-Mail versendet');

    const kunde = await upsertCustomer({ name: p.name, email: p.email, phone: p.phone ?? undefined });
    const meeting = await createMeeting({
      customerId: kunde.id,
      meetingType: p.typeLabel,
      scheduledAt: start,
      talkRoomToken: room?.token ?? undefined,
      projectId: p.projectId ?? undefined,
    }).catch((err) => { log.error({ err }, '[termin-annehmen] Besprechung nicht angelegt:'); return null; });

    try {
      if (meeting && room && await claimBrettLinkPost(meeting.id)) {
        const brettDomain = process.env.BRETT_DOMAIN || 'brett.localhost';
        const url = `https://${brettDomain}/?room=${encodeURIComponent(room.token)}`;
        await sendChatMessage(room.token, `🎯 Systemisches Brett für diese Session: ${url}`);
      }
    } catch (err) {
      log.error({ err }, '[brett] auto-post failed (non-fatal):');
    }

    // Keine Rechnung beim Annehmen: Ist der Termin vorbei und nicht abgesagt, wird er zum offenen Posten.
    await pool.query(
      `UPDATE inbox_items SET payload = payload || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ freigegebenAm: new Date().toISOString(), klientId: kunde.id, ...entscheidung(kalender?.uid ?? null) }), id],
    ).catch((err) => log.error({ err }, '[termin-annehmen] Vermerk fehlgeschlagen:'));
    details.push('Wird nach dem Termin als offener Posten in der Akte abgerechnet');

    await updateInboxItemStatus(id, 'actioned', akteur ?? 'online-buchung');
    return { art: 'ok', details };
  } finally {
    await sperre.query('SELECT pg_advisory_unlock(hashtext($1))', [sperrName]).catch(() => undefined);
    sperre.release();
  }
}
