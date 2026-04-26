# Web Seek User Guide

Web Seek is for authorized, bounded extraction workflows. The durable artifact is a JSON config in
`configs/sites/`; browser flows in `flows/` are for QA replay and debugging.

## Start The CLI

```bash
bun run cli
```

Choose:

- `Create extraction workflow` to build a reusable site config.
- `Run extraction workflow` to execute a saved config and write JSON/CSV output.
- `Create browser flow (QA debug)` when you need a replayable browser QA path.
- `Replay browser flow (QA debug)` to inspect a saved browser flow step by step.

## Create An Extraction Workflow

1. Enter a config id, display name, optional group/category, and start URL.
2. Chrome opens in headed mode and the Web Seek overlay appears.
3. Use the overlay workflow steps in order:
   - `Navigate`: record setup actions such as search fields, filters, submit clicks, and scrolling.
   - `Capture`: select repeated records or a table, then add fields inside each record.
   - `Loop`: pick a Next/load-more control only when the results continue across bounded pages.
   - `Verify`: run preview, inspect diagnostics and JSON, then save.
4. Save the workflow after preview passes, or explicitly choose `Save without preview` in Diagnostics.
5. When the CLI asks whether to run a smoke extraction, choose it when the current site state is safe
   to re-run immediately.

## Overlay Controls

- `Panel`: show or hide the editor panel.
- `Capture`: opens tools for repeated records, fields, and pagination.
- `Record`: starts or stops recording setup actions before extraction.
- `Output`: opens preview, generated JSON, workflow guide, and save actions.
- `Shape`: pick repeated records or a table.
- `Field`: add a field from inside the selected repeated record.
- `Next`: choose the bounded pagination control.
- `Actions`: record setup actions or stop the active recording segment.
- `Preview`: extract rows from the current page using the draft selectors.
- `Save`: validate and write the config to `configs/sites/`.

Hover over overlay controls for tooltips. Selector option lists show match counts for the current
page; use those counts to repair brittle selectors before saving.

## Run A Workflow

1. Choose `Run extraction workflow`.
2. Select a saved config from `configs/sites/`.
3. Provide any prompted input variables.
4. Let the headed browser run the bounded workflow.
5. Complete only permitted human checkpoints if the CLI pauses.
6. Review the CLI summary for row count, page count, warnings, and artifact paths.

Outputs are written to `exports/` unless the config specifies another output directory.

## Safety Rules

- Do not bypass CAPTCHA, paywalls, authentication, rate limits, access controls, or terms screens.
- Prefer official exports or public APIs when they provide the same data.
- Keep pagination bounded with `maxPages`.
- Capture only the fields needed for the configured task.
- Use manual checkpoints for human-only decisions or ambiguous site states.
