import type { BrowserFlowStep } from "@web-seek/data-engine";

export type BrowserFlowStepDetail = {
  label: string;
  value: string;
};

export type BrowserFlowCaptureOrAssertionStep = Extract<
  BrowserFlowStep,
  { type: "capture-text" | "capture-region" | "assert-text" }
>;

function formatOptional(value: string | number | boolean | undefined): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  return String(value);
}

function addDetail(
  details: BrowserFlowStepDetail[],
  label: string,
  value: string | number | boolean | undefined,
): void {
  const formatted = formatOptional(value);
  if (formatted !== undefined) {
    details.push({ label, value: formatted });
  }
}

export function selectorForBrowserFlowStep(step: BrowserFlowStep | undefined): string | undefined {
  if (!step) {
    return undefined;
  }
  if ("selector" in step && typeof step.selector === "string") {
    return step.selector;
  }
  if (step.type === "keyboard") {
    return step.focusedSelector;
  }
  if (step.type === "pointer-trace") {
    return step.endTargetSelector ?? step.startTargetSelector;
  }
  return undefined;
}

export function browserFlowStepSummary(step: BrowserFlowStep | undefined): string {
  if (!step) {
    return "None";
  }
  const selector = selectorForBrowserFlowStep(step);
  if (selector) {
    return selector;
  }
  switch (step.type) {
    case "navigate":
      return step.url;
    case "scroll":
      return `${step.x}, ${step.y}`;
    case "pointer-trace":
      return `${step.points.length} points`;
    case "wait":
      return `${step.durationMs} ms`;
    case "checkpoint":
      return step.instruction;
    default:
      return step.type;
  }
}

export function isBrowserFlowCaptureOrAssertionStep(
  step: BrowserFlowStep,
): step is BrowserFlowCaptureOrAssertionStep {
  return (
    step.type === "capture-text" || step.type === "capture-region" || step.type === "assert-text"
  );
}

export function browserFlowStepDetails(step: BrowserFlowStep): BrowserFlowStepDetail[] {
  const details: BrowserFlowStepDetail[] = [
    { label: "Type", value: step.type },
    { label: "ID", value: step.id },
  ];
  if (step.type !== "checkpoint") {
    addDetail(details, "Label", step.label);
  }
  addDetail(details, "Timestamp", step.timestamp);
  addDetail(details, "Optional", step.optional);

  switch (step.type) {
    case "navigate":
      addDetail(details, "URL", step.url);
      addDetail(details, "Wait until", step.waitUntil);
      break;
    case "click":
      addDetail(details, "Selector", step.selector);
      addDetail(details, "URL before", step.urlBefore);
      addDetail(details, "URL after", step.urlAfter);
      break;
    case "fill":
    case "select":
      addDetail(details, "Selector", step.selector);
      addDetail(details, "Value", step.value);
      addDetail(details, "Input type", step.inputType);
      break;
    case "keyboard":
      addDetail(details, "Focused selector", step.focusedSelector);
      addDetail(details, "Key events", step.keySequence.length);
      break;
    case "scroll":
      addDetail(details, "X", step.x);
      addDetail(details, "Y", step.y);
      addDetail(details, "Scroll container", step.scrollContainer);
      addDetail(details, "Wait after", `${step.waitAfterMs} ms`);
      break;
    case "pointer-trace":
      addDetail(details, "Start target", step.startTargetSelector);
      addDetail(details, "End target", step.endTargetSelector);
      addDetail(details, "Pointer points", step.points.length);
      addDetail(details, "Keyboard events", step.keyboardEvents.length);
      break;
    case "wait":
      addDetail(details, "Duration", `${step.durationMs} ms`);
      addDetail(details, "Reason", step.reason);
      break;
    case "checkpoint":
      addDetail(details, "Label", step.label);
      addDetail(details, "Instruction", step.instruction);
      addDetail(details, "Screenshot", step.screenshot);
      break;
    case "capture-text":
      addDetail(details, "Selector", step.selector);
      addDetail(details, "Attribute", step.attribute);
      addDetail(details, "Assertion mode", step.assertionMode);
      addDetail(details, "Sample", step.sampleValue);
      break;
    case "capture-region":
      addDetail(details, "Selector", step.selector);
      addDetail(details, "Assertion mode", step.assertionMode);
      addDetail(details, "Screenshot", step.screenshot);
      break;
    case "assert-text":
      addDetail(details, "Selector", step.selector);
      addDetail(details, "Expected text", step.expectedText);
      addDetail(details, "Mode", step.mode);
      break;
  }

  return details;
}
