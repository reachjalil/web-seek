# Web Seek

Bun + TypeScript CLI for recording, replaying, and repeating browser workflows against public web
data sources. It records sessions in the `rrweb` event format, replays them with `rrweb-player`, and
stores extraction workflows as JSON configs that can be rerun with a human in the loop.

## Setup

```bash
cd /Users/jalillaaraichi/dev/web-seek
bun install
bunx playwright install chromium
bun run cli
```

The important runtime dependencies are:

- `playwright` for headed Chrome automation.
- `rrweb` for DOM/session event capture.
- `rrweb-player` for local replay HTML.
- `@clack/prompts` and `cli-table3` for the interactive terminal UI.
- `zod` for validating saved recording and site config JSON.

## CLI Flows

```bash
bun run cli
```

Menu options:

- Start a new rrweb recording.
- List recordings in `./recordings`.
- Replay a recording by generating temporary HTML in `./.cache/replays`.
- Author an extraction config from an interactive browser session.
- Author an extraction config with the browser overlay.
- List extraction configs from `./configs/sites`.
- Run an extraction config and write output to `./exports`.
- Show the government-site extraction blueprint.

## Recording

The recorder launches Chrome, navigates to a target URL, injects the local `rrweb` browser bundle,
and streams emitted rrweb events back to Bun through a Playwright binding.

Recordings are saved as:

```text
recordings/session-<unix-seconds>.json
```

Each file contains metadata, visited URLs, viewport/user agent, and the raw `rrweb` events.

## Replay

Replay reads a recording JSON file, generates a local HTML page with `rrweb-player`, launches
Chrome, and waits for you to press Enter before closing the browser.

## Config-First Extraction

The durable unit for repeatable scraping is a site config:

```text
configs/sites/<jurisdiction-or-site>.json
```

A config describes:

- Browser profile: headed/headless, viewport, slow motion.
- Human-in-loop policy: pause before run, challenge detection, instructions.
- Workflow steps: navigate, fill, select, click, wait, screenshot, download, human checkpoint.
- Extraction steps: table rows, list/card items, pagination, field selectors, transforms.
- Output format: JSON, CSV, or both.

Input variables use this pattern:

```json
"value": "{{input:lastName|Last name, or blank for all}}"
```

When the config runs, the CLI prompts for those values and substitutes them into fill/select/navigate
steps.

## Government Website Patterns

For a state professional engineer license search, expect one or more of these page types:

- Search forms with last name, license number, profession, county, status, or hidden CSRF fields.
- Results tables with server-side pagination.
- Repeated list/card layouts where each record links to a detail page.
- Infinite scroll or "load more" result pages.
- CSV, Excel, JSON, or API exports that may be more complete than the DOM.
- CAPTCHA, terms-of-use, login, or session-timeout screens requiring a human checkpoint.

The interactive authoring flow lets you navigate manually, solve challenges, run page analysis,
highlight candidate data regions, and save the detected pattern as a JSON config. The template at
`configs/sites/professional-engineers-license-search-template.json` shows the intended shape for a
state board lookup site.

The overlay authoring flow builds the React 19 + Tailwind 4 app in `apps/overlay`, injects it into
the current Playwright page, and mounts a Shadow DOM UI over the target website. Use it to select a
repeated item or table row, capture relative fields, choose a pagination control, preview rows from
the current page, inspect the generated config JSON, and save a validated config. The CLI still owns
filesystem writes and validation; the overlay only sends draft state through a Playwright binding.
The same browser context also starts an rrweb authoring recording, so the overlay can show live event
counts and the saved config can point back to the recording that produced it.

The overlay is organized like a compact editor: the floating toolbar opens Capture, Record, and
Output popover palettes, while the side panel keeps shape, action, field, preview, JSON, and
diagnostic views separated. Fields and recorded actions use DnD Kit drag handles so authors can
reorder the generated extraction shape and recorded action flow before saving the config.
An expandable layers timeline keeps the selected repeated shape, fields, recorded actions,
pagination, preview, and generated JSON in one ordered authoring stack. The JSON panel includes both
a generated config preview and a draft editor so advanced selector changes can be applied before the
CLI validates and writes the final config.
The detail panel can be closed from its header, reopened from the toolbar, dragged with its header
handle, and resized from the lower-right grip so it can stay out of the target page's way.
Panel content is split into reusable collapsible inspector sections. The layers section groups
structure, fields, recorded actions, and outputs, with explicit ready/todo/view status badges so the
green check state is clear instead of looking like a checkbox.

Use the Actions mode in the floating toolbar to record a bounded interaction flow directly on the
site. The overlay captures clicks, fills, selects, scroll position, pointer movement counts, and
DOM/network activity during the segment. Stopping the segment appends those actions to the draft; a
next/load-more click is also suggested as pagination.

In item selection mode, the overlay also preselects likely data shapes as the mouse moves. It
highlights the suggested repeated records, scores the selector, generates starter fields, and shows a
floating acceptance panel to accept the suggestion before saving or editing the draft.

Do not bypass CAPTCHA or access controls. Use the human-in-loop pauses for allowed manual actions,
and verify that each target site's terms permit automated collection.

## Development

```bash
bun run check
bun run format
```

Project layout:

```text
apps/cli/src/cli.ts          interactive menu
apps/cli/src/recorder.ts     rrweb recording
apps/cli/src/replayer.ts     rrweb-player replay HTML
apps/cli/src/extractor.ts    config runner
apps/cli/src/config-author.ts browser-assisted config authoring
apps/cli/src/overlay-author.ts overlay injection and save bridge
apps/overlay                 React overlay authoring app
libs/data-engine/src         shared schemas, stores, CSV/JSON utilities
```
