/**
 * Zentrale Standardtexte für die rechtlichen Seiten.
 * Werden sowohl in den öffentlichen Seiten als auch im Admin als Vorschau verwendet.
 * Änderungen hier wirken auf beide Stellen gleichzeitig.
 *
 * Alle Kontaktfelder werden als {{stammdaten.*}}-Token ausgegeben.
 * Die tatsächlichen Werte werden erst beim Rendering via resolveTokens eingesetzt.
 */

export function getDefaultDatenschutz(): string {
  return `<h1>Datenschutzerklärung</h1>
<h2>1. Verantwortlicher</h2>
<p>Verantwortlicher im Sinne der Datenschutz-Grundverordnung (DSGVO) ist:</p>
<p><strong>{{stammdaten.name}}</strong><br>{{stammdaten.role}}<br>{{stammdaten.city}}<br>E-Mail: <a href="mailto:{{stammdaten.email}}">{{stammdaten.email}}</a><br>Telefon: {{stammdaten.phone}}</p>
<h2>2. Grundsätze der Datenverarbeitung</h2>
<p>Wir verarbeiten personenbezogene Daten nur, soweit dies zur Bereitstellung unserer Dienste erforderlich ist. Alle Daten verbleiben vollständig auf eigener Infrastruktur (On-Premises). Es findet keine Übermittlung an Cloud-Anbieter oder Dritte statt.</p>
<p>Rechtsgrundlagen der Verarbeitung: Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung und vorvertragliche Maßnahmen), Art. 6 Abs. 1 lit. c DSGVO (gesetzliche Verpflichtung), Art. 6 Abs. 1 lit. f DSGVO (berechtigte Interessen).</p>
<h2>3. Datenerfassung auf dieser Website</h2>
<h3>Server-Log-Dateien</h3>
<p>Beim Aufruf dieser Website werden automatisch technische Zugriffsdaten erfasst: IP-Adresse, Browsertyp, Betriebssystem, Referrer-URL, aufgerufene Seite, Zeitpunkt des Zugriffs. Diese Daten werden nach 7 Tagen automatisch gelöscht.</p>
<p>Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse am sicheren Betrieb der Website).</p>
<h3>Cookies</h3>
<p>Diese Website verwendet ausschließlich technisch notwendige Cookies. Es werden keine Tracking-, Analyse- oder Werbe-Cookies eingesetzt. Technisch notwendige Cookies erfordern keine Einwilligung (§ 25 Abs. 2 TTDSG).</p>
<h3>Kontaktformular und Terminbuchung</h3>
<p>Wenn Sie das Kontaktformular nutzen oder einen Termin buchen, werden Ihr Name, Ihre E-Mail-Adresse sowie der Nachrichteninhalt verarbeitet. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO. Speicherdauer Kontaktdaten: 3 Jahre.</p>
<h3>Hosting</h3>
<p>Diese Website wird auf Servern der <strong>Hetzner Online GmbH</strong> (Deutschland) betrieben. Alle Daten verbleiben innerhalb der Europäischen Union. Es werden keine Dienste von Google, Meta, Zoom oder sonstigen US-Anbietern eingesetzt.</p>
<h2>4. Ihre Rechte als betroffene Person</h2>
<p>Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung (Art. 18), Datenportabilität (Art. 20), Widerspruch (Art. 21), Widerruf (Art. 7 Abs. 3 DSGVO).</p>
<p>Zur Ausübung Ihrer Rechte: <a href="mailto:{{stammdaten.email}}">{{stammdaten.email}}</a> oder <a href="/meine-daten">Datenverwaltungsseite</a>.</p>
<h2>5. Keine automatisierten Entscheidungen</h2>
<p>Es finden keine automatisierten Entscheidungen im Sinne von Art. 22 DSGVO statt. Es wird kein Profiling betrieben.</p>
<h2>6. Beschwerderecht</h2>
<p>Sie haben das Recht, sich bei der zuständigen Datenschutz-Aufsichtsbehörde zu beschweren: <a href="https://www.bfdi.bund.de" target="_blank" rel="noopener">www.bfdi.bund.de</a></p>
<h2>7. Aktualität</h2>
<p>Stand: April 2026.</p>`;
}

export function getDefaultAgb(): string {
  return `<h1>Allgemeine Geschäftsbedingungen</h1>
<h2>1. Geltungsbereich</h2>
<p>Diese Bedingungen gelten für alle Verträge über Coaching, Beratung, Begleitung und sonstige Leistungen von <strong>{{stammdaten.name}}</strong>, {{stammdaten.role}}, {{stammdaten.street}}, {{stammdaten.zip}} {{stammdaten.city}}, mit Privatpersonen (Verbrauchern) und mit Unternehmen. Was im Einzelfall schriftlich oder per E-Mail vereinbart ist, insbesondere in einem Angebot, geht diesen Bedingungen vor.</p>
<h2>2. Leistungen und Vertragsschluss</h2>
<p>Inhalt, Dauer und Preis der Leistungen stehen auf der Seite <a href="/leistungen">Leistungen</a>. Vorträge, Moderationen, Analysen und andere individuelle Aufträge werden einzeln vereinbart; maßgeblich ist dann das Angebot.</p>
<p>Buchungen über die Website sind eine Anfrage. Der Vertrag kommt mit meiner Bestätigung per E-Mail zustande, bei individuellen Aufträgen mit der Annahme meines Angebots per E-Mail oder schriftlich.</p>
<h2>3. Coaching ist keine Therapie</h2>
<p>Coaching und Beratung sind keine Psychotherapie, keine Heilbehandlung und keine Rechts- oder Steuerberatung und ersetzen diese nicht. Wer in psychotherapeutischer oder ärztlicher Behandlung ist, spricht das bitte vor Beginn an. Entscheidungen und deren Umsetzung liegen in der Verantwortung des Kunden.</p>
<h2>4. Durchführung</h2>
<p>Sitzungen finden vor Ort oder online per Video statt, wie vereinbart. Kommt der Kunde zu spät, endet die Sitzung zur vereinbarten Zeit und wird voll berechnet. Muss ich einen Termin absagen, entstehen dem Kunden keine Kosten.</p>
<h2>5. Preise und Zahlung</h2>
<p>Es gelten die Preise zum Zeitpunkt der Buchung, bei individuellen Aufträgen die Preise im Angebot. Alle Preise sind Endpreise. Als Kleinunternehmer nach § 19 UStG berechne ich keine Umsatzsteuer.</p>
<p>Rechnungen sind innerhalb von 14 Tagen nach Erhalt ohne Abzug zu zahlen. Reise- und Nebenkosten werden nur berechnet, wenn sie vorher vereinbart wurden.</p>
<h2>6. Terminabsage durch den Kunden</h2>
<p>Termine können bis 24 Stunden vor Beginn kostenfrei abgesagt oder verschoben werden, per E-Mail an <a href="mailto:{{stammdaten.email}}">{{stammdaten.email}}</a> oder über den Link in der Terminbestätigung.</p>
<p>Bei späterer Absage oder wenn der Kunde nicht erscheint, berechne ich ein Ausfallhonorar in Höhe des vereinbarten Preises. Dem Kunden bleibt der Nachweis offen, dass mir kein oder ein wesentlich geringerer Schaden entstanden ist. Kann ich die Zeit anderweitig nutzen, verzichte ich auf das Ausfallhonorar. In begründeten Ausnahmefällen, etwa bei plötzlicher Erkrankung, kann ich es erlassen. Für individuelle Aufträge gelten die Absageregeln im Angebot.</p>
<h2>7. Widerrufsrecht für Verbraucher</h2>
<p>Verbraucher, die einen Vertrag online, per E-Mail oder Telefon schließen, haben ein Widerrufsrecht von 14 Tagen (siehe <a href="#widerruf">Widerrufsbelehrung</a> unten). Soll eine Sitzung innerhalb der Widerrufsfrist stattfinden, bestätigt der Kunde, dass ich vorher beginnen soll. Widerruft er danach, zahlt er einen anteiligen Betrag für die bis dahin erbrachte Leistung. Ist die Leistung vollständig erbracht, erlischt das Widerrufsrecht.</p>
<h2>8. Vertraulichkeit</h2>
<p>Ich behandle alles, was ich im Coaching oder in der Beratung erfahre, vertraulich, auch nach Ende der Zusammenarbeit, soweit kein Gesetz mich zur Auskunft verpflichtet. Bezahlt ein Unternehmen das Coaching einer Person, erfährt es nur Termine und Umfang, nicht die Inhalte.</p>
<h2>9. Haftung</h2>
<p>Ich hafte unbeschränkt für Vorsatz und grobe Fahrlässigkeit sowie für Schäden aus der Verletzung des Lebens, des Körpers oder der Gesundheit. Bei leichter Fahrlässigkeit hafte ich nur, wenn ich eine wesentliche Vertragspflicht verletze, und dann nur für den vertragstypischen, vorhersehbaren Schaden.</p>
<h2>10. Unterlagen</h2>
<p>Unterlagen, Präsentationen und Analysen, die ich erstelle, darf der Kunde für den vereinbarten Zweck nutzen. Weitergabe oder Veröffentlichung nur nach Absprache.</p>
<h2>11. Datenschutz</h2>
<p>Es gilt die <a href="/datenschutz">Datenschutzerklärung</a>.</p>
<h2>12. Schlussbestimmungen</h2>
<p>Es gilt deutsches Recht; gegenüber Verbrauchern nur, soweit dadurch keine zwingenden Schutzvorschriften ihres Wohnsitzlandes entfallen. Ich bin nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen. Ist eine Bestimmung unwirksam, bleiben die übrigen wirksam.</p>
<h2 id="widerruf">Widerrufsbelehrung</h2>
<h3>Widerrufsrecht</h3>
<p>Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.</p>
<p>Um Ihr Widerrufsrecht auszuüben, müssen Sie mich ({{stammdaten.name}}, {{stammdaten.street}}, {{stammdaten.zip}} {{stammdaten.city}}, {{stammdaten.email}}) mittels einer eindeutigen Erklärung (z. B. Brief oder E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür das untenstehende Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist. Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.</p>
<h3>Folgen des Widerrufs</h3>
<p>Wenn Sie diesen Vertrag widerrufen, habe ich Ihnen alle Zahlungen, die ich von Ihnen erhalten habe, unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags bei mir eingegangen ist. Für diese Rückzahlung verwende ich dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen wegen dieser Rückzahlung Entgelte berechnet.</p>
<p>Haben Sie verlangt, dass die Dienstleistung während der Widerrufsfrist beginnen soll, so haben Sie mir einen angemessenen Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, zu dem Sie mich von der Ausübung des Widerrufsrechts hinsichtlich dieses Vertrags unterrichten, bereits erbrachten Dienstleistungen im Vergleich zum Gesamtumfang der im Vertrag vorgesehenen Dienstleistungen entspricht.</p>
<h3>Muster-Widerrufsformular</h3>
<p>(Wenn Sie den Vertrag widerrufen wollen, dann füllen Sie bitte dieses Formular aus und senden Sie es zurück.)</p>
<p>An {{stammdaten.name}}, {{stammdaten.street}}, {{stammdaten.zip}} {{stammdaten.city}}, {{stammdaten.email}}:</p>
<p>Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über die Erbringung der folgenden Dienstleistung (*)<br>
– Bestellt am (*) / erhalten am (*)<br>
– Name des/der Verbraucher(s)<br>
– Anschrift des/der Verbraucher(s)<br>
– Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier)<br>
– Datum</p>
<p>(*) Unzutreffendes streichen.</p>
<p><small>Stand: Oktober 2026</small></p>`;
}

export function getDefaultBarrierefreiheit(): string {
  return `<h1>Erklärung zur Barrierefreiheit</h1>
<h2>Stand der Vereinbarkeit mit den Anforderungen</h2>
<p><strong>{{stammdaten.name}}</strong> ({{stammdaten.role}}) ist bemüht, seine Website im Einklang mit den nationalen Rechtsvorschriften zur Umsetzung der Richtlinie (EU) 2016/2102 des Europäischen Parlaments und des Rates barrierefrei zugänglich zu machen.</p>
<p>Diese Erklärung zur Barrierefreiheit gilt für <strong>mentolder.de</strong>.</p>
<h2>Nicht barrierefreie Inhalte</h2>
<p>Die folgenden Inhalte sind nicht barrierefrei: Einige ältere PDF-Dokumente erfüllen möglicherweise nicht alle Anforderungen der WCAG 2.1.</p>
<h2>Erstellung dieser Erklärung</h2>
<p>Diese Erklärung wurde am 1. April 2026 erstellt.</p>
<h2>Feedback und Kontakt</h2>
<p>Wenn Sie Mängel in Bezug auf die Einhaltung der Barrierefreiheitsanforderungen feststellen, wenden Sie sich bitte an: <a href="mailto:{{stammdaten.email}}">{{stammdaten.email}}</a></p>
<h2>Durchsetzungsverfahren</h2>
<p>Wenn Sie auf Ihre Mitteilung keine zufriedenstellende Antwort erhalten haben, können Sie die Durchsetzungsstelle einschalten: <a href="https://www.schlichtungsstelle-bgg.de" target="_blank" rel="noopener">Schlichtungsstelle BGG</a></p>`;
}

export function getDefaultImpressumZusatz(): string {
  return '';
}

export function getDefaultImpressum(): string {
  return `<h1>Impressum</h1>
<p><strong>{{stammdaten.name}}</strong><br>
{{stammdaten.role}}<br>
{{stammdaten.street}}<br>
{{stammdaten.zip}} {{stammdaten.city}}</p>
<p>E-Mail: <a href="mailto:{{stammdaten.email}}">{{stammdaten.email}}</a><br>
Telefon: {{stammdaten.phone}}</p>
<p>USt-IdNr.: {{stammdaten.ustId}}</p>`;
}
