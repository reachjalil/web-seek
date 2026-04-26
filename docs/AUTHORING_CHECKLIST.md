# Extraction Workflow Authoring Checklist

Use this checklist when reviewing the flow step by step before saving a config.

## 1. Navigate

- Confirm the start URL is the public/authorized page where the workflow should begin.
- Record only setup actions needed before extraction: search input, filters, submit clicks, or scroll.
- Remove accidental clicks from the action list.
- Edit fill/select values if the captured value should be a template such as
  `{{input:lastName|Last name}}`.
- Mark fragile or site-dependent setup actions as optional only when a failed action should not stop
  the run.
- Insert a `wait` after actions that trigger delayed page updates.
- Insert a checkpoint when a human must approve terms, renew a session, or resolve an allowed manual
  state.

## 2. Capture

- Pick the repeated record, list item, card, or table row that represents one output row.
- Verify the highlighted matches correspond to real records, not layout containers.
- Add fields from inside the selected repeated record.
- Rename fields to stable output names.
- Mark fields required only when empty values should be treated as suspicious.
- Use selector options to compare primary and alternate selectors.
- Prefer selectors with stable attributes and sensible match counts.

## 3. Loop

- Add pagination only when data continues onto another page.
- Confirm the selector points to a Next or load-more control.
- Keep `maxPages` bounded. The default is `25`; lower it for smoke tests.
- Keep `stop when disabled` enabled for normal numbered pagination.
- Remember that overlay preview checks the current page only; the full runner handles pagination.

## 4. Verify

- Run preview before saving.
- Confirm preview row count against the visible page.
- Check required fields are populated in preview rows.
- Review Diagnostics for:
  - missing preview,
  - zero preview rows,
  - low selector confidence,
  - required fields empty in preview,
  - actions recorded after capture setup,
  - pagination configured with current-page-only preview.
- Inspect generated JSON if selectors or action order look wrong.
- Save only when the workflow is bounded and compliant.

## After Save

- Run the smoke extraction when the site state is safe to repeat immediately.
- Confirm JSON/CSV artifacts were written under `exports/`.
- Do not commit generated `exports/`, `recordings/`, screenshots, or downloads.
- Commit only the reusable config and code/docs changes needed for the workflow.
