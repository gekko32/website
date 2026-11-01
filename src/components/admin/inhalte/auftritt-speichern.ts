// Gemeinsames Speichern für die Auftritt-Formulare (SPEZ-NEUER-AUFTRITT K204–K207).

export interface SpeicherErgebnis {
  ok: boolean;
  meldung: string;
  fehler: string[];
  prUrl?: string;
  /** Neuer Stand in main (Blob-SHA) für die nächste Speicherung. */
  blobSha?: string | null;
}

export const LIVE_HINWEIS =
  'Gespeichert. Die Änderung ist in etwa 30 bis 40 Minuten auf der Website. Du musst nichts weiter tun.';

/** Macht Zod-Pfade wie „beispiele.1.titel: Titel fehlt“ lesbar: „Beispiel 2: Titel fehlt“. */
export function lesbarerFehler(zeile: string, namen: Record<string, string>): string {
  const [pfad, ...rest] = zeile.split(': ');
  const text = rest.join(': ') || pfad;
  const teile = pfad.split('.');
  // Liste auf oberster Ebene (z. B. Geschichten): „0.title“ → „Geschichte 1“.
  if (/^\d+$/.test(teile[0] ?? '')) return `${namen['#'] ?? 'Eintrag'} ${Number(teile[0]) + 1}: ${text}`;
  const bereich = namen[teile[0]] ?? teile[0];
  const nr = /^\d+$/.test(teile[1] ?? '') ? ` ${Number(teile[1]) + 1}` : '';
  return `${bereich}${nr}: ${text}`;
}

export async function speichern(
  url: string,
  payload: unknown,
  baseSha: string | null,
  namen: Record<string, string>,
): Promise<SpeicherErgebnis> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload, baseSha }),
    });
  } catch {
    return { ok: false, meldung: 'Keine Verbindung zum Server. Nichts gespeichert.', fehler: [] };
  }
  const json = await res.json().catch(() => ({})) as { errors?: string[]; prUrl?: string; error?: string; blobSha?: string | null };
  if (res.ok) return { ok: true, meldung: LIVE_HINWEIS, fehler: [], prUrl: json.prUrl, blobSha: json.blobSha ?? null };
  if (res.status === 422) {
    return {
      ok: false,
      meldung: 'Nicht gespeichert. Bitte diese Felder ergänzen:',
      fehler: (json.errors ?? []).map((z) => lesbarerFehler(z, namen)),
    };
  }
  if (res.status === 409) {
    return {
      ok: false,
      meldung:
        'Nicht gespeichert: Diese Inhalte wurden inzwischen an anderer Stelle geändert. Bitte die Seite neu laden '
        + 'und die Änderung noch einmal eintragen. Hast du gerade eben schon gespeichert, wird diese Änderung noch '
        + 'übernommen. Dann in ein paar Minuten neu laden.',
      fehler: [],
    };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, meldung: 'Nicht angemeldet. Bitte neu anmelden.', fehler: [] };
  }
  return { ok: false, meldung: json.error ?? `Fehler beim Speichern (${res.status}). Nichts gespeichert.`, fehler: [] };
}
