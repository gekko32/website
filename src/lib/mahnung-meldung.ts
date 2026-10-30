// K160 (Handtest 30.10.2026, H35): Legt der Mahnlauf neue Mahnungen an, erfährt Gerald es per Mail.
// Bewusst NICHT über sendAdminNotification: dort hält der globale Schalter EMAIL_NOTIFICATIONS_ENABLED
// (auf mentolder „false“) alle Hinweise zurück. Eigener Schalter notify_mahnung, Vorgabe an.
import { getSiteSetting } from './website-db';
import { sendEmail } from './email';
import { logger } from './logger';
import type { PendingDunning } from './invoice-dunning';

const euro = (n: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);

export function mahnungsMailText(neu: number, offen: PendingDunning[], link: string): string {
  const zeilen = offen.map((d) => `- ${d.customerName}: Rechnung ${d.invoiceNumber}, Mahnstufe ${d.level}, offen ${euro(d.outstanding)}`);
  return [
    `Der Mahnlauf hat ${neu === 1 ? 'eine neue Mahnung' : `${neu} neue Mahnungen`} angelegt. Verschickt ist noch nichts.`,
    '', `Zu versenden (${offen.length}):`, ...zeilen, '',
    `Prüfen und versenden: ${link}`,
    '', 'Diese Mail lässt sich unter Admin → Einstellungen → Benachrichtigungen („Neue Mahnungen“) abschalten.',
  ].join('\n');
}

export async function meldeNeueMahnungen(brand: string, neu: number, offen: PendingDunning[]): Promise<void> {
  if (neu <= 0) return;
  const [schalter, an] = await Promise.all([getSiteSetting(brand, 'notify_mahnung'), getSiteSetting(brand, 'notification_email')]);
  if (schalter === 'false') return;
  const ziel = an || process.env.CONTACT_EMAIL;
  if (!ziel) return;
  const link = `${(process.env.SITE_URL ?? '').replace(/\/$/, '')}/admin/rechnungen?status=mahnwesen`;
  const ok = await sendEmail({
    to: ziel,
    subject: neu === 1 ? 'Neue Mahnung zu versenden' : `${neu} neue Mahnungen zu versenden`,
    text: mahnungsMailText(neu, offen, link),
  });
  if (!ok) logger.warn({ neu }, '[mahnung-meldung] Mail an Gerald nicht gesendet');
}
