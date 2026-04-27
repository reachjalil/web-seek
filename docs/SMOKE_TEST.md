# Smoke Test Runbook

Use this after UX or extraction-runner changes.

## Automated Overlay Smoke

```bash
bun test apps/cli/src/overlay-smoke.test.ts
```

This test builds the overlay, injects it into `apps/overlay/test-fixtures/extraction-workflow.html`,
records a search action, picks repeated result cards, runs preview, and verifies that save emits a
complete draft.

## Full Local Check

```bash
bun run check
bun test
```

## Manual Headed Smoke

1. Run `bun run cli`.
2. Choose `Create extraction workflow`.
3. Use a simple public page or a local fixture served by any static server.
4. Enter config id, name, group, and URL.
5. In Chrome:
   - hover the toolbar buttons and confirm tooltips are visible,
   - record one setup action,
   - select repeated records or a table,
   - add or verify fields,
   - optionally select bounded pagination,
   - run preview,
   - save.
6. In the CLI, choose whether to run the smoke extraction.
7. Confirm the summary shows rows, pages, and JSON/CSV artifact paths.

## Failure Triage

- If the overlay does not appear, rebuild with `bun run overlay:build`.
- If preview has zero rows, check the repeated record selector and field selectors.
- If save is blocked, open Diagnostics and address required errors.
- If extraction fails after save, inspect the generated config order: navigate, setup actions,
  extraction, then bounded pagination.
