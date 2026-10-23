// E-Mail-Versand im Adminbereich (Spezifikation K76): Fehler des Mail-Servers auf Deutsch,
// mit Hinweis, was zu tun ist. Die Meldung des Servers bleibt als `detail` sichtbar.

export interface MailFehler { grund: string; detail: string }

interface SmtpFehler { code?: string; responseCode?: number; command?: string; message?: string; response?: string }

export function uebersetzeMailFehler(err: unknown): MailFehler {
  const e = (err ?? {}) as SmtpFehler;
  const detail = String(e.response || e.message || err || '').slice(0, 300);
  const text = `${e.message ?? ''} ${e.response ?? ''}`.toLowerCase();
  const rc = e.responseCode ?? 0;

  if (e.code === 'EAUTH' || rc === 535 || rc === 534 || rc === 530) {
    return { grund: 'Benutzername oder Passwort abgelehnt. Bei vielen Anbietern braucht es ein App-Passwort für Mailprogramme (bei mailbox.org: Art „IMAP und SMTP“).', detail };
  }
  if (/wrong version number|ssl3_get_record|unknown protocol|tls|certificate/.test(text) && e.code !== 'EENVELOPE') {
    return { grund: 'Die Verschlüsselung passt nicht zum Port. Bei Port 465 „SSL/TLS“, bei Port 587 „STARTTLS“ wählen.', detail };
  }
  if (['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNECTION', 'ECONNRESET'].includes(e.code ?? '')
    || /getaddrinfo|econnrefused|enotfound|etimedout|ehostunreach|enetunreach|timeout|timed out|greeting never received/.test(text)) {
    return { grund: 'Der Mail-Server ist nicht erreichbar. Server und Port prüfen.', detail };
  }
  if ((rc === 550 || rc === 553 || rc === 554 || rc === 501) && (e.command === 'MAIL FROM' || /sender|from|absender/.test(text))) {
    return { grund: 'Der Anbieter erlaubt diese Absenderadresse nicht. Als Absender den Benutzernamen des Postfachs eintragen oder die Adresse beim Anbieter als Alias einrichten.', detail };
  }
  if (e.code === 'EENVELOPE' || rc === 550 || rc === 553) {
    return { grund: 'Der Mail-Server hat die Empfängeradresse abgelehnt. Adresse prüfen.', detail };
  }
  return { grund: 'Die E-Mail konnte nicht verschickt werden.', detail };
}
