import type { BrowserFlowCaptureResult, BrowserFlowStep } from "@web-seek/data-engine";
import type { Page } from "playwright";

export async function textForSelector(
  page: Page,
  selector: string,
  attribute: string,
): Promise<string> {
  return page
    .locator(selector)
    .first()
    .evaluate((element, attr) => {
      if (attr === "text") {
        return element.textContent?.trim() ?? "";
      }
      if (attr === "html") {
        return element.innerHTML;
      }
      if (attr === "value" && "value" in element) {
        return String(element.value ?? "");
      }
      return element.getAttribute(attr) ?? "";
    }, attribute);
}

export function textMatches(
  actual: string,
  expected: string,
  mode: "contains" | "equals" | "matches",
): boolean {
  if (mode === "equals") {
    return actual === expected;
  }
  if (mode === "matches") {
    return new RegExp(expected).test(actual);
  }
  return actual.includes(expected);
}

export async function captureText(
  page: Page,
  step: Extract<BrowserFlowStep, { type: "capture-text" }>,
): Promise<BrowserFlowCaptureResult> {
  const actual = await textForSelector(page, step.selector, step.attribute);
  const capture: BrowserFlowCaptureResult = {
    stepId: step.id,
    stepType: "capture-text",
    selector: step.selector,
    attribute: step.attribute,
    value: actual,
    assertionMode: step.assertionMode,
    capturedAt: new Date().toISOString(),
  };

  if (step.assertionMode !== "none" && step.sampleValue) {
    return {
      ...capture,
      passed: textMatches(actual, step.sampleValue, step.assertionMode),
    };
  }

  return capture;
}

export async function assertText(
  page: Page,
  step: Extract<BrowserFlowStep, { type: "assert-text" }>,
): Promise<BrowserFlowCaptureResult> {
  const actual = await textForSelector(page, step.selector, "text");
  return {
    stepId: step.id,
    stepType: "assert-text",
    selector: step.selector,
    attribute: "text",
    value: actual,
    assertionMode: step.mode,
    passed: textMatches(actual, step.expectedText, step.mode),
    capturedAt: new Date().toISOString(),
  };
}
