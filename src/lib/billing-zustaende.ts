// Nachtrag 24.10.2026 (K90): Was bedeuten die Zustände? Eine Stelle für alle Erklärungen – die Legende
// in Akte, Angebots- und Rechnungsseiten und die Bedienungsanleitung nutzen dieselben Texte.

export interface ZustandErklaerung { name: string; heisst: string; geht: string }

export const POSTEN_ZUSTAENDE: ZustandErklaerung[] = [
  { name: 'offen', heisst: 'Noch nicht abgerechnet.',
    geht: 'Ändern, ausnehmen, löschen (von Hand erfasste), ankreuzen und auf eine Rechnung setzen.' },
  { name: 'geplant (Angebot)', heisst: 'Position eines Auftrags „mit Angebot“; das Angebot ist noch nicht angenommen.',
    geht: 'Nicht abrechenbar. Änderbar, außer solange ein verschicktes Angebot auf Antwort wartet. Nach der Annahme werden die angebotenen Positionen „offen“, später hinzugekommene „ausgenommen“.' },
  { name: 'auf Rechnungsentwurf', heisst: 'Steht auf einem Rechnungsentwurf, der noch nicht festgeschrieben ist.',
    geht: 'Weiter änderbar (der Entwurf aktualisiert sich). „Vom Entwurf nehmen“ macht ihn wieder „offen“.' },
  { name: 'abgerechnet', heisst: 'Steht auf einer festgeschriebenen Rechnung (Nummer und Zustand der Rechnung daneben).',
    geht: 'Nicht mehr änderbar (GoBD). Wieder „offen“ wird er nur, wenn die Rechnung storniert wird. Ob bezahlt, steht an der Rechnung.' },
  { name: 'ausgenommen', heisst: 'Wird bewusst nicht abgerechnet (z. B. Kulanz oder nicht im angenommenen Angebot).',
    geht: 'Lässt sich wieder auf „abrechnen“ stellen (nicht bei abgesagten Terminen).' },
  { name: 'erlassen', heisst: 'Ein Ausfallhonorar wurde erlassen.', geht: 'Wird nicht abgerechnet.' },
];

export const RECHNUNG_ZUSTAENDE: ZustandErklaerung[] = [
  { name: 'Entwurf', heisst: 'Noch nicht verschickt, noch ohne Rechnungsnummer (Kennung ENTWURF-…).',
    geht: 'Alles änderbar: Positionen, Zahlungsziel; verwerfen; festschreiben per E-Mail oder Post.' },
  { name: 'offen', heisst: 'Festgeschrieben mit Nummer RE-…, noch nicht bezahlt – auch wenn die Fälligkeit schon vorbei ist.',
    geht: 'Unveränderlich. Per E-Mail senden (auch erneut), Zahlung erfassen (Fakturierung → „Zahlung ↑“), mahnen, stornieren.' },
  { name: 'teilweise bezahlt', heisst: 'Ein Teil der Zahlung ist erfasst.', geht: 'Weitere Zahlung erfassen, mahnen, stornieren.' },
  { name: 'bezahlt', heisst: 'Die Zahlung ist vollständig erfasst.', geht: 'Nur noch ansehen; Storno nur mit Gutschrift.' },
  { name: 'storniert', heisst: 'Durch eine Gutschrift aufgehoben.', geht: 'Ihre Posten sind in der Akte wieder „offen“ und lassen sich neu abrechnen.' },
];

export const ANGEBOT_ZUSTAENDE: ZustandErklaerung[] = [
  { name: 'Entwurf', heisst: 'Noch nicht verschickt, noch ohne Angebotsnummer.',
    geht: 'Positionen ändern, löschen, ergänzen; „gültig bis“ ändern; verwerfen; verschicken per E-Mail oder Post.' },
  { name: 'verschickt, Antwort offen', heisst: 'Mit Nummer AN-… verschickt, gesperrt.',
    geht: 'Annahme oder Ablehnung vermerken; Änderungen nur über „Neue Fassung“.' },
  { name: 'abgelaufen', heisst: '„Gültig bis“ ist vorbei, ohne Antwort.', geht: 'Annahme trotzdem vermerken oder neue Fassung anlegen.' },
  { name: 'angenommen', heisst: 'Der Kunde hat angenommen; der Auftrag ist beauftragt.',
    geht: 'Seine Positionen sind offene Posten und werden wie alle abgerechnet („gemäß Angebot AN-…“).' },
  { name: 'abgelehnt', heisst: 'Der Kunde hat abgelehnt.', geht: 'Positionen werden nicht abgerechnet; der Auftrag bleibt als Verlauf.' },
  { name: 'ersetzt durch neue Fassung', heisst: 'Ältere Fassung eines geänderten Angebots.', geht: 'Nicht mehr zu beantworten; ansehen, als Vorlage merken oder als Grundlage für ein neues Angebot nehmen.' },
  { name: 'Vorlage (Markierung)', heisst: 'Ein beliebiges Angebot, das du als Vorlage gemerkt hast.',
    geht: 'Unter Angebote → „nur Vorlagen“ finden; „Neues Angebot aus diesem Angebot“ für jeden Klienten.' },
];
