import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type Browser, type Page, chromium } from "playwright";
import type { BridgeMessage, BridgeResponse, OverlayDraft } from "../../overlay/src/types";

const OVERLAY_DIR = join(import.meta.dir, "..", "..", "overlay");
const FIXTURE_PATH = join(OVERLAY_DIR, "test-fixtures", "extraction-workflow.html");

async function buildOverlay(): Promise<void> {
  const process = Bun.spawn(["bun", "--bun", "vite", "build"], {
    cwd: OVERLAY_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      ["Overlay build failed", stdout.trim(), stderr.trim()].filter(Boolean).join("\n"),
    );
  }
}

async function readOverlayAssets(): Promise<{ js: string; css: string }> {
  const assetsDirectory = join(OVERLAY_DIR, "dist", "assets");
  const files = await readdir(assetsDirectory);
  const jsFile = files.find((file) => file.endsWith(".js") && !file.endsWith(".map"));
  const cssFile = files.find((file) => file.endsWith(".css"));
  if (!jsFile || !cssFile) {
    throw new Error("Overlay build did not produce JS and CSS assets.");
  }

  return {
    js: await Bun.file(join(assetsDirectory, jsFile)).text(),
    css: await Bun.file(join(assetsDirectory, cssFile)).text(),
  };
}

function initialDraft(): OverlayDraft {
  return {
    id: "fixture-workflow",
    name: "Fixture Workflow",
    startUrl: "https://example.test/fixture",
    sourceUrl: "https://example.test/fixture",
    extractionKind: "list",
    fields: [],
    actions: [],
  };
}

async function mountOverlay(page: Page, messages: BridgeMessage[]): Promise<void> {
  const assets = await readOverlayAssets();
  await page.exposeFunction(
    "webSeekOverlayTestBridge",
    async (message: BridgeMessage): Promise<BridgeResponse> => {
      messages.push(message);
      return {
        ok: true,
        path: message.type === "save-config" ? "configs/sites/fixture-workflow.json" : undefined,
        recording: {
          id: "test-recording",
          startedAt: new Date(0).toISOString(),
          eventCount: messages.length,
          urlCount: 1,
          durationMs: 0,
        },
      };
    },
  );
  await page.evaluate(
    ({ css, draft }: { css: string; draft: OverlayDraft }) => {
      window.__WEB_SEEK_OVERLAY_CSS__ = css;
      window.__WEB_SEEK_OVERLAY_INIT__ = { draft };
      window.webSeekBridge = {
        send(message) {
          return window.webSeekOverlayTestBridge(message);
        },
      };
    },
    { css: assets.css, draft: initialDraft() },
  );
  await page.addScriptTag({ content: assets.js });
}

declare global {
  interface Window {
    webSeekOverlayTestBridge(message: BridgeMessage): Promise<BridgeResponse | undefined>;
  }
}

describe("overlay extraction workflow smoke", () => {
  let browser: Browser;

  beforeAll(async () => {
    await buildOverlay();
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  test("records setup, captures rows, previews, and saves", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const messages: BridgeMessage[] = [];
    await page.setContent(await Bun.file(FIXTURE_PATH).text(), { waitUntil: "domcontentloaded" });
    await mountOverlay(page, messages);

    await page
      .getByTitle("Open tools for repeated records, fields, and bounded pagination.")
      .hover();
    await expect(
      await page
        .getByText("Open tools for repeated records, fields, and bounded pagination.")
        .isVisible(),
    ).toBe(true);

    await page
      .getByTitle("Record setup actions such as search, filter, click, and scroll.")
      .click();
    await page.getByLabel("Search engineers").fill("engineer");
    await page.getByTestId("search-submit").click();
    await page.getByTitle("Stop recording setup actions and append them to the workflow.").click();

    await page
      .getByTitle("Pick the repeated records or table rows that become output rows.")
      .click();
    await page.getByTestId("result-card").first().click();
    await page.getByTitle("Extract current-page rows with the draft selectors.").click();
    await page.getByTitle("Validate and save the extraction workflow config.").click();

    const saveMessage = messages.findLast((message) => message.type === "save-config");
    expect(saveMessage?.type).toBe("save-config");
    expect(saveMessage?.draft?.actions.length).toBeGreaterThanOrEqual(2);
    expect(saveMessage?.draft?.fields.length).toBeGreaterThan(0);
    expect(saveMessage?.draft?.lastPreviewRowCount).toBe(2);

    await page.close();
  });
});
