import { note } from "@clack/prompts";
import { assertText, captureRegion, captureText } from "@web-seek/browser-flow-capture";
import {
  hasExceededDuration,
  isAllowedUrl,
  normalizeAllowedOrigins,
} from "@web-seek/browser-flow-guardrails";
import { keyPressName } from "@web-seek/browser-flow-input";
import { replayPointerTrace } from "@web-seek/browser-flow-mouse";
import { installReplayControllerOverlay } from "@web-seek/browser-flow-replay-overlay";
import {
  type ReplayBridgeMessage,
  type ReplayLogEntry,
  type ReplayRunGuard,
  type ReplayState,
  createReplayState,
  executableStepsForFlow,
  replayLog,
  syncReplayStatePointers,
} from "@web-seek/browser-flow-replay-state";
import type { BrowserFlow, BrowserFlowStep } from "@web-seek/data-engine";
import { readBrowserFlow, saveBrowserFlowReplayResult } from "@web-seek/data-engine";
import type { Page } from "playwright";
import { createContext, gotoWithRecovery, launchChrome } from "./browser";

const BRIDGE_NAME = "webSeekBrowserFlowReplayBridge";

async function injectReplayOverlay(
  page: Page,
  flow: BrowserFlow,
  state: ReplayState,
): Promise<void> {
  await page
    .evaluate(installReplayControllerOverlay, {
      flowName: flow.name,
      bridgeName: BRIDGE_NAME,
      state,
    })
    .catch(() => undefined);
}

async function updateReplayOverlay(
  page: Page,
  flow: BrowserFlow,
  state: ReplayState,
): Promise<void> {
  await page
    .evaluate(
      ({ nextState }) => {
        const windowWithRender = window as Window & {
          webSeekReplayRender?: (state: ReplayState) => void;
        };
        windowWithRender.webSeekReplayRender?.(nextState);
      },
      { flowName: flow.name, bridgeName: BRIDGE_NAME, nextState: state },
    )
    .catch(() => undefined);
}

async function countdownPointerTrace(
  page: Page,
  flow: BrowserFlow,
  state: ReplayState,
): Promise<void> {
  for (let count = 3; count >= 1; count -= 1) {
    state.countdown = count;
    await updateReplayOverlay(page, flow, state);
    await page.waitForTimeout(1000);
  }
  state.countdown = undefined;
  await updateReplayOverlay(page, flow, state);
}

async function executeStep(
  page: Page,
  flow: BrowserFlow,
  step: BrowserFlowStep,
  allowedOrigins: Set<string>,
  guard: ReplayRunGuard,
): Promise<ReplayLogEntry> {
  if (hasExceededDuration(guard.startedAt, flow.limits.maxDurationMs)) {
    return replayLog(
      "fail",
      `Replay duration limit reached (${flow.limits.maxDurationMs} ms).`,
      step,
    );
  }

  if (!isAllowedUrl(page.url(), allowedOrigins)) {
    return replayLog(
      "fail",
      `Blocked replay because current URL is outside allowed origins: ${page.url()}`,
      step,
    );
  }

  const timeout =
    "timeoutMs" in step && step.timeoutMs ? step.timeoutMs : flow.limits.stepTimeoutMs;

  try {
    switch (step.type) {
      case "navigate": {
        if (!isAllowedUrl(step.url, allowedOrigins)) {
          return replayLog("fail", `Blocked navigation outside allowed origins: ${step.url}`, step);
        }
        await page.goto(step.url, { waitUntil: step.waitUntil, timeout });
        if (!isAllowedUrl(page.url(), allowedOrigins)) {
          return replayLog(
            "fail",
            `Blocked replay after navigation outside allowed origins: ${page.url()}`,
            step,
          );
        }
        return replayLog("pass", `Navigated to ${step.url}`, step);
      }
      case "click": {
        await page.locator(step.selector).first().click({ timeout });
        await page.waitForLoadState("domcontentloaded", { timeout: 2_000 }).catch(() => undefined);
        if (!isAllowedUrl(page.url(), allowedOrigins)) {
          return replayLog(
            "fail",
            `Blocked replay after click navigated outside allowed origins: ${page.url()}`,
            step,
          );
        }
        return replayLog("pass", `Clicked ${step.selector}`, step);
      }
      case "fill":
        await page.locator(step.selector).first().fill(step.value, { timeout });
        return replayLog("pass", `Filled ${step.selector}`, step);
      case "select":
        await page.locator(step.selector).first().selectOption(step.value, { timeout });
        return replayLog("pass", `Selected ${step.value} in ${step.selector}`, step);
      case "keyboard":
        if (step.focusedSelector) {
          await page.locator(step.focusedSelector).first().focus({ timeout });
        }
        for (const event of step.keySequence) {
          if (event.text && event.modifiers.length === 0) {
            await page.keyboard.type(event.text);
          } else {
            await page.keyboard.press(keyPressName(event));
          }
        }
        return replayLog("pass", "Played keyboard step", step);
      case "scroll":
        if (step.scrollContainer) {
          await page
            .locator(step.scrollContainer)
            .first()
            .evaluate(
              (element, delta) => {
                element.scrollBy(delta.x, delta.y);
              },
              { x: step.x, y: step.y },
            );
        } else {
          await page.evaluate((delta) => window.scrollBy(delta.x, delta.y), {
            x: step.x,
            y: step.y,
          });
        }
        await page.waitForTimeout(step.waitAfterMs);
        return replayLog("pass", `Scrolled ${step.x}, ${step.y}`, step);
      case "pointer-trace": {
        const result = await replayPointerTrace(page, step, {
          currentPointer: guard.lastPointerLocation,
        });
        guard.lastPointerLocation = result.lastPointerLocation ?? guard.lastPointerLocation;
        if (result.warning) {
          return replayLog("warn", result.warning, step);
        }
        return replayLog("pass", `Played pointer trace with ${step.points.length} points`, step);
      }
      case "wait":
        await page.waitForTimeout(step.durationMs);
        return replayLog("pass", `Waited ${step.durationMs} ms`, step);
      case "checkpoint":
        return replayLog("info", `Manual checkpoint: ${step.instruction}`, step);
      case "capture-text": {
        const capture = await captureText(page, step);
        guard.captures.push(capture);
        if (capture.passed !== undefined) {
          return replayLog(
            capture.passed ? "pass" : "fail",
            `Capture assertion ${capture.passed ? "passed" : "failed"} for ${step.selector}`,
            step,
          );
        }
        return replayLog("pass", `Captured text from ${step.selector}`, step);
      }
      case "capture-region":
        guard.captures.push(await captureRegion(page, flow, step, timeout));
        if (step.selector) {
          await page.locator(step.selector).first().waitFor({ timeout });
        }
        return replayLog("pass", "Capture region available for visual review", step);
      case "assert-text": {
        const capture = await assertText(page, step);
        guard.captures.push(capture);
        return replayLog(
          capture.passed ? "pass" : "fail",
          `Text assertion ${capture.passed ? "passed" : "failed"} for ${step.selector}`,
          step,
        );
      }
    }
  } catch (error) {
    return replayLog(
      "fail",
      error instanceof Error ? (error.message.split("\n")[0] ?? error.message) : String(error),
      step,
    );
  }
}

export async function replayBrowserFlow(path: string): Promise<string | undefined> {
  const flow = await readBrowserFlow(path);
  const allowedOrigins = normalizeAllowedOrigins(flow);
  const executableSteps = executableStepsForFlow(flow);
  const startedAt = new Date().toISOString();
  const guard: ReplayRunGuard = { startedAt: Date.now(), captures: [] };
  let replayResultPath: string | undefined;

  const state = createReplayState(flow, executableSteps);

  let resolveStopped!: () => void;
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });

  const browser = await launchChrome({ ...flow.browser, headless: false });
  const context = await createContext(browser, { ...flow.browser, headless: false });
  const page = await context.newPage();

  async function saveReplayResult(status: "passed" | "failed" | "stopped"): Promise<string> {
    if (replayResultPath) {
      return replayResultPath;
    }
    const stoppedAt = new Date().toISOString();
    replayResultPath = await saveBrowserFlowReplayResult({
      schema: "web-seek.browser-flow-replay.v1",
      id: `${flow.id}-${stoppedAt.replaceAll(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`,
      flowId: flow.id,
      flowName: flow.name,
      startedAt,
      stoppedAt,
      status,
      startUrl: flow.startUrl,
      finalUrl: page.url(),
      allowedOrigins: flow.allowedOrigins,
      captures: guard.captures,
      logs: state.logs.map((entry) => ({
        stepId: entry.stepId,
        stepType: entry.stepType,
        status: entry.status,
        message: entry.message,
        timestamp: entry.timestamp ?? stoppedAt,
      })),
    });
    state.logs.push(replayLog("info", `Replay result saved to ${replayResultPath}`));
    return replayResultPath;
  }

  function syncStepPointers(): void {
    syncReplayStatePointers(state, executableSteps);
  }

  async function update(): Promise<void> {
    syncStepPointers();
    await injectReplayOverlay(page, flow, state);
    await updateReplayOverlay(page, flow, state);
  }

  async function pauseWithLog(entry: ReplayLogEntry): Promise<void> {
    state.logs.push(entry);
    state.paused = true;
    state.running = false;
    await update();
  }

  async function executeCurrentStep(): Promise<void> {
    const step = executableSteps[state.index];
    if (!step) {
      state.running = false;
      state.paused = true;
      state.logs.push(replayLog("info", "Replay complete. Browser remains open."));
      await saveReplayResult("passed");
      await update();
      return;
    }

    syncStepPointers();
    await update();

    if (step.type === "pointer-trace") {
      await countdownPointerTrace(page, flow, state);
    }

    const result = await executeStep(page, flow, step, allowedOrigins, guard);
    state.logs.push(result);

    if (step.type === "checkpoint") {
      state.index += 1;
      await pauseWithLog(replayLog("info", "Paused at manual checkpoint.", step));
      return;
    }

    if (result.status === "fail" || result.status === "warn") {
      await pauseWithLog(replayLog("info", "Replay paused for review.", step));
      return;
    }

    state.index += 1;
    await update();
  }

  async function runAll(): Promise<void> {
    if (state.running) {
      return;
    }
    state.running = true;
    state.paused = false;
    await update();

    while (
      state.running &&
      !state.paused &&
      !state.stopped &&
      state.index < executableSteps.length
    ) {
      await executeCurrentStep();
    }

    if (!state.stopped && state.index >= executableSteps.length) {
      state.running = false;
      state.paused = true;
      state.logs.push(replayLog("info", "Replay complete. Browser remains open."));
      await saveReplayResult("passed");
      await update();
    }
  }

  await page.exposeBinding(BRIDGE_NAME, async (_source, message: ReplayBridgeMessage) => {
    if (message.type !== "command") {
      return;
    }

    switch (message.command) {
      case "run-all":
        void runAll();
        break;
      case "step-next":
        if (!state.running) {
          state.paused = true;
          await executeCurrentStep();
        }
        break;
      case "pause":
        state.paused = true;
        state.running = false;
        state.logs.push(replayLog("info", "Replay paused."));
        await update();
        break;
      case "resume":
        void runAll();
        break;
      case "restart":
        state.index = 0;
        state.paused = true;
        state.running = false;
        state.logs.push(replayLog("info", "Replay restarted."));
        await gotoWithRecovery(page, flow.startUrl);
        await injectReplayOverlay(page, flow, state);
        await update();
        break;
      case "skip-step":
        state.logs.push(replayLog("warn", `Skipped step ${state.index + 1}.`));
        state.index += 1;
        state.paused = true;
        state.running = false;
        await update();
        break;
      case "toggle-keep-open":
        state.keepOpen = !state.keepOpen;
        state.logs.push(
          replayLog(
            "info",
            state.keepOpen ? "Browser will stay open." : "Browser will close on stop.",
          ),
        );
        await update();
        break;
      case "stop":
        state.stopped = true;
        state.running = false;
        state.paused = true;
        state.logs.push(replayLog("info", "Replay stopped."));
        await saveReplayResult(
          state.logs.some((entry) => entry.status === "fail") ? "failed" : "stopped",
        );
        await update();
        if (!state.keepOpen) {
          await browser.close();
        }
        resolveStopped();
        break;
    }
  });

  page.on("domcontentloaded", () => {
    void injectReplayOverlay(page, flow, state);
  });
  page.on("close", () => {
    void saveReplayResult(
      state.logs.some((entry) => entry.status === "fail") ? "failed" : "stopped",
    ).finally(resolveStopped);
  });

  const navigation = await gotoWithRecovery(page, flow.startUrl);
  if (navigation.warning) {
    note(navigation.warning, "Navigation");
  }
  await injectReplayOverlay(page, flow, state);
  await update();
  note(
    "Use the replay controller in Chrome. Stop returns control to the CLI.",
    "Replay browser flow",
  );

  await stopped;
  return replayResultPath;
}
