import { keyPressName } from "@web-seek/browser-flow-input";
import type { BrowserFlowPointerPoint, BrowserFlowPointerTraceStep } from "@web-seek/data-engine";
import type { Page } from "playwright";

export interface ViewportSize {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PointerTraceReplayOptions {
  currentPointer?: { x: number; y: number };
}

export interface PointerTraceReplayResult {
  warning?: string;
  lastPointerLocation?: { x: number; y: number };
}

export function viewportChangeRatio(recorded: ViewportSize, current: ViewportSize): number {
  const widthDelta = Math.abs(current.width - recorded.width) / recorded.width;
  const heightDelta = Math.abs(current.height - recorded.height) / recorded.height;
  return Math.max(widthDelta, heightDelta);
}

export function shouldPauseForViewportChange(
  recorded: ViewportSize,
  current: ViewportSize,
  threshold = 0.35,
): boolean {
  return viewportChangeRatio(recorded, current) > threshold;
}

export function scalePointerPoint(
  point: { x: number; y: number },
  viewport: ViewportSize,
): { x: number; y: number } {
  return {
    x: point.x * viewport.width,
    y: point.y * viewport.height,
  };
}

export function clampPointToRect(
  point: { x: number; y: number },
  rect: Rect,
): { x: number; y: number } {
  return {
    x: Math.min(rect.x + rect.width, Math.max(rect.x, point.x)),
    y: Math.min(rect.y + rect.height, Math.max(rect.y, point.y)),
  };
}

export async function replayPointerTrace(
  page: Page,
  step: BrowserFlowPointerTraceStep,
  options: PointerTraceReplayOptions = {},
): Promise<PointerTraceReplayResult> {
  const viewport = page.viewportSize();
  if (!viewport) {
    return { warning: "Viewport unavailable for pointer trace." };
  }

  if (shouldPauseForViewportChange(step.viewport, viewport)) {
    return { warning: "Viewport changed heavily; pointer trace paused before replay." };
  }

  let targetBox: Rect | null = null;
  if (step.endTargetSelector) {
    targetBox = await page
      .locator(step.endTargetSelector)
      .first()
      .boundingBox()
      .catch(() => null);
  }

  const firstPoint = step.points[0];
  if (firstPoint && options.currentPointer) {
    const current = scalePointerPoint(options.currentPointer, viewport);
    const first =
      targetBox && step.points.length === 1
        ? clampPointToRect(scalePointerPoint(firstPoint, viewport), targetBox)
        : scalePointerPoint(firstPoint, viewport);
    await page.mouse.move(current.x, current.y);
    await page.mouse.move(first.x, first.y, { steps: 8 });
  }

  let previousTime = firstPoint?.relativeTimeMs ?? 0;
  const pointsToReplay: BrowserFlowPointerPoint[] =
    firstPoint && options.currentPointer ? step.points.slice(1) : step.points;
  for (const [index, point] of pointsToReplay.entries()) {
    let next = scalePointerPoint(point, viewport);

    if (targetBox && index === pointsToReplay.length - 1) {
      next = clampPointToRect(next, targetBox);
    }

    const delay = Math.max(0, point.relativeTimeMs - previousTime);
    if (delay > 0) {
      await page.waitForTimeout(Math.min(delay, 250));
    }
    await page.mouse.move(next.x, next.y, { steps: 2 });
    previousTime = point.relativeTimeMs;
  }

  for (const event of step.keyboardEvents) {
    await page.keyboard.press(keyPressName(event));
  }

  return { lastPointerLocation: step.lastPointerLocation ?? step.points.at(-1) };
}
