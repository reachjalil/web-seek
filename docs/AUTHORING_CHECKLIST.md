# Browser QA Brief Authoring Checklist

Use this checklist when reviewing a browser QA brief before saving it under `qa-briefs/`. The brief
is guidance for a later automation agent, not a crawler, extractor, or guaranteed replay script.

## 1. Scope

- Confirm the start URL is the authorized page where QA review should begin.
- Write a summary that names the behavior under test, not just the website.
- Keep the brief focused on one user path or state family.
- Prefer official public flows and exports when the goal is data collection.
- Stop and add a checkpoint for CAPTCHA, login, terms, rate-limit, paywall, or access-control states.
- Do not capture credentials, tokens, API keys, or secret values.

## 2. Demonstrate

- Use `Browse` for normal site interaction.
- Use `Record` only while demonstrating actions the later QA automation may need.
- Keep recorded steps intentional: clicks, focus changes, fills/selects, keyboard actions, scrolls,
  and navigation.
- Remove or avoid accidental interactions that do not explain the QA path.
- Treat recorded selectors and rectangles as locator hints that may need repair.
- Use target metadata such as tag name, ARIA label, form name, role, and test id to choose better
  Playwright locators than a generated structural selector.
- Confirm visited URLs include the meaningful states reached during the demonstration.

## 3. Annotate

- Use `Annotate` to click important elements and describe what QA should verify.
- Use `Draw Region` for visual states such as banners, result groups, maps, charts, or empty states.
- Write assertions as expected outcomes: visible text, enabled/disabled controls, result changes,
  validation messages, URL/state changes, or absence of page errors.
- Add comments only for general guidance that does not fit a specific element, region, or assertion.
- Keep text samples concise; they help identify elements but should not become brittle assertions
  unless exact text is the requirement.

## 4. Checkpoints And Compliance

- Add a `checkpoint` when a human must make an allowed decision or when automation must stop.
- Use the `Check` control for CAPTCHA, login, terms, paywall, rate-limit, or access-control states.
- Do not ask the later agent to bypass CAPTCHA, authentication, rate limits, browser identity checks,
  paywalls, or terms screens.
- Do not hide automation from a site.
- Capture only what is needed for the QA task.
- Preserve the guardrail policy in the saved JSON.

## 5. Verify And Save

- Open JSON Preview before saving.
- Confirm the JSON schema is `web-seek.browser-qa-brief.v1`.
- Confirm the steps include the needed demonstration actions, element annotations, region
  annotations, assertion notes, comments, and checkpoints.
- Confirm `visitedUrls` and `startUrl` are correct.
- Confirm no credential-like values were saved.
- Save only when the brief is clear enough for an automation agent to convert into durable tests.

## Automation Agent Interpretation

- Convert `demo-*` steps into a Playwright path only when they are still necessary and stable. Use
  `demo-focus` mainly to understand keyboard/tab order or field activation.
- Convert `annotate-element`, `annotate-region`, and `assertion-note` into explicit expectations.
- Prefer role, label, name, test-id, and semantic locators over positional selectors.
- Use saved selectors, rectangles, scroll positions, and text samples as hints, not immutable
  commands.
- Add human checkpoints or stop conditions for blocked states.

## Legacy Extraction Checklist

For `Create extraction workflow (legacy)`, still review the old extraction concerns:

- Confirm the workflow is public/authorized and bounded.
- Record only setup actions needed before extraction.
- Pick one repeated record/table row shape and fields from inside it.
- Keep pagination bounded with `maxPages`.
- Run preview before saving unless explicitly waived.
- Confirm output artifacts go to `exports/` and generated files stay out of commits.

## After Save

- Confirm the QA brief was written under `qa-briefs/`.
- Run a small manual smoke authoring pass against a local fixture when changing overlay behavior.
- Do not commit generated `exports/`, `recordings/`, screenshots, or downloads.
- Commit only intentional QA briefs, reusable configs, and code/docs changes needed for the work.
