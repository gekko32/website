<script lang="ts">
  // SPEZ-NEUER-AUFTRITT K201: Geschichten anlegen, ändern, sortieren, ausblenden.
  import type { Geschichte } from '../../../content-schema';
  import { speichern } from './auftritt-speichern';

  let { initialData, onGespeichert }: {
    initialData: { value: Geschichte[]; baseSha: string | null };
    onGespeichert?: (stand: { value: Geschichte[]; baseSha: string | null }) => void;
  } = $props();

  let liste = $state<Geschichte[]>(
    JSON.parse(JSON.stringify(initialData.value)).sort((a: Geschichte, b: Geschichte) => a.order - b.order),
  );
  let baseSha = $state<string | null>(initialData.baseSha);
  let offen = $state<number | null>(null);
  let saving = $state(false);
  let meldung = $state(''); let ok = $state(true); let fehler = $state<string[]>([]);

  const NAMEN = { '#': 'Geschichte', '(root)': 'Geschichten' };
  const vorhandeneAdressen = new Set(initialData.value.map((g) => g.slug));

  function adresseAus(titel: string): string {
    return titel.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  }

  function neu() {
    liste = [...liste, { slug: '', title: '', zeit: '', teaser: '', order: liste.length + 1, sichtbar: false, text: '' }];
    offen = liste.length - 1;
  }
  function verschieben(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= liste.length) return;
    const neu = [...liste];
    [neu[i], neu[j]] = [neu[j], neu[i]];
    liste = neu;
    if (offen === i) offen = j; else if (offen === j) offen = i;
  }

  async function save() {
    saving = true; meldung = ''; fehler = [];
    // Reihenfolge = Position in der Liste; neue Geschichten bekommen ihre Adresse aus dem Titel.
    const payload = liste.map((g, i) => ({
      ...g,
      slug: vorhandeneAdressen.has(g.slug) ? g.slug : (g.slug || adresseAus(g.title)),
      order: i + 1,
    }));
    const r = await speichern('/api/admin/geschichten/save', payload, baseSha, NAMEN);
    ok = r.ok; meldung = r.meldung;
    fehler = r.fehler;
    if (r.ok) {
      baseSha = r.blobSha ?? null;
      liste = payload;
      payload.forEach((g) => vorhandeneAdressen.add(g.slug));
      onGespeichert?.({ value: JSON.parse(JSON.stringify(payload)), baseSha });
    }
    saving = false;
  }

  const inputCls = 'w-full px-3 py-2 bg-dark border border-dark-lighter rounded-lg text-light text-sm focus:outline-none focus:border-gold/50';
  const labelCls = 'block text-xs text-muted mb-1';
  const smallBtn = 'px-2 py-1 rounded-md border border-dark-lighter text-muted hover:text-light hover:border-gold/50 disabled:opacity-30 text-sm';
</script>

<div class="pt-6 pb-20 space-y-8">
  <div class="flex justify-between items-start gap-4">
    <div>
      <h2 class="text-2xl font-bold text-light font-serif">Geschichten</h2>
      <p class="text-muted mt-1 text-sm">
        Absätze durch eine Leerzeile trennen. <code>**fett**</code> für fette Wörter,
        <code>[Text](/geschichten/…)</code> für einen Link. Neue Geschichten sind zunächst ausgeblendet.
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

  <div class="p-6 bg-dark-light rounded-xl border border-dark-lighter space-y-3">
    {#each liste as g, i (i)}
      <div class="p-3 bg-dark rounded-lg border border-dark-lighter space-y-3">
        <div class="flex items-center gap-2 flex-wrap">
          <button type="button" class={smallBtn} onclick={() => verschieben(i, -1)} disabled={i === 0} aria-label="Nach oben">↑</button>
          <button type="button" class={smallBtn} onclick={() => verschieben(i, 1)} disabled={i === liste.length - 1} aria-label="Nach unten">↓</button>
          <button type="button" class="text-left text-light font-semibold" onclick={() => (offen = offen === i ? null : i)}>
            {g.title || 'Neue Geschichte'}
          </button>
          <span class="text-xs text-muted">{g.slug ? `/geschichten/${g.slug}` : '(Adresse aus dem Titel)'}</span>
          <label class="ml-auto text-xs text-muted flex items-center gap-1"><input type="checkbox" bind:checked={g.sichtbar} /> auf der Website zeigen</label>
        </div>
        {#if offen === i}
          <div class="grid grid-cols-2 gap-3">
            <label class="block"><span class={labelCls}>Titel</span><input class={inputCls} bind:value={g.title} /></label>
            <label class="block"><span class={labelCls}>Zeitraum</span><input class={inputCls} bind:value={g.zeit} placeholder="Digitalfunk, 2001–2007" /></label>
          </div>
          <label class="block"><span class={labelCls}>Kurztext (Startseite, zwei Sätze)</span><textarea class={inputCls} rows="2" bind:value={g.teaser}></textarea></label>
          <label class="block"><span class={labelCls}>Volltext</span><textarea class={`${inputCls} font-mono`} rows="18" bind:value={g.text}></textarea></label>
          <div class="flex justify-end">
            <button type="button" class="px-2 py-1 text-xs rounded-md border border-red-500/40 text-red-400 hover:bg-red-500/10"
              onclick={() => { liste = liste.filter((_, j) => j !== i); offen = null; }}>Geschichte entfernen</button>
          </div>
        {/if}
      </div>
    {/each}
    <button type="button" class="px-3 py-1.5 text-sm rounded-md border border-gold/40 text-gold hover:bg-gold/10" onclick={neu}>+ Neue Geschichte</button>
  </div>
</div>
