import { note, text } from "@clack/prompts";
import {
  appendBrowserFlowStep,
  createBrowserFlowDraft,
  prepareFlowForSave,
  updateStepById,
  validateBrowserFlowStartUrl,
} from "@web-seek/browser-flow-authoring";
import {
  type RecorderBridgeMessage,
  installFlowRecorderOverlay,
} from "@web-seek/browser-flow-recorder-overlay";
import { type BrowserFlow, saveBrowserFlow } from "@web-seek/data-engine";
import type { Page } from "playwright";
import { createContext, gotoWithRecovery, launchChrome } from "./browser";
import { unwrapPrompt } from "./prompt-utils";

const BRIDGE_NAME = "webSeekBrowserFlowBridge";
const DEFAULT_START_URL = "http://localhost:3000";

async function injectRecorder(page: Page, flow: BrowserFlow): Promise<void> {
  await page
    .evaluate(installFlowRecorderOverlay, { flow, bridgeName: BRIDGE_NAME })
    .catch(() => undefined);
}

export async function authorBrowserFlow(): Promise<string> {
  const name = await unwrapPrompt(
    text({
      message: "Flow name",
      placeholder: "Checkout smoke test",
      validate(value) {
        return value?.trim().length ? undefined : "Enter a flow name.";
      },
    }),
  );

  const startUrl = await unwrapPrompt(
    text({
      message: "Start URL",
      defaultValue: DEFAULT_START_URL,
      validate: validateBrowserFlowStartUrl,
    }),
  );

  let flow = createBrowserFlowDraft({ name, startUrl });
  let resolveSaved!: (path: string) => void;
  let rejectSaved!: (error: Error) => void;
  const saved = new Promise<string>((resolve, reject) => {
    resolveSaved = resolve;
    rejectSaved = reject;
  });

  const browser = await launchChrome({ ...flow.browser, headless: false });
  const context = await createContext(browser, { ...flow.browser, headless: false });
  const page = await context.newPage();

  await page.exposeBinding(BRIDGE_NAME, async (_source, message: RecorderBridgeMessage) => {
    if (message.type === "draft-change") {
      flow = appendBrowserFlowStep(flow, message.step);
      return;
    }

    if (message.type === "step-update") {
      flow = updateStepById(flow, message.step.id, () => message.step);
      return;
    }

    if (message.type === "save-flow") {
      try {
        flow = prepareFlowForSave({
          overlayFlow: message.flow,
          currentFlow: flow,
        });
        const path = await saveBrowserFlow(flow);
        resolveSaved(path);
      } catch (error) {
        rejectSaved(error instanceof Error ? error : new Error(String(error)));
      }
    }
  });

  page.on("domcontentloaded", () => {
    void injectRecorder(page, flow);
  });
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) {
      return;
    }
    const lastClick = flow.steps.findLast((step) => step.type === "click" && !step.urlAfter);
    if (!lastClick) {
      return;
    }
    flow = updateStepById(flow, lastClick.id, (step) =>
      step.type === "click" ? { ...step, urlAfter: page.url() } : step,
    );
  });
  page.on("close", () => {
    rejectSaved(new Error("Browser flow authoring closed before saving."));
  });
  browser.on("disconnected", () => {
    rejectSaved(new Error("Browser flow authoring ended before saving."));
  });

  const navigation = await gotoWithRecovery(page, startUrl);
  if (navigation.warning) {
    note(navigation.warning, "Navigation");
  }
  await injectRecorder(page, flow);

  note(
    "Use the recorder dock in Chrome. Press Option+Shift+S to finish keyboard steps or pointer traces, then Save Flow.",
    "Create browser flow",
  );

  try {
    const path = await saved;
    await browser.close();
    return path;
  } catch (error) {
    await browser.close();
    throw error;
  }
}
