import {
  type BrowserFlow,
  type BrowserFlowCaptureResult,
  type BrowserFlowStep,
  browserFlowArtifactsDirectory,
  ensureDirectory,
} from "@web-seek/data-engine";
import type { Page } from "playwright";

export function artifactName(flow: BrowserFlow, step: BrowserFlowStep, extension: string): string {
  const timestamp = new Date()
    .toISOString()
    .replaceAll(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `${flow.id}-${step.id}-${timestamp}.${extension}`;
}

export async function captureRegion(
  page: Page,
  flow: BrowserFlow,
  step: Extract<BrowserFlowStep, { type: "capture-region" }>,
  timeout: number,
): Promise<BrowserFlowCaptureResult> {
  await ensureDirectory(browserFlowArtifactsDirectory());
  const screenshot = `${browserFlowArtifactsDirectory()}/${artifactName(flow, step, "png")}`;

  if (step.selector) {
    await page.locator(step.selector).first().screenshot({ path: screenshot, timeout });
  } else if (step.targetRect) {
    await page.screenshot({
      path: screenshot,
      clip: {
        x: step.targetRect.x,
        y: step.targetRect.y,
        width: Math.max(1, step.targetRect.width),
        height: Math.max(1, step.targetRect.height),
      },
    });
  }

  return {
    stepId: step.id,
    stepType: "capture-region",
    selector: step.selector,
    screenshot,
    assertionMode: step.assertionMode,
    capturedAt: new Date().toISOString(),
  };
}
