# mentolder Website (eigene Kopie, Gerald)

Eigene Kopie der Website aus Paddione/Bachelorprojekt, Stand `f3ceec26a`
(15.10.2026, derselbe Stand wie live). Angelegt am 19.10.2026, um das
Rechnungswesen unabhängig weiterzuentwickeln (siehe
`technik/hetzner/RECHNUNGSWESEN-BEFUNDE.md` in Geralds code-Ordner).

- Image: `ghcr.io/gekko32/website` (Bau: `.github/workflows/build.yml`).
- Auf dem Server eingebunden über `gekko32/mentolder-prod`
  (`prod-fleet/website-mentolder/website-patch.yaml`, `render.yml`).
- Unterschiede zu Patricks Ordner `components/website`: Repo-Wurzel = Website,
  `.lavish`-Dateien als echte Dateien in `public/cockpit/`, `scripts/knowledge`
  hierher verschoben, Marke korczewski (Fotos) entfernt – diese Kopie dient nur mentolder.
- Patricks spätere Änderungen kommen **nicht** automatisch herein.

---

## Ursprüngliche Beschreibung (components/website/)

Astro + Svelte multi-brand website for the Workspace MVP platform.
Serves two brands at runtime via `BRAND` / `BRAND_ID` env var:
`mentolder` (mentolder.de) and `korczewski` (korczewski.de).

## Local dev

```bash
pnpm install
pnpm dev          # http://localhost:4321
```

Requires Postgres with the `bachelorprojekt` database, or set
`DATABASE_URL` pointing to a dev cluster via port-forward on 15432.

## Container build

```bash
docker build -t workspace-website .
```

## Tests

```bash
pnpm test         # Vitest unit tests
```

End-to-end tests live in `../tests/e2e/` and run via Playwright.

## Key references

- `CLAUDE.md` — agent quick-reference for content patterns and data-flow
- `WEBSITE-STANDARDS.md` — authoritative frontend standards (components, a11y, i18n)
- `astro.config.mjs` — build configuration and integrations
