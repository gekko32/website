<script lang="ts">
  // Fail-soft client island that loads the next free CalDAV slot on idle.
  // Replaces the SSR-side getAvailableSlots() await in pages/index.astro:
  // the homepage must stay available when CalDAV is unreachable
  // (T001490 Task 5). On timeout / network error we render nothing
  // and the surrounding StatsStrip falls back to its static defaults.

  type DaySlot = {
    date: string;
    // /api/calendar/slots liefert nur freie Slots (ohne Feld available); ein mitgeliefertes available=false gilt als belegt.
    slots: Array<{ start: string; end: string; available?: boolean }>;
  };

  // label/buchenHref: optional für den Kontaktabschnitt der mentolder-Startseite (SPEZ K181).
  export let label = 'Nächster Termin:';
  export let buchenHref = '';
  export let durationMin: number | null = null;

  let next: DaySlot | null = null;
  let loaded = false;

  async function load() {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4_000);
    try {
      const res = await fetch(durationMin ? `/api/calendar/slots?durationMin=${durationMin}` : '/api/calendar/slots', { signal: ctl.signal });
      if (res.ok) {
        const body = await res.json() as DaySlot[];
        next = body.find((d) => d.slots?.some((s) => s.available !== false)) ?? null;
      }
    } catch {
      next = null;
    } finally {
      clearTimeout(t);
      loaded = true;
    }
  }

  $: if (!loaded) void load();

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' });
    } catch { return iso; }
  }
  function formatTime(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  }
</script>

{#if next}
  {@const first = next.slots.find((s) => s.available !== false)}
  <span class="next-slot-island">
    {label} <strong>{formatDate(next.date)}</strong>
    {#if first}um <strong>{formatTime(first.start)}</strong>{/if}
    {#if buchenHref}<a href={buchenHref}>Termin buchen →</a>{/if}
  </span>
{/if}

<style>
  .next-slot-island { font-size: 0.95em; }
  strong { font-weight: 600; }
  a { margin-left: 0.6em; color: var(--brass, currentColor); text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
