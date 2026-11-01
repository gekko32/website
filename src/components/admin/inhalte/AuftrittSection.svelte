<script lang="ts">
  // SPEZ-NEUER-AUFTRITT K199/K200: Für-wen-Karten, „Wer ich bin“ (teil = 'karten')
  // oder Beispiele aus der Praxis (teil = 'beispiele'). Gespeichert wird immer die ganze auftritt.json.
  import type { AuftrittContent } from '../../../content-schema';
  import { speichern } from './auftritt-speichern';

  let { initialData, teil }: {
    initialData: { value: AuftrittContent; baseSha: string | null };
    teil: 'karten' | 'beispiele';
  } = $props();

  let daten = $state<AuftrittContent>(JSON.parse(JSON.stringify(initialData.value)));
  let baseSha = $state<string | null>(initialData.baseSha);
  let saving = $state(false);
  let meldung = $state(''); let ok = $state(true); let fehler = $state<string[]>([]);

  const NAMEN = { fuerWen: 'Karte', beispiele: 'Beispiel', werIchBin: 'Absatz „Wer ich bin“' };

  function verschieben<T>(liste: T[], i: number, d: number): T[] {
    const j = i + d;
    if (j < 0 || j >= liste.length) return liste;
    const neu = [...liste];
    [neu[i], neu[j]] = [neu[j], neu[i]];
    return neu;
  }

  async function save() {
    saving = true; meldung = ''; fehler = [];
    const r = await speichern('/api/admin/auftritt/save', daten, baseSha, NAMEN);
    ok = r.ok; meldung = r.meldung; fehler = r.fehler;
    // Nach einem erfolgreichen Speichern ohne Abgleich weiter, bis die Seite neu geladen ist (der neue Stand
    // ist erst nach dem Zusammenführen in main sichtbar).
    if (r.ok) baseSha = null;
    saving = false;
  }

  const inputCls = 'w-full px-3 py-2 bg-dark border border-dark-lighter rounded-lg text-light text-sm focus:outline-none focus:border-gold/50';
  const labelCls = 'block text-xs text-muted mb-1';
  const boxCls = 'p-3 bg-dark rounded-lg border border-dark-lighter space-y-2';
  const sectionCls = 'p-6 bg-dark-light rounded-xl border border-dark-lighter space-y-4';
  const smallBtn = 'px-2 py-1 rounded-md border border-dark-lighter text-muted hover:text-light hover:border-gold/50 disabled:opacity-30 text-sm';
</script>

<div class="pt-6 pb-20 space-y-8">
  <div class="flex justify-between items-start gap-4">
    <div>
      <h2 class="text-2xl font-bold text-light font-serif">{teil === 'karten' ? 'Karten „Für wen“ und „Wer ich bin“' : 'Beispiele aus der Praxis'}</h2>
      <p class="text-muted mt-1 text-sm">
        {teil === 'karten'
          ? 'Die vier Karten auf der Startseite und der Abschnitt „Wer ich bin“.'
          : 'Karten im Abschnitt „Was ich heute umsetze“. Bitte keine Kundennamen eintragen.'}
      </p>
    </div>
    <button onclick={save} disabled={saving} class="px-5 py-2 bg-gold text-dark font-semibold rounded-lg hover:bg-gold/90 disabled:opacity-50">{saving ? 'Speichere…' : 'Speichern'}</button>
  </div>

  {#if meldung}
    <div class={`p-4 rounded-xl text-sm ${ok ? 'bg-green-500/10 border border-green-500/30 text-green-400' : 'bg-red-500/10 border border-red-500/30 text-red-400'}`}>
      {meldung}
      {#if fehler.length}<ul class="list-disc ml-5 mt-2">{#each fehler as f}<li>{f}</li>{/each}</ul>{/if}
    </div>
  {/if}

  {#if teil === 'karten'}
    <div class={sectionCls}>
      <h3 class="text-xl font-bold text-light font-serif">Karten „Für wen“</h3>
      {#each daten.fuerWen as k, i (i)}
        <div class={boxCls}>
          <div class="flex items-center gap-2">
            <button type="button" class={smallBtn} onclick={() => (daten.fuerWen = verschieben(daten.fuerWen, i, -1))} disabled={i === 0} aria-label="Nach oben">↑</button>
            <button type="button" class={smallBtn} onclick={() => (daten.fuerWen = verschieben(daten.fuerWen, i, 1))} disabled={i === daten.fuerWen.length - 1} aria-label="Nach unten">↓</button>
            <span class="text-xs text-muted">Karte {i + 1}</span>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class={labelCls}>Titel</label><input class={inputCls} bind:value={k.titel} /></div>
            <div><label class={labelCls}>Ziel (Seite)</label><input class={inputCls} bind:value={k.href} placeholder="/kleine-unternehmen" /></div>
          </div>
          <div><label class={labelCls}>Satz in der Sprache des Besuchers</label><input class={inputCls} bind:value={k.zitat} /></div>
          <div><label class={labelCls}>Beleg</label><textarea class={inputCls} rows="2" bind:value={k.beleg}></textarea></div>
        </div>
      {/each}
    </div>

    <div class={sectionCls}>
      <div class="flex items-center justify-between">
        <h3 class="text-xl font-bold text-light font-serif">„Wer ich bin“</h3>
        <button type="button" class="px-3 py-1.5 text-sm rounded-md border border-gold/40 text-gold hover:bg-gold/10" onclick={() => (daten.werIchBin = [...daten.werIchBin, ''])}>+ Absatz</button>
      </div>
      {#each daten.werIchBin as _absatz, i (i)}
        <div class="flex gap-2 items-start">
          <textarea class={inputCls} rows="3" bind:value={daten.werIchBin[i]}></textarea>
          <button type="button" class="px-2 py-1 text-xs rounded-md border border-red-500/40 text-red-400 hover:bg-red-500/10" onclick={() => (daten.werIchBin = daten.werIchBin.filter((_, j) => j !== i))}>Entfernen</button>
        </div>
      {/each}
    </div>
  {:else}
    <div class={sectionCls}>
      <div class="flex items-center justify-between">
        <h3 class="text-xl font-bold text-light font-serif">Beispiele</h3>
        <button type="button" class="px-3 py-1.5 text-sm rounded-md border border-gold/40 text-gold hover:bg-gold/10"
          onclick={() => (daten.beispiele = [...daten.beispiele, { bereich: '', titel: '', vorher: '', loesung: '', stand: '', sichtbar: true }])}>+ Beispiel</button>
      </div>
      {#each daten.beispiele as b, i (i)}
        <div class={boxCls}>
          <div class="flex items-center gap-2">
            <button type="button" class={smallBtn} onclick={() => (daten.beispiele = verschieben(daten.beispiele, i, -1))} disabled={i === 0} aria-label="Nach oben">↑</button>
            <button type="button" class={smallBtn} onclick={() => (daten.beispiele = verschieben(daten.beispiele, i, 1))} disabled={i === daten.beispiele.length - 1} aria-label="Nach unten">↓</button>
            <span class="text-xs text-muted">Beispiel {i + 1}</span>
            <label class="ml-4 text-xs text-muted flex items-center gap-1"><input type="checkbox" bind:checked={b.sichtbar} /> auf der Website zeigen</label>
            <button type="button" class="ml-auto px-2 py-1 text-xs rounded-md border border-red-500/40 text-red-400 hover:bg-red-500/10" onclick={() => (daten.beispiele = daten.beispiele.filter((_, j) => j !== i))}>Entfernen</button>
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div><label class={labelCls}>Bereich</label><input class={inputCls} bind:value={b.bereich} placeholder="Verein" /></div>
            <div class="col-span-2"><label class={labelCls}>Titel</label><input class={inputCls} bind:value={b.titel} /></div>
          </div>
          <div><label class={labelCls}>Vorher</label><textarea class={inputCls} rows="2" bind:value={b.vorher}></textarea></div>
          <div><label class={labelCls}>Lösung</label><textarea class={inputCls} rows="2" bind:value={b.loesung}></textarea></div>
          <div><label class={labelCls}>Stand</label><input class={inputCls} bind:value={b.stand} placeholder="Im Einsatz" /></div>
        </div>
      {/each}
    </div>
  {/if}
</div>
