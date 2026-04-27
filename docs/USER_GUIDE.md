# Web Seek User Guide

Web Seek is primarily for authoring browser QA automation briefs. The durable artifact is a JSON
brief in `qa-briefs/` that a QA agent can later convert into Playwright-style tests. Extraction
configs in `configs/sites/` and browser flows in `flows/` remain available as legacy/debug paths.

## Start The CLI

```bash
bun run cli
```

Choose:

- `Create browser QA brief` to demonstrate interactions, annotate UI expectations, and save a QA
  automation handoff.
- `Create extraction workflow (legacy)` to build a reusable site config.
- `Run extraction workflow` to execute a saved config and write JSON/CSV output.
- `Create browser flow (QA debug)` when you need a replayable browser QA path.
- `Replay browser flow (QA debug)` to inspect a saved browser flow step by step.

## Create A Browser QA Brief

1. Enter a brief name, summary, and start URL.
2. Chrome opens in headed mode with the QA brief overlay.
3. Use `Browse` when you want the website to behave normally.
4. Use `Recording` while demonstrating clicks, focus changes, inputs/selects, keyboard actions,
   scrolls, and URL changes. These become `demo-*` guidance steps.
5. Use `Annotate` to click an element and describe what the future automation should verify.
6. Use `Draw Region` in Annotate mode to drag a visual area and describe the expected visual state.
7. Add assertion notes, comments, or checkpoints for expected behavior and human-only states.
8. Open `JSON Preview`, confirm it matches the intended handoff, then `Save Brief`.

The saved file uses the `web-seek.browser-qa-brief.v1` schema under `qa-briefs/`.

## QA Brief Overlay Controls

- `Browse/Edit`: toggle between normal browsing and annotation mode.
- `Record/Stop`: capture demonstrated actions while keeping the site usable.
- `Region`: draw a visual-region QA instruction.
- `Assert`: add an expected behavior or state to verify.
- `Check`: add a human-only or blocked-state checkpoint.
- `Comment`: add general automation guidance.
- `JSON`: preview the exact brief JSON that will be saved.
- `Save`: validate and write the brief to `qa-briefs/`.
- `Shift+Tab`: toggle Browse/Annotate, except while focus is inside overlay inputs.

Selectors, element rectangles, page titles, viewports, text samples, scroll positions, tag names,
ARIA labels, form names, roles, test ids, focus sources, and demonstrated values are hints for the
later automation agent. They are not guaranteed replay commands and should be repaired into durable
Playwright locators and assertions.

## QA Agent Interpretation Example

A saved brief fragment like this:

```json
{
  "type": "annotate-element",
  "target": {
    "selector": "[data-testid=\"result-card\"]",
    "testId": "result-card",
    "textSample": "Ada Lovelace Active"
  },
  "instruction": "Verify each result includes a visible status."
}
```

should become a durable test expectation, not a DOM scrape:

```ts
const results = page.getByTestId("result-card");
await expect(results.first()).toContainText(/active|inactive|pending/i);
```

A `demo-input` step with value `engineer` shows how the operator reached the state. The QA agent can
reuse that value when it is part of the scenario, parameterize it when broader coverage is needed, or
replace the generated selector with `getByLabel`, `getByRole`, or `getByTestId` when the target
metadata supports a better locator.

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
page; use those counts to repair brittle selectors before saving. Preview and extraction ignore
hidden filtered records, so row counts should match the visible result set.

## Option Reference

### Navigate

- Setup actions run after the start page opens and before extraction begins.
- `fill` writes text into an input or textarea.
- `select` chooses an option from a dropdown.
- `click` presses a button, link, or control.
- `scroll` restores a scroll position or scroll movement.
- `wait` pauses for a fixed number of milliseconds after an action that updates slowly.
- `checkpoint` pauses for an operator to confirm a permitted manual state.
- `optional` means a failed action records a warning instead of stopping the workflow.

### Capture

- The repeated shape is one record. The saved workflow repeats field extraction for every visible
  matching record.
- A field becomes one output column.
- `attribute` controls what is read:
  - `text`: visible text.
  - `href`: link URL.
  - `src`: image/media source.
  - `value`: form control value.
  - `html`: inner HTML, useful only when text is not enough.
  - `aria-label` or `title`: accessibility/metadata attributes.
- `transform` normalizes the captured value before output.
- `required` marks a field as important during preview diagnostics.

### Loop

- Pagination is optional. Add it only when results continue beyond the current page.
- `nextSelector` is the Next/load-more control to click.
- `maxPages` bounds the run. Lower it for smoke tests.
- `waitAfterMs` gives the page time to update after clicking Next.
- `stopWhenSelectorDisabled` avoids clicking disabled Next controls.

### Verify

- Preview reads the current visible page only.
- Save writes a reusable config; it does not run a full extraction by itself.
- Diagnostics errors block save. Diagnostics warnings are review items.
- The JSON tab shows both the generated saved config and an editable overlay draft for advanced
  repairs.

## Where Data Goes

- Saved QA brief: `qa-briefs/<brief-id>.json`.
- Overlay draft: temporary browser state until Save.
- Saved workflow config: `configs/sites/<workflow-id>.json`.
- Extraction run output: `exports/<workflow-id>-<timestamp>.json` and `.csv`.
- Downloads/screenshots from extraction: under `exports/`.
- Authoring recordings: under `recordings/`.
- Browser-flow QA debug artifacts: under `flows/`.

Commit reusable configs and docs. Do not commit generated exports, recordings, screenshots, or
downloads. Commit QA briefs only when they are intentional handoff artifacts.

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
- Do not capture credentials or secret values in QA briefs.
- Prefer official exports or public APIs when they provide the same data.
- Keep pagination bounded with `maxPages`.
- Capture only the fields needed for the configured task.
- Use manual checkpoints for human-only decisions or ambiguous site states.
