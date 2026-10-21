// Schutz der Live-Daten (Vorfall 21.10.2026): Die Test-Schnittstellen aus Patricks
// Systemtest-Werkzeug löschen bzw. erzeugen Daten in der Live-Datenbank. „purge-all-test-data“
// löscht jeden Klienten ohne Termine/Tickets/Rechnungen, der nicht auf einer festen Liste
// steht – auch echte, von Hand angelegte Klienten. Deshalb sind diese Schnittstellen hier
// gesperrt, außer die Umgebung erlaubt sie ausdrücklich (SYSTEMTEST_FREIGABE=ja, nur auf
// Testservern setzen).
const GESPERRT = ['/sdlc/api/systemtest/', '/sdlc/api/testdata/'];

export function testschnittstelleGesperrt(pfad: string, env: Record<string, string | undefined> = process.env): boolean {
  if (env.SYSTEMTEST_FREIGABE === 'ja') return false;
  // Pfad vereinheitlichen, damit Schreibweisen wie //, /./, ../ oder Großbuchstaben nicht vorbeikommen.
  const teile: string[] = [];
  for (const t of pfad.toLowerCase().split('/')) {
    if (t === '' || t === '.') continue;
    if (t === '..') { teile.pop(); continue; }
    teile.push(t);
  }
  const norm = `/${teile.join('/')}/`;
  return GESPERRT.some((p) => norm.startsWith(p));
}
