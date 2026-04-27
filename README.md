# Web Seek

Local, authorized browser QA automation brief authoring, with legacy extraction workflow authoring
and browser-flow QA replay.

Web Seek is now centered on browser QA automation briefs. The primary path is to open a site in
headed Chrome, demonstrate the important interactions, annotate UI elements or visual regions,
record expected behavior, and save a validated `web-seek.browser-qa-brief.v1` JSON handoff under
`qa-briefs/`. A later QA agent should treat the brief as automation guidance for Playwright-style
tests, not as a guaranteed replay script, crawler, or extractor.

The config-first extraction workflow remains available as a legacy path for structured public data
collection under `configs/sites/`. Browser-flow recording and replay remain available as QA/debug
tools under `flows/`.

## Setup

```bash
cd /Users/jalillaaraichi/dev/web-seek
bun install
bunx playwright install chromium
bun run cli
```

The important runtime dependencies are:

- `playwright` for headed Chrome authoring, extraction, and replay.
- `@clack/prompts` and `cli-table3` for the interactive terminal UI.
- `zod` for validating saved configs, browser flows, and run results.

## CLI

```bash
bun run cli
```

Menu:

```text
Web Seek
Browser QA automation brief authoring with legacy extraction and replay tools

? What would you like to do?
  Create browser QA brief
  Create extraction workflow (legacy)
  Run extraction workflow
  Create browser flow (QA debug)
  Replay browser flow (QA debug)
  Exit
```

Use browser QA briefs when you want to hand off expected behaviors, selectors, and demonstrated
interactions to an automation agent. Use extraction workflows when you want structured output in
JSON/CSV. Use browser flows when you want to replay and debug a QA path with step-level
captures/assertions.

Detailed operator docs:

- [User guide](docs/USER_GUIDE.md)
- [Authoring checklist](docs/AUTHORING_CHECKLIST.md)
- [Smoke test runbook](docs/SMOKE_TEST.md)

## Browser QA Briefs

QA briefs are saved as:

```text
qa-briefs/<brief-id>.json
```

Each brief includes:

- `id`, `name`, `summary`, `startUrl`, and `visitedUrls`.
- Creation/update timestamps, viewport, and headed browser metadata.
- Guardrails: headed review, no CAPTCHA/access-control bypass, and no credential capture.
- Ordered guidance steps: `navigate`, `demo-click`, `demo-focus`, `demo-input`,
  `demo-keyboard`, `demo-scroll`, `annotate-element`, `annotate-region`, `assertion-note`,
  `checkpoint`, and `comment`.
- Optional notes and audit metadata.

The overlay has three working states:

- `Browse`: the website is fully usable.
- `Annotate`: clicks and drags create QA notes instead of interacting with the page.
- `Recording`: the site remains usable while Web Seek captures demonstrated actions as guidance.

Press `Shift+Tab` to toggle Browse/Annotate unless focus is inside an overlay input. Use the toolbar
to start/stop recording, draw a region, add assertions, add checkpoints/comments, preview JSON, and
save the brief.

Element-target steps include the best selector Web Seek can infer, bounding rect, URL, scroll
position, page title, viewport, text sample, tag name, ARIA label, form name, role, and test-id
metadata when available.

Example automation-agent interpretation:

```text
Read demo-* steps as hints for how the operator reached the state.
Use selectors and rects as repairable locator hints, not immutable commands.
Convert assertion-note and annotate-* steps into explicit Playwright expectations.
Stop or add a human checkpoint when CAPTCHA, login, terms, or access-control screens appear.
```

## Extraction Workflows

Extraction workflows are saved as:

```text
configs/sites/<workflow-id>.json
exports/<workflow-id>-<timestamp>.json
exports/<workflow-id>-<timestamp>.csv
```

Each config describes:

- Browser profile and human-in-loop policy.
- Ordered setup actions: `navigate`, `fill`, `select`, `click`, `scroll`, `wait`, checkpoints.
- Capture shape: table rows or repeated list/card records.
- Field selectors, attributes, required flags, and transforms.
- Optional bounded pagination with `maxPages`.
- Output format and directory.

Input variables use this pattern:

```json
"value": "{{input:lastName|Last name, or blank for all}}"
```

When a workflow runs, the CLI prompts for those values and substitutes them into navigate, fill, and
select steps.

## Create Extraction Workflow

The authoring overlay follows four steps:

1. Navigate: open the start URL and record bounded setup actions such as search/filter inputs.
2. Capture: choose a repeated record/table shape and the fields to extract.
3. Loop: optionally select a Next/load-more control with a bounded `maxPages`.
4. Verify: run preview, inspect diagnostics/JSON, then save.

Preview is required before saving unless the operator explicitly chooses `Save without preview` from
Diagnostics. Selector repair controls show the primary selector plus alternates, with current-page
match counts. Recorded actions can be reordered, deleted, marked optional, edited for fill/select
values, or followed by inserted wait/checkpoint steps.

After saving, the CLI can run a smoke extraction immediately and prints row/page counts plus JSON/CSV
artifact paths.

## Run Extraction Workflow

`Run extraction workflow` lists valid configs from `configs/sites/`, prompts for any configured
input variables, runs the bounded workflow in headed Chrome, and writes output to `exports/`.

Human checkpoints and detected challenges pause for permitted operator action. Do not bypass CAPTCHA,
terms screens, authentication, paywalls, rate limits, or access controls.

## Browser Flows

Browser flows are QA/debug artifacts saved separately from extraction configs:

```text
flows/<flow-id>.json
flows/runs/<flow-id>-<timestamp>.json
flows/artifacts/<flow-id>-<step-id>-<timestamp>.png
```

They use the `web-seek.browser-flow.v1` schema and support headed replay with an on-page controller:
run all, step next, pause/resume, restart, skip, stop, and keep browser open. Browser-flow captures
are step-level text/region/assertion results, not structured extraction rows.

## Safety Posture

Use Web Seek for authorized, bounded workflows. Do not use it to defeat CAPTCHA, access controls,
paywalls, authentication, rate limits, terms screens, browser identity checks, or hidden background
collection. Prefer official exports or public APIs when they provide the same data.

Manual checkpoints are explicit, replay is headed by default, pagination is bounded, and browser-flow
origin changes are constrained by saved allowed origins.

## Development

```bash
bun run check
bun test apps/overlay/src/config-preview.test.ts
bun run format
```

Project layout:

```text
apps/cli/src/cli.ts                  interactive menu
apps/cli/src/browser-qa-brief-author.ts  browser QA brief authoring overlay bridge
apps/cli/src/overlay-author.ts       extraction workflow overlay bridge
apps/cli/src/extractor.ts            extraction config runner
apps/cli/src/browser-flow-author.ts  browser-flow debug authoring
apps/cli/src/browser-flow-replay.ts  browser-flow replay controller orchestration
apps/overlay                         React extraction authoring overlay
libs/data-engine/src/schemas.ts      shared schemas
libs/data-engine/src/*-store.ts      Bun-native local storage helpers
qa-briefs/                           browser QA automation briefs
configs/sites/                       extraction workflow configs
exports/                             extraction output
flows/                               browser-flow debug artifacts
recordings/                          legacy rrweb recordings
```
