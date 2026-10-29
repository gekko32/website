<!-- Klientenakte (Stufe 2): Klient anlegen oder Stammdaten ändern – ohne Benutzerkonto. -->
<script lang="ts">
  interface Werte {
    name: string; email: string; phone: string;
    address: string; postal_code: string; city: string;
    rechnung_an: 'person' | 'firma';
    rechnung_firma: string; rechnung_firma_adresse: string;
    rechnung_firma_plz: string; rechnung_firma_ort: string;
    rechnung_email: string; rechnung_ust_id: string; notiz: string;
    abrechnungsart: Art;
  }
  type Art = 'monatlich' | 'je_sitzung';
  const ART_TEXT: Record<Art, string> = { monatlich: 'monatlich (Sammelrechnung)', je_sitzung: 'je Sitzung' };

  // Stufe 3 T10b: voreinstellung = Einstellungen → Regeln (Firma / Privat), K26.
  let { klientId = '', start = {}, voreinstellung = { firma: 'monatlich', privat: 'je_sitzung' } }: {
    klientId?: string; start?: Partial<Record<keyof Werte, string | null>>; voreinstellung?: { firma: Art; privat: Art };
  } = $props();
  const vorbelegt = (an: 'person' | 'firma'): Art => (an === 'firma' ? voreinstellung.firma : voreinstellung.privat);

  const s = (v: string | null | undefined) => v ?? '';
  let w = $state<Werte>({
    // Stufe 4 T13: interner Platzhalter (…@….invalid) erscheint als leeres Feld (K61).
    name: s(start.name), email: (start.email ?? '').endsWith('.invalid') ? '' : s(start.email), phone: s(start.phone),
    address: s(start.address), postal_code: s(start.postal_code), city: s(start.city),
    rechnung_an: start.rechnung_an === 'firma' ? 'firma' : 'person',
    rechnung_firma: s(start.rechnung_firma), rechnung_firma_adresse: s(start.rechnung_firma_adresse),
    rechnung_firma_plz: s(start.rechnung_firma_plz), rechnung_firma_ort: s(start.rechnung_firma_ort),
    rechnung_email: s(start.rechnung_email), rechnung_ust_id: s(start.rechnung_ust_id), notiz: s(start.notiz),
    abrechnungsart: start.abrechnungsart === 'monatlich' || start.abrechnungsart === 'je_sitzung'
      ? start.abrechnungsart
      : vorbelegt(start.rechnung_an === 'firma' ? 'firma' : 'person'),
  });
  // Solange Gerald die Abrechnungsart nicht selbst gewählt hat, folgt sie „Rechnung an“.
  let artSelbstGewaehlt = $state(start.abrechnungsart === 'monatlich' || start.abrechnungsart === 'je_sitzung');
  function rechnungAnGeaendert() {
    if (!artSelbstGewaehlt) w.abrechnungsart = vorbelegt(w.rechnung_an);
  }

  let fehler = $state('');
  let meldung = $state('');
  let vorhandenId = $state('');
  let sendet = $state(false);

  async function speichern(e: Event) {
    e.preventDefault();
    fehler = ''; meldung = ''; vorhandenId = '';
    sendet = true;
    try {
      const res = await fetch(klientId ? `/api/admin/klienten/${klientId}` : '/api/admin/klienten', {
        method: klientId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(w),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        fehler = data.error ?? `Nicht gespeichert (Fehler ${res.status}). Bitte noch einmal versuchen.`;
        vorhandenId = data.vorhandenId ?? '';
        return;
      }
      // Seite neu laden, damit „Rechnung geht an“ und Kopfzeile den neuen Stand zeigen.
      if (klientId) { meldung = 'Gespeichert.'; setTimeout(() => window.location.reload(), 600); }
      else { window.location.href = `/admin/klienten/${data.id}`; }
    } catch {
      fehler = 'Netzwerkfehler. Bitte erneut versuchen.';
    } finally {
      sendet = false;
    }
  }

  const feld = 'w-full px-3 py-2 bg-dark-light border border-dark-lighter rounded-lg text-sm text-light focus:outline-none focus:border-gold/50';
  const lbl = 'block text-xs text-muted uppercase tracking-wide mb-1';
</script>

<form onsubmit={speichern} class="space-y-4">
  <div class="grid gap-3 sm:grid-cols-2">
    <div><label class={lbl} for="k-name">Name *</label><input id="k-name" class={feld} bind:value={w.name} required /></div>
    <div><label class={lbl} for="k-email">E-Mail (freiwillig)</label><input id="k-email" type="email" class={feld} bind:value={w.email} placeholder="leer lassen, wenn keine" /></div>
    <div><label class={lbl} for="k-phone">Telefon</label><input id="k-phone" class={feld} bind:value={w.phone} /></div>
    <div><label class={lbl} for="k-adr">Straße und Nr.</label><input id="k-adr" class={feld} bind:value={w.address} /></div>
    <div><label class={lbl} for="k-plz">PLZ</label><input id="k-plz" class={feld} bind:value={w.postal_code} /></div>
    <div><label class={lbl} for="k-ort">Ort</label><input id="k-ort" class={feld} bind:value={w.city} /></div>
  </div>

  <fieldset class="border border-dark-lighter rounded-lg p-3 space-y-3">
    <legend class="text-xs text-muted uppercase tracking-wide px-1">Rechnung an</legend>
    <div class="flex gap-4 text-sm">
      <label class="flex items-center gap-2"><input type="radio" bind:group={w.rechnung_an} value="person" onchange={rechnungAnGeaendert} /> die Person selbst</label>
      <label class="flex items-center gap-2"><input type="radio" bind:group={w.rechnung_an} value="firma" onchange={rechnungAnGeaendert} /> eine Firma</label>
    </div>
    {#if w.rechnung_an === 'firma'}
      <div class="grid gap-3 sm:grid-cols-2">
        <div><label class={lbl} for="k-firma">Firma *</label><input id="k-firma" class={feld} bind:value={w.rechnung_firma} /></div>
        <div><label class={lbl} for="k-fadr">Straße und Nr.</label><input id="k-fadr" class={feld} bind:value={w.rechnung_firma_adresse} /></div>
        <div><label class={lbl} for="k-fplz">PLZ</label><input id="k-fplz" class={feld} bind:value={w.rechnung_firma_plz} /></div>
        <div><label class={lbl} for="k-fort">Ort</label><input id="k-fort" class={feld} bind:value={w.rechnung_firma_ort} /></div>
        <div><label class={lbl} for="k-fust">USt-IdNr. der Firma</label><input id="k-fust" class={feld} bind:value={w.rechnung_ust_id} /></div>
      </div>
    {/if}
    <div><label class={lbl} for="k-remail">Rechnungs-E-Mail (falls abweichend)</label><input id="k-remail" type="email" class={feld} bind:value={w.rechnung_email} /></div>
    <div>
      <label class={lbl} for="k-art">Abrechnung</label>
      <select id="k-art" class={feld} bind:value={w.abrechnungsart} onchange={() => (artSelbstGewaehlt = true)}>
        {#each (['monatlich', 'je_sitzung'] as const) as a (a)}<option value={a}>{ART_TEXT[a]}</option>{/each}
      </select>
      <p class="text-xs text-muted mt-1">Monatlich: am Monatsersten ein Entwurf mit allem aus dem Vormonat. Je Sitzung: jeder Posten sofort ein eigener Entwurf. Verschickt wird erst nach deiner Prüfung.</p>
    </div>
  </fieldset>

  <div>
    <label class={lbl} for="k-notiz">Notiz (nur für dich; keine Gesundheitsangaben)</label>
    <textarea id="k-notiz" rows={2} class={feld} bind:value={w.notiz}></textarea>
  </div>

  {#if fehler}
    <!-- K145 (Handtest 29.10.2026): Fehler deutlich, nicht als kleine rote Zeile. -->
    <p role="alert" class="text-sm text-red-200 border border-red-400 bg-red-900/30 rounded-lg px-3 py-2">{fehler}
      {#if vorhandenId}<a class="underline ml-1" href={`/admin/klienten/${vorhandenId}`}>Zur vorhandenen Akte</a>{/if}
    </p>
  {/if}
  {#if meldung}<p class="text-sm text-green-400">{meldung}</p>{/if}

  <button type="submit" disabled={sendet}
    class="px-4 py-2 rounded-lg bg-gold text-dark text-sm font-semibold disabled:opacity-50">
    {sendet ? 'Speichert …' : klientId ? 'Stammdaten speichern' : 'Klient anlegen'}
  </button>
</form>
