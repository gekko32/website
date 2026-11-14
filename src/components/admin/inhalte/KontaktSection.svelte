<script lang="ts">
  import type { KontaktContent } from '../../../lib/website-db';

  let { initialData }: { initialData: KontaktContent } = $props();
  let data = $state(JSON.parse(JSON.stringify(initialData)));
  // Die Copyright-Zeile wird im Bereich Fußzeile gepflegt (footer.json). Ein Feld
  // hier wurde vom Kontakt-Schema beim Speichern verworfen und wirkte nie.
  let saving = $state(false); let msg = $state(''); let msgOk = $state(true);
  let prUrl = $state('');

  // T001490 Task 7: localStorage draft for publish-latency safety.
  const DRAFT_KEY = 'admin.draft.kontakt';
  if (typeof window !== 'undefined') {
    const draft = localStorage.getItem(DRAFT_KEY);
    if (draft) {
      try {
        const parsed = JSON.parse(draft) as { data: KontaktContent };
        if (parsed && typeof parsed === 'object' && parsed.data) {
          data = parsed.data;
        }
      } catch { /* ignore corrupt drafts */ }
    }
  }
  $effect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ data })); } catch { /* quota */ }
  });

  async function save() {
    saving = true; msg = ''; prUrl = '';
    try {
      const res = await fetch('/api/admin/kontakt/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: data }),
      });
      const json = await res.json();
      if (res.ok) {
        msg = json.prUrl ? `Gespeichert (PR #${json.prNumber}). Die Änderung ist in etwa 30 bis 40 Minuten auf der Website.` : 'Gespeichert.';
        msgOk = true;
        prUrl = json.prUrl ?? '';
        if (typeof window !== 'undefined') localStorage.removeItem(DRAFT_KEY);
      } else { msg = json.error ?? 'Fehler.'; msgOk = false; }
    } catch { msg = 'Verbindungsfehler.'; msgOk = false; }
    finally { saving = false; }
  }

  const inputCls = 'w-full px-3 py-2 bg-dark border border-dark-lighter rounded-lg text-light text-sm focus:outline-none focus:border-gold/50';
  const labelCls = 'block text-xs text-muted mb-1';
  const sectionCls = 'p-6 bg-dark-light rounded-xl border border-dark-lighter space-y-4';
</script>

<div class="pt-6 pb-20 space-y-10">
  <div class="flex justify-between items-start">
    <div><h2 class="text-2xl font-bold text-light font-serif">Kontakt</h2><p class="text-muted mt-1 text-sm">Zentrale Kontaktdaten und Kontaktformular-Texte</p></div>
    <button onclick={save} disabled={saving} class="px-5 py-2 bg-gold text-dark font-semibold rounded-lg hover:bg-gold/90 disabled:opacity-50">{saving?'Speichere…':'Speichern'}</button>
  </div>

  {#if msg}<div class={`p-4 rounded-xl text-sm ${msgOk?'bg-green-500/10 border border-green-500/30 text-green-400':'bg-red-500/10 border border-red-500/30 text-red-400'}`}>
    {msg}{#if prUrl}<a href={prUrl} target="_blank" rel="noopener" class="ml-2 underline">PR ansehen</a>{/if}
  </div>{/if}

  <div class="p-4 bg-dark-light rounded-xl border border-gold/20">
    <p class="text-xs font-mono uppercase tracking-widest text-gold mb-3">Zentrale Elemente – wirken auf allen Seiten</p>
    <p class="text-xs text-muted">Die Region wirkt auf <strong class="text-light">jeder</strong> Seite (Fußzeile) und auf der Kontaktseite.</p>
  </div>

  <div class={sectionCls}>
    <h3 class="text-xl font-bold text-light font-serif">Einsatzgebiet</h3>
    <div>
      <label class={labelCls}>Standort / Region</label>
      <input type="text" bind:value={data.footerCity} class={inputCls} placeholder="Lüneburg, Hamburg und Umgebung" />
      <p class="text-xs text-muted mt-1">Steht in der Fußzeile („Gestaltet in {data.footerCity || 'Lüneburg, Hamburg und Umgebung'} &middot; DE“) und auf der Kontaktseite. Die Geschäftsadresse bleibt in den Stammdaten.</p>
    </div>
    <p class="text-xs text-muted">E-Mail und Telefon pflegst du im Bereich <strong class="text-light">Stammdaten</strong>, die Copyright-Zeile im Bereich <strong class="text-light">Fußzeile</strong>.</p>
  </div>

  <div class={sectionCls}>
    <h3 class="text-xl font-bold text-light font-serif">Kontaktseite – Einleitungstext</h3>
    <textarea bind:value={data.intro} rows={3} class="{inputCls} resize-none"></textarea>
  </div>

  <div class={sectionCls}>
    <h3 class="text-xl font-bold text-light font-serif">Kontaktseite – Sidebar</h3>
    <div><label class={labelCls}>Titel</label><input type="text" bind:value={data.sidebarTitle} class={inputCls} /></div>
    <div><label class={labelCls}>Text</label><textarea bind:value={data.sidebarText} rows={4} class="{inputCls} resize-none"></textarea></div>
    <div><label class={labelCls}>CTA-Text</label><input type="text" bind:value={data.sidebarCta} class={inputCls} /></div>
    <label class="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" bind:checked={data.showPhone} class="accent-gold" />
      <span class="text-sm text-light">Telefonnummer anzeigen (Sidebar)</span>
    </label>
  </div>

  <div class="p-4 bg-dark-light rounded-xl border border-dark-lighter/60">
    <p class="text-xs font-mono uppercase tracking-widest text-muted mb-2">SEO dieser Seite</p>
    <p class="text-sm text-muted">🔒 Seitentitel und Meta-Description der Kontaktseite werden im <a href="/admin/inhalte?tab=website&section=seo" class="text-gold hover:underline">SEO-Tab</a> gepflegt.</p>
  </div>
</div>
