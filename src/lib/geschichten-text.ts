// Wandelt den Volltext einer Geschichte (aus dem Admin-Formular) in sicheres HTML um (SPEZ K201).
// Erlaubt sind nur: Absätze per Leerzeile, **fett** und [Text](/pfad) bzw. [Text](https://…).
// Alles andere, auch HTML im Text, wird als reiner Text ausgegeben.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(absatz: string): string {
  let html = escapeHtml(absatz.replace(/\s*\n\s*/g, ' ').trim());
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\[([^\]]+)\]\(((?:\/(?![\/\\])|https:\/\/)[^)\s]*)\)/g, (_m, text: string, ziel: string) => {
    const extern = ziel.startsWith('https://');
    return `<a href="${ziel}"${extern ? ' rel="noopener" target="_blank"' : ''}>${text}</a>`;
  });
  return html;
}

export function geschichteZuHtml(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((absatz) => absatz.trim())
    .filter(Boolean)
    .map((absatz) => `<p>${inline(absatz)}</p>`)
    .join('\n');
}
