// Mail an den Kunden, wenn eine Buchung im Postfach angenommen wird (08.11.2026).
// Enthält den Link zum Umbuchen und Absagen und auf Wunsch die AGB als Anhang.

export interface BestaetigungDaten {
  name: string;
  typeLabel: string;
  datum: string;
  uhrzeit: string;
  ort?: string | null;
  marke: string;
  meetingUrl?: string | null;
  verwaltenUrl?: string | null;
  agbAngehaengt?: boolean;
  /** Freiwilliger persönlicher Text aus dem Postfach. */
  nachricht?: string | null;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function bestaetigungsMail(d: BestaetigungDaten): { subject: string; text: string; html: string } {
  const zeilen = [
    `Hallo ${d.name},`, '', 'Ihr Termin wurde bestätigt!', '',
    ...(d.nachricht ? [d.nachricht, ''] : []),
    `  Typ:     ${d.typeLabel}`, `  Datum:   ${d.datum}`, `  Uhrzeit: ${d.uhrzeit}`,
  ];
  if (d.ort) zeilen.push(`  Ort:     ${d.ort}`);
  if (d.meetingUrl) zeilen.push('', 'Ihr Meeting-Link:', d.meetingUrl);
  if (d.verwaltenUrl) zeilen.push('', 'Termin umbuchen oder absagen:', d.verwaltenUrl);
  if (d.agbAngehaengt) zeilen.push('', 'Unsere AGB finden Sie im Anhang.');
  zeilen.push('', 'Mit freundlichen Grüßen', d.marke);

  const zelle = 'padding:4px 12px 4px 0;color:#aabbcc';
  const zeile = (k: string, v: string) => `<tr><td style="${zelle}">${k}</td><td>${esc(v)}</td></tr>`;
  const knopf = d.meetingUrl
    ? `<p><a href="${esc(d.meetingUrl)}" style="display:inline-block;background:#e8c870;color:#0f1623;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Zum Meeting</a></p>`
    : '';
  const verwalten = d.verwaltenUrl ? `<p><a href="${esc(d.verwaltenUrl)}">Termin umbuchen oder absagen</a></p>` : '';
  const agb = d.agbAngehaengt ? '<p>Unsere AGB finden Sie im Anhang.</p>' : '';

  return {
    subject: `Termin bestätigt: ${d.typeLabel} am ${d.datum}`,
    text: zeilen.join('\n'),
    html: `<p>Hallo ${esc(d.name)},</p><p><strong>Ihr Termin wurde bestätigt!</strong></p>`
      + (d.nachricht ? `<p>${esc(d.nachricht).replace(/\n/g, '<br>')}</p>` : '')
      + `<table style="border-collapse:collapse;margin:16px 0">${zeile('Typ', d.typeLabel)}${zeile('Datum', d.datum)}${zeile('Uhrzeit', d.uhrzeit)}${d.ort ? zeile('Ort', d.ort) : ''}</table>`
      + `${knopf}${verwalten}${agb}<p>Mit freundlichen Grüßen<br>${esc(d.marke)}</p>`,
  };
}
