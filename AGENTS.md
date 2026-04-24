# Agent Development Guide

This repo is a Bun + TypeScript CLI for recording, replaying, and repeating browser workflows. Treat
`AGENTS.md` as the operating manual for humans and AI agents working in this codebase.

## Core Principle

Web Seek is config-first.

When adding capability for a new website, state, board, or workflow, prefer creating or improving a
JSON site config in `configs/sites/` over hard-coding site-specific behavior in TypeScript. The code
should provide durable primitives; configs should describe how a specific site uses those primitives.

Good default:

```text
new public data source -> new/updated config JSON -> validated by shared schemas -> run with CLI
```

Avoid:

```text
new public data source -> one-off TypeScript branch keyed to that site's URL
```

## Project Map

- `apps/cli/src/cli.ts`: top-level interactive menu.
- `apps/cli/src/recorder.ts`: rrweb recording through Playwright.
- `apps/cli/src/replayer.ts`: temporary rrweb-player HTML generation.
- `apps/cli/src/config-author.ts`: browser-assisted config authoring and selector capture.
- `apps/cli/src/extractor.ts`: execution engine for site configs.
- `apps/cli/src/page-analysis.ts`: page candidate detection and highlighting.
- `libs/data-engine/src/schemas.ts`: source of truth for recording/config/result shapes.
- `libs/data-engine/src/*-store.ts`: Bun-native local file storage helpers.
- `configs/sites/`: reusable site workflow configs.
- `recordings/`: generated rrweb JSON recordings; do not commit generated sessions.
- `exports/`: generated extraction output; do not commit generated output.

## Development Workflow

Use Bun as the runtime and package runner.

```bash
bun install
bunx playwright install chromium
bun run check
bun run cli
```

Before finishing a code change, run:

```bash
bun run check
```

Use `bun run format` only when broad formatting is acceptable. Keep changes scoped.

## Coding Standards

- Keep TypeScript strict and typed. Do not use `any` to silence a design issue.
- Validate persisted JSON through `zod` schemas in `libs/data-engine/src/schemas.ts`.
- Use `Bun.file` and `Bun.write` for application file I/O unless a Node API is clearly better.
- Keep Playwright usage behind small helpers in `apps/cli/src/browser.ts` or focused modules.
- Keep rrweb event capture and rrweb-player replay compatible with local package assets first.
- Do not add large abstractions until at least two real workflows need the same shape.
- Do not mix site-specific selectors into shared runner logic.

## Config-First Rules

Site configs are the durable artifact for repeatable extraction. When a junior dev asks for
"scrape this site" or "get all licensed engineers from this state", interpret that as:

1. Identify the page pattern: search form, table, list/cards, infinite scroll, export, detail pages.
2. Create or update a config under `configs/sites/`.
3. Use existing step types where possible: `navigate`, `fill`, `select`, `click`,
   `wait-for-selector`, `human-checkpoint`, `download`, `extract-table`, `extract-list`,
   `screenshot`.
4. Add schema fields only when the existing primitives cannot represent a general pattern.
5. Keep operator-provided values as `{{input:name|Label}}` templates.
6. Add human checkpoints for CAPTCHA, terms screens, login/session renewal, or ambiguous UI states.

When changing the config schema:

- Update `siteExtractionConfigSchema` and exported types.
- Update any affected stores, CLI authoring flow, and extractor execution path.
- Update `README.md` and relevant example configs.
- Keep backward compatibility where reasonable. If not, document the migration.

## Government Data Guardrails

This project is intended for public, repeatable workflows, not bypassing controls.

- Do not bypass CAPTCHA, rate limits, paywalls, access controls, or authentication.
- Do not hide automation from a site.
- Prefer official exports or public APIs over DOM scraping when they provide the same data.
- Capture only data needed for the configured task.
- Add human-in-loop pauses when a human decision or site challenge is required.
- Make pagination bounded with `maxPages`.
- Preserve raw downloads beside normalized output when using export links.
- Assume state sites change often; configs should be easy to inspect and repair.

## AI-Assisted Work Guardrails

When using an AI agent, ask for a concrete artifact, not a vague scrape.

Good prompts:

- "Create a config for this public lookup page using table extraction and a CAPTCHA checkpoint."
- "Add a generic `scroll` step type to the schema and runner, then update README and checks."
- "Review this config for brittle selectors and suggest more stable alternatives."

Risky prompts that need clarification:

- "Scrape everything from this government site."
- "Bypass this CAPTCHA."
- "Make it work for every state."
- "Just hard-code the flow."

If the ask is vague, the agent should restate the intended config-first output and choose the
smallest useful implementation. If the request could violate access rules, add a human checkpoint or
stop and ask for a compliant path.

## Selector Quality

Prefer stable selectors in this order:

1. Public semantic attributes: `name`, `aria-label`, `role`.
2. Test attributes: `data-testid`, `data-test`, `data-cy`.
3. Form labels and nearby text, if represented by a stable selector.
4. Table/header structure.
5. Positional selectors like `nth-of-type` only when the page is simple and stable.

Avoid selectors tied to generated CSS class names, visual layout, or temporary session ids.

## Testing And Verification

For code changes:

- Run `bun run check`.
- Smoke-test module imports when touching recorder/replayer/extractor boundaries.
- For browser behavior, prefer a short manual headed Chrome run through `bun run cli`.

For config changes:

- Validate the JSON by loading it through `readSiteConfig`.
- Run with a small bounded page count first.
- Confirm row counts and key fields against the visible page.
- Keep generated recordings and exports out of commits.

## Commit Hygiene

- Keep changes focused by feature or config.
- Do not commit generated `recordings/*.json`, `exports/*.json`, `exports/*.csv`, screenshots, or
  downloads.
- Do not rewrite unrelated files just because a formatter can.
- Preserve user or coworker changes you did not make.

