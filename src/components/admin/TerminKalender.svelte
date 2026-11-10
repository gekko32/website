<script lang="ts">
  // Kalender für die freien Zeiten (Gerald 09.11.2026): Monats- und Jahresübersicht,
  // Tage antippen, Uhrzeiten durchscrollen, eintragen.
  import { monatsRaster, zeitListe, woechentlichBis, WOCHENTAGE_KURZ, MONATSNAMEN } from '../../lib/termin-planung';

  interface Fenster { id: string; date: string; winStart: string; winEnd: string; leistungen?: string[] }

  let { heute, feiertage = [], urlaub = [], leistungen = [] }: {
    heute: string;
    feiertage?: string[];
    urlaub?: { start: string; end: string }[];
    leistungen?: { key: string; name: string }[];
  } = $props();

  const FARBEN = ['#7fb3d5', '#a8d5a2', '#e8a87c', '#c39bd3', '#76d7c4', '#f1948a', '#b8c480', '#85a9e0'];
  const farbeVon = (key: string) => FARBEN[Math.max(0, leistungen.findIndex((l) => l.key === key)) % FARBEN.length];
  const nameVon = (key: string) => leistungen.find((l) => l.key === key)?.name ?? key;
  /** Farbe eines Zeitraums: gold, wenn er für alle gilt. */
  const farbeFenster = (f: Fenster | undefined) => (f?.leistungen?.length ? farbeVon(f.leistungen[0]) : 'rgba(200, 169, 110, 0.75)');
  const textFenster = (f: Fenster) => (f.leistungen?.length ? f.leistungen.map(nameVon).join(', ') : 'Alle Leistungen');

  const ZEITEN = zeitListe(6, 22, 15);
  const [startJahr, startMonat] = heute.split('-').map(Number);

  let ansicht = $state<'monat' | 'jahr'>('monat');
  let jahr = $state(startJahr);
  let monat = $state(startMonat);
  let fenster = $state<Fenster[]>([]);
  let auswahl = $state<string[]>([]);
  let von = $state('09:00');
  let bis = $state('12:00');
  let meldung = $state('');
  let woechentlich = $state(false);
  let fuerAlle = $state(true);
  let gewaehlteLeistungen = $state<string[]>([]);
  let serieBis = $state(tagInWochen(heute, 12));
  let beschaeftigt = $state(false);

  const jeTag = $derived.by(() => {
    const m = new Map<string, Fenster[]>();
    for (const f of fenster) m.set(f.date, [...(m.get(f.date) ?? []), f]);
    return m;
  });
  const wochen = $derived(monatsRaster(jahr, monat));
  // Die Tage, auf die „eintragen“ wirkt: Auswahl, auf Wunsch wöchentlich fortgesetzt.
  const zielTage = $derived(woechentlich ? woechentlichBis(auswahl, serieBis).filter(waehlbar) : auswahl);
  const zahlTage = $derived(zielTage.length);
  const maxSerie = $derived(tagInWochen(heute, 52));

  function tagInWochen(tag: string, wochen: number): string {
    return new Date(Date.parse(`${tag}T00:00:00Z`) + wochen * 7 * 86400000).toISOString().slice(0, 10);
  }

  async function laden(j: number): Promise<void> {
    try {
      const r = await fetch(`/api/admin/time-windows?von=${j}-01-01&bis=${j}-12-31`);
      if (r.ok) fenster = await r.json();
      else meldung = 'Die Zeiten konnten nicht geladen werden.';
    } catch { meldung = 'Keine Verbindung.'; }
  }
  $effect(() => { void laden(jahr); });

  const gesperrt = (t: string) => feiertage.includes(t) || urlaub.some((u) => u.start <= t && t <= u.end);
  const waehlbar = (t: string) => t >= heute && !gesperrt(t);

  function tagUmschalten(t: string): void {
    if (!waehlbar(t)) return;
    auswahl = auswahl.includes(t) ? auswahl.filter((x) => x !== t) : [...auswahl, t].sort();
  }

  function wochentagUmschalten(spalte: number): void {
    const tage = wochen.map((w) => w[spalte]).filter((t): t is string => t !== null && waehlbar(t));
    const alleDrin = tage.length > 0 && tage.every((t) => auswahl.includes(t));
    auswahl = alleDrin ? auswahl.filter((t) => !tage.includes(t)) : [...new Set([...auswahl, ...tage])].sort();
  }

  function blaettern(schritt: number): void {
    const m = monat - 1 + schritt;
    jahr += Math.floor(m / 12);
    monat = ((m % 12) + 12) % 12 + 1;
  }

  function vonSetzen(z: string): void {
    von = z;
    if (bis <= z) bis = ZEITEN[Math.min(ZEITEN.indexOf(z) + 4, ZEITEN.length - 1)];
  }

  async function senden(entfernen: boolean): Promise<void> {
    if (zahlTage === 0 || beschaeftigt) return;
    beschaeftigt = true;
    meldung = '';
    try {
      const r = await fetch('/api/admin/time-windows/serie', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tage: zielTage, winStart: von, winEnd: bis, entfernen, leistungen: fuerAlle ? [] : gewaehlteLeistungen }),
      });
      const d = await r.json();
      if (!r.ok) { meldung = d.error ?? 'Fehler beim Speichern.'; return; }
      meldung = entfernen
        ? `${d.entfernt} Zeiten entfernt.`
        : `${d.angelegt} eingetragen${d.uebersprungen ? `, ${d.uebersprungen} übersprungen (dort liegt schon eine überschneidende Zeit)` : ''}.`;
      await laden(jahr);
      if (!entfernen) { auswahl = []; woechentlich = false; }
    } catch { meldung = 'Keine Verbindung.'; } finally { beschaeftigt = false; }
  }

  async function einzelnEntfernen(id: string): Promise<void> {
    const r = await fetch('/api/admin/time-windows/remove', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
    }).catch(() => null);
    if (r?.ok) fenster = fenster.filter((f) => f.id !== id);
    else meldung = 'Die Zeit konnte nicht entfernt werden.';
  }

  const kurz = (z: string) => z.replace(':00', '');
  const tagNummer = (t: string) => Number(t.slice(8));
  const tagDeutsch = (t: string) => `${t.slice(8)}.${t.slice(5, 7)}.${t.slice(0, 4)}`;

  /** Scrollt die gewählte Uhrzeit beim Öffnen in die Mitte. */
  function zeigeGewaehlt(node: HTMLElement): void {
    queueMicrotask(() => {
      const e = node.querySelector<HTMLElement>('.an');
      if (e) node.scrollTop = e.offsetTop - node.clientHeight / 2 + e.clientHeight / 2;
    });
  }
</script>

{#snippet zeitRad(titel: string, wert: string, setze: (z: string) => void, ab: string | null)}
  <div class="rad-block">
    <span class="rad-titel">{titel}</span>
    <div class="rad" role="listbox" aria-label={titel} use:zeigeGewaehlt>
      {#each ZEITEN as z (z)}
        <button type="button" role="option" aria-selected={z === wert} class:an={z === wert} disabled={ab !== null && z <= ab} onclick={() => setze(z)}>{z}</button>
      {/each}
    </div>
  </div>
{/snippet}

<div class="kal">
  <div class="kopf">
    {#if ansicht === 'monat'}
      <button type="button" class="pfeil" aria-label="Voriger Monat" onclick={() => blaettern(-1)}>‹</button>
      <strong>{MONATSNAMEN[monat - 1]} {jahr}</strong>
      <button type="button" class="pfeil" aria-label="Nächster Monat" onclick={() => blaettern(1)}>›</button>
    {:else}
      <button type="button" class="pfeil" aria-label="Voriges Jahr" onclick={() => (jahr -= 1)}>‹</button>
      <strong>{jahr}</strong>
      <button type="button" class="pfeil" aria-label="Nächstes Jahr" onclick={() => (jahr += 1)}>›</button>
    {/if}
    <button type="button" class="umschalten" onclick={() => (ansicht = ansicht === 'monat' ? 'jahr' : 'monat')}>
      {ansicht === 'monat' ? 'Jahresübersicht' : 'Monatsansicht'}
    </button>
  </div>

  <div class="breit">
  <div class="links">
  {#if ansicht === 'jahr'}
    <div class="jahr">
      {#each MONATSNAMEN as name, i (name)}
        <div class="mini">
          <button type="button" class="mini-titel" onclick={() => { monat = i + 1; ansicht = 'monat'; }}>{name}</button>
          <div class="mini-raster">
            {#each monatsRaster(jahr, i + 1).flat() as t, n (n)}
              {#if t}
                <button type="button" style:--art={farbeFenster((jeTag.get(t) ?? [])[0])} class:hat={jeTag.has(t)} class:zu={gesperrt(t)} class:heute={t === heute} class:gew={auswahl.includes(t)}
                  disabled={!waehlbar(t)} aria-pressed={auswahl.includes(t)} aria-label={tagDeutsch(t)} onclick={() => tagUmschalten(t)}>{tagNummer(t)}</button>
              {:else}
                <span></span>
              {/if}
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {:else}
      <div class="monat">
        <div class="raster kopfzeile">
          {#each WOCHENTAGE_KURZ as w, s (w)}
            <button type="button" title={`Alle ${w} dieses Monats auswählen`} onclick={() => wochentagUmschalten(s)}>{w}</button>
          {/each}
        </div>
        {#each wochen as woche, n (n)}
          <div class="raster">
            {#each woche as t, s (s)}
              {#if t}
                {@const liste = jeTag.get(t) ?? []}
                <button type="button" class="tag" style:--art={farbeFenster(liste[0])} class:gew={auswahl.includes(t)} class:hat={liste.length > 0} class:zu={gesperrt(t)} class:heute={t === heute}
                  disabled={!waehlbar(t)} aria-pressed={auswahl.includes(t)} onclick={() => tagUmschalten(t)}>
                  <span class="nr">{tagNummer(t)}</span>
                  {#if gesperrt(t)}<span class="info">frei</span>
                  {:else if liste.length > 0}<span class="info">{kurz(liste[0].winStart)}–{kurz(liste[0].winEnd)}{liste.length > 1 ? ` +${liste.length - 1}` : ''}</span>{/if}
                </button>
              {:else}
                <span></span>
              {/if}
            {/each}
          </div>
        {/each}
        <p class="legende">{#each leistungen.filter((l) => fenster.some((f) => f.leistungen?.includes(l.key))) as l (l.key)}<i class="p" style:background={farbeVon(l.key)}></i> {l.name} {/each}<i class="p hat"></i> Für alle Leistungen <i class="p zu"></i> Urlaub oder Feiertag <i class="p gew"></i> ausgewählt</p>
      </div>

  {/if}
  </div>
      <div class="eingabe">
        <p class="stand">
          {#if auswahl.length === 0}Tippen Sie Tage an, auch in der Jahresübersicht. Ein Tipp auf Mo, Di … wählt in der Monatsansicht alle diese Wochentage.
          {:else}<strong>{zahlTage} {zahlTage === 1 ? 'Tag' : 'Tage'}</strong> betroffen · <button type="button" class="link" onclick={() => (auswahl = [])}>leeren</button>{/if}
        </p>
        {#if auswahl.length > 0}
          <div class="wiederholen">
            <label><input type="radio" name="wiederholen" checked={!woechentlich} onchange={() => (woechentlich = false)} /> Nur ausgewählte Tage</label>
            <label><input type="radio" name="wiederholen" checked={woechentlich} onchange={() => (woechentlich = true)} /> Jede Woche bis</label>
            {#if woechentlich}<input type="date" class="serie-bis" aria-label="Serie bis" min={heute} max={maxSerie} bind:value={serieBis} />{/if}
          </div>
        {/if}
        <div class="raeder">
          {@render zeitRad('Von', von, vonSetzen, null)}
          {@render zeitRad('Bis', bis, (z) => (bis = z), von)}
        </div>
        {#if leistungen.length > 0}
          <div class="gilt">
            <span class="rad-titel">Gilt für</span>
            <label><input type="radio" name="gilt" checked={fuerAlle} onchange={() => (fuerAlle = true)} /> Alle Leistungen</label>
            <label><input type="radio" name="gilt" checked={!fuerAlle} onchange={() => (fuerAlle = false)} /> Bestimmte Leistungen</label>
            {#if !fuerAlle}
              <div class="gilt-liste">
                {#each leistungen as l (l.key)}
                  <label><input type="checkbox" bind:group={gewaehlteLeistungen} value={l.key} /> <i class="p" style:background={farbeVon(l.key)}></i> {l.name}</label>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
        <div class="knoepfe">
          <button type="button" class="haupt" disabled={zahlTage === 0 || beschaeftigt || (!fuerAlle && gewaehlteLeistungen.length === 0)} onclick={() => senden(false)}>{von} bis {bis} eintragen</button>
          <button type="button" class="neben" disabled={zahlTage === 0 || beschaeftigt} onclick={() => senden(true)}>Genau diese Zeit entfernen</button>
        </div>
        {#if meldung}<p class="meldung" role="status">{meldung}</p>{/if}
        {#each auswahl.filter((t) => jeTag.has(t)).slice(0, 12) as t (t)}
          <div class="zeile">
            <span>{tagDeutsch(t)}</span>
            {#each jeTag.get(t) ?? [] as f (f.id)}
              <span class="chip" style:border-left-color={farbeFenster(f)} title={textFenster(f)}>{f.winStart}–{f.winEnd} · {textFenster(f)}<button type="button" aria-label={`${f.winStart} bis ${f.winEnd} entfernen`} onclick={() => einzelnEntfernen(f.id)}>✕</button></span>
            {/each}
          </div>
        {/each}
      </div>
  </div>
</div>

<style>
  .kal { background: var(--ink-850, #161b22); border: 1px solid var(--line, #2a313b); border-radius: 12px; padding: 16px; color: var(--fg, #e6edf3); }
  button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }
  button:disabled { cursor: default; }
  .kopf { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .kopf strong { min-width: 9.5em; text-align: center; font-size: 16px; }
  .pfeil { width: 40px; height: 40px; font-size: 22px; border: 1px solid var(--line, #2a313b); border-radius: 8px; }
  .umschalten { margin-left: auto; font-size: 13px; color: var(--brass, #c8a96e); padding: 8px; }
  .breit { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 20px; }
  .raster { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; margin-bottom: 4px; }
  .kopfzeile button { font-size: 12px; padding: 6px 0; color: var(--brass, #c8a96e); }
  .tag { min-height: 58px; border: 1px solid var(--line, #2a313b); border-radius: 8px; padding: 4px 2px; display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
  .tag:disabled { opacity: 0.35; }
  .nr { font-size: 14px; }
  .info { font-size: 10px; line-height: 1.15; text-align: center; overflow-wrap: anywhere; }
  .tag.hat { background: color-mix(in srgb, var(--art) 22%, transparent); border-color: var(--art); }
  .tag.zu { background: rgba(208, 106, 92, 0.12); opacity: 0.6; }
  .tag.heute .nr { text-decoration: underline; font-weight: 700; }
  .tag.gew { background: var(--brass, #c8a96e); color: var(--ink-900, #0e1116); border-color: var(--brass, #c8a96e); }
  .legende { font-size: 11px; color: var(--mute, #9aa4b2); margin: 8px 0 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .p { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  .p.hat { background: rgba(200, 169, 110, 0.5); } .p.zu { background: rgba(208, 106, 92, 0.5); } .p.gew { background: var(--brass, #c8a96e); }
  .stand { font-size: 13px; margin: 0 0 10px; color: var(--mute, #9aa4b2); }
  .stand strong { color: var(--fg, #e6edf3); }
  .link { color: var(--brass, #c8a96e); text-decoration: underline; }
  .raeder { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .rad-titel { font-size: 12px; color: var(--mute, #9aa4b2); }
  .rad { position: relative; height: 190px; overflow-y: auto; border: 1px solid var(--line, #2a313b); border-radius: 8px; margin-top: 4px; scroll-snap-type: y proximity; -webkit-overflow-scrolling: touch; }
  .rad button { -webkit-tap-highlight-color: transparent; display: block; width: 100%; padding: 8px 0; font-size: 15px; font-variant-numeric: tabular-nums; scroll-snap-align: center; }
  .rad button:disabled { opacity: 0.3; }
  .rad button.an { background: var(--brass, #c8a96e); color: var(--ink-900, #0e1116); font-weight: 700; }
  .knoepfe { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
  .haupt { background: var(--brass, #c8a96e); color: var(--ink-900, #0e1116); font-weight: 600; border-radius: 8px; padding: 11px; }
  .neben { border: 1px solid var(--line, #2a313b); border-radius: 8px; padding: 8px; font-size: 13px; color: var(--mute, #9aa4b2); }
  .haupt:disabled, .neben:disabled { opacity: 0.4; }
  .meldung { font-size: 13px; color: var(--brass, #c8a96e); margin: 10px 0 0; }
  .zeile { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; font-size: 13px; }
  .gilt { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; margin-top: 12px; font-size: 13px; }
  .gilt .rad-titel { width: 100%; }
  .gilt label { display: flex; align-items: center; gap: 5px; cursor: pointer; }
  .gilt-liste { width: 100%; display: flex; flex-direction: column; gap: 6px; padding-left: 4px; }
  .chip { border-left: 3px solid transparent; background: rgba(200, 169, 110, 0.14); border-radius: 6px; padding: 3px 4px 3px 8px; font-variant-numeric: tabular-nums; }
  .chip button { padding: 2px 6px; color: var(--mute, #9aa4b2); }
  .links { min-width: 0; }
  .wiederholen { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; margin-bottom: 10px; font-size: 13px; }
  .wiederholen label { display: flex; align-items: center; gap: 5px; cursor: pointer; }
  .serie-bis { background: var(--ink-800, #0e1116); border: 1px solid var(--line, #2a313b); border-radius: 6px; color: var(--fg, #e6edf3); padding: 4px 6px; font: inherit; }
  .jahr { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 14px; }
  .mini-titel { font-size: 13px; font-weight: 600; color: var(--brass, #c8a96e); padding: 4px 0; }
  .mini-raster { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; font-size: 11px; text-align: center; }
  .mini-raster button { padding: 3px 0; border-radius: 3px; font-size: 11px; -webkit-tap-highlight-color: transparent; }
  .mini-raster button:disabled { opacity: 0.35; }
  .mini-raster .hat { background: color-mix(in srgb, var(--art) 55%, transparent); }
  .mini-raster .zu { background: rgba(208, 106, 92, 0.3); }
  .mini-raster .heute { outline: 1px solid var(--brass, #c8a96e); }
  .mini-raster .gew { background: var(--brass, #c8a96e); color: var(--ink-900, #0e1116); font-weight: 700; }
  @media (max-width: 760px) {
    .kal { padding: 10px; }
    .breit { grid-template-columns: minmax(0, 1fr); }
    .jahr { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .kopf strong { min-width: 0; font-size: 15px; }
    .tag { min-height: 54px; }
  }
</style>
