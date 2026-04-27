import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Browser, chromium } from "playwright";
import { createBrowserQaBriefDraft, installBrowserQaBriefOverlay } from "./browser-qa-brief-author";

declare global {
  interface Window {
    webSeekQaBriefTestBridge(message: unknown): Promise<void>;
  }
}

function fixtureBrief() {
  return createBrowserQaBriefDraft({
    name: "Fixture QA Brief",
    summary: "Verify search interactions and result states.",
    startUrl: "https://example.test/fixture",
    viewport: { width: 900, height: 700 },
    userAgent: "test-agent",
    browserVersion: "test-version",
    date: new Date("2026-01-01T00:00:00.000Z"),
  });
}

describe("browser QA brief overlay", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  test("builds preview JSON from recorded and annotated steps", async () => {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const messages: unknown[] = [];
    await page.setContent(
      `
        <title>Fixture QA</title>
        <main>
          <label>Search <input name="q" aria-label="Search" /></label>
          <button data-testid="search-submit">Search</button>
          <section data-testid="result-card">Ada Lovelace Active</section>
          <div style="height: 1200px"></div>
        </main>
      `,
      { waitUntil: "domcontentloaded" },
    );
    await page.exposeFunction("webSeekQaBriefTestBridge", async (message: unknown) => {
      messages.push(message);
    });
    await page.evaluate(installBrowserQaBriefOverlay, {
      brief: fixtureBrief(),
      bridgeName: "webSeekQaBriefTestBridge",
    });

    await page.getByTitle("Start or stop capturing demonstration actions.").click();
    await page.getByLabel("Search").fill("engineer");
    await page.getByLabel("Search").press("Tab");
    await page.getByTestId("search-submit").click();

    await page
      .getByTitle("Toggle Browse or Annotate. Shift+Tab also toggles outside overlay inputs.")
      .click();
    page.once("dialog", async (dialog) => {
      await dialog.accept("Verify each result includes a visible status.");
    });
    await page.getByTestId("result-card").click();

    await page.getByTitle("Draw a visual region annotation.").click();
    page.once("dialog", async (dialog) => {
      await dialog.accept("Verify the result list stays visually aligned.");
    });
    await page.mouse.move(80, 220);
    await page.mouse.down();
    await page.mouse.move(360, 360);
    await page.mouse.up();

    page.once("dialog", async (dialog) => {
      await dialog.accept("Search results should update after submit.");
    });
    await page.getByTitle("Add an expected behavior or state to verify.").click();

    page.once("dialog", async (dialog) => {
      await dialog.accept("Stop if a CAPTCHA or access-control challenge appears.");
    });
    await page.getByTitle("Add a human-only or blocked-state checkpoint.").click();

    await page.getByTitle("Preview the exact brief JSON.").click();
    const preview = JSON.parse((await page.locator("#web-seek-qa-brief pre").textContent()) ?? "");
    const stepTypes = preview.steps.map((step: { type: string }) => step.type);

    expect(preview.schema).toBe("web-seek.browser-qa-brief.v1");
    expect(stepTypes).toContain("navigate");
    expect(stepTypes).toContain("demo-click");
    expect(stepTypes).toContain("demo-focus");
    expect(stepTypes).toContain("demo-input");
    expect(stepTypes).toContain("demo-keyboard");
    expect(stepTypes).toContain("annotate-element");
    expect(stepTypes).toContain("annotate-region");
    expect(stepTypes).toContain("assertion-note");
    expect(stepTypes).toContain("checkpoint");
    expect(
      preview.steps.find((step: { type: string }) => step.type === "demo-focus"),
    ).toMatchObject({
      target: {
        tagName: "input",
        name: "q",
      },
    });
    expect(preview.steps.at(-1)).toMatchObject({
      pageTitle: "Fixture QA",
      viewport: { width: 900, height: 700 },
    });
    expect(preview.visitedUrls).toContain("https://example.test/fixture");
    expect(messages.some((message) => (message as { type?: string }).type === "draft-change")).toBe(
      true,
    );

    await page.close();
  });

  test("Shift+Tab toggles modes only outside overlay text inputs", async () => {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.setContent("<main><button>Target</button></main>", {
      waitUntil: "domcontentloaded",
    });
    await page.exposeFunction("webSeekQaBriefTestBridge", async () => undefined);
    await page.evaluate(installBrowserQaBriefOverlay, {
      brief: fixtureBrief(),
      bridgeName: "webSeekQaBriefTestBridge",
    });

    await page.keyboard.press("Shift+Tab");
    expect(
      await page
        .getByTitle("Toggle Browse or Annotate. Shift+Tab also toggles outside overlay inputs.")
        .textContent(),
    ).toBe("Browse");

    await page.locator("#web-seek-qa-brief textarea").focus();
    await page.keyboard.press("Shift+Tab");
    expect(
      await page
        .getByTitle("Toggle Browse or Annotate. Shift+Tab also toggles outside overlay inputs.")
        .textContent(),
    ).toBe("Browse");

    await page.close();
  });
});
