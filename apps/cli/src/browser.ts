import type { BrowserProfile } from "@web-seek/data-engine";
import type { Browser, BrowserContext, BrowserContextOptions, Page } from "playwright";
import { chromium } from "playwright";

type GotoOptions = NonNullable<Parameters<Page["goto"]>[1]>;

export interface RecoverableNavigationResult {
  requestedUrl: string;
  finalUrl: string;
  failed: boolean;
  correctedFrom?: string;
  warning?: string;
}

const NAVIGATION_TIMEOUT_MS = 45_000;

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function conciseNavigationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (message.split("\n")[0] ?? message).replace(/^goto:\s*/, "").trim();
}

export function suggestNavigationUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase().startsWith("wwww.")) {
      url.hostname = `www.${url.hostname.slice(5)}`;
      return url.toString();
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function recoveryHtml(startUrl: string, suggestedUrl: string | undefined, error: string): string {
  const suggestedLink = suggestedUrl
    ? `<p><a href="${htmlEscape(suggestedUrl)}">Open suggested URL: ${htmlEscape(suggestedUrl)}</a></p>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Web Seek navigation recovery</title>
    <style>
      body {
        margin: 0;
        background: #f8fafc;
        color: #0f172a;
        font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        max-width: 760px;
        margin: 64px auto;
        padding: 24px;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        background: #fff;
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.12);
      }
      code {
        padding: 2px 5px;
        border-radius: 4px;
        background: #e2e8f0;
      }
      a {
        color: #0f766e;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Could not open the start URL</h1>
      <p>Web Seek kept the authoring browser open so you can correct the URL and continue.</p>
      <p><strong>Requested:</strong> <code>${htmlEscape(startUrl)}</code></p>
      <p><strong>Error:</strong> ${htmlEscape(error)}</p>
      ${suggestedLink}
      <p>Use the address bar to navigate to the right page. The overlay will reattach after the page loads.</p>
    </main>
  </body>
</html>`;
}

export async function gotoWithRecovery(
  page: Page,
  url: string,
  options: { waitUntil?: GotoOptions["waitUntil"]; timeoutMs?: number } = {},
): Promise<RecoverableNavigationResult> {
  const waitUntil = options.waitUntil ?? "domcontentloaded";
  const timeout = options.timeoutMs ?? NAVIGATION_TIMEOUT_MS;

  try {
    await page.goto(url, { waitUntil, timeout });
    return {
      requestedUrl: url,
      finalUrl: page.url(),
      failed: false,
    };
  } catch (error) {
    const firstError = conciseNavigationError(error);
    const suggestedUrl = suggestNavigationUrl(url);

    if (suggestedUrl && suggestedUrl !== url) {
      await page.evaluate(() => window.stop()).catch(() => undefined);
      await page.waitForLoadState("domcontentloaded", { timeout: 1_000 }).catch(() => undefined);
      try {
        await page.goto(suggestedUrl, { waitUntil, timeout });
        return {
          requestedUrl: url,
          finalUrl: page.url(),
          failed: false,
          correctedFrom: url,
          warning: `Could not open ${url}. Opened suggested URL ${page.url()} instead. ${firstError}`,
        };
      } catch (suggestedError) {
        const secondError = conciseNavigationError(suggestedError);
        await page.goto("about:blank", { waitUntil: "domcontentloaded" }).catch(() => undefined);
        await page
          .setContent(recoveryHtml(url, suggestedUrl, secondError), {
            waitUntil: "domcontentloaded",
          })
          .catch(() => undefined);
        return {
          requestedUrl: url,
          finalUrl: url,
          failed: true,
          warning: `Could not open ${url} or suggested URL ${suggestedUrl}. ${secondError}`,
        };
      }
    }

    await page.goto("about:blank", { waitUntil: "domcontentloaded" }).catch(() => undefined);
    await page
      .setContent(recoveryHtml(url, suggestedUrl, firstError), { waitUntil: "domcontentloaded" })
      .catch(() => undefined);

    return {
      requestedUrl: url,
      finalUrl: url,
      failed: true,
      warning: `Could not open ${url}. ${firstError}`,
    };
  }
}

export async function launchChrome(profile?: Partial<BrowserProfile>): Promise<Browser> {
  const launchOptions = {
    headless: profile?.headless ?? false,
    slowMo: profile?.slowMoMs ?? 0,
  };

  try {
    return await chromium.launch({
      ...launchOptions,
      channel: "chrome",
    });
  } catch {
    return chromium.launch(launchOptions);
  }
}

export async function createContext(
  browser: Browser,
  profile?: Partial<BrowserProfile>,
): Promise<BrowserContext> {
  const options: BrowserContextOptions = {
    viewport: profile?.viewport ?? { width: 1440, height: 1000 },
    userAgent: profile?.userAgent,
    acceptDownloads: true,
  };

  return browser.newContext(options);
}

export async function openPage(
  url: string,
  profile?: Partial<BrowserProfile>,
): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const browser = await launchChrome(profile);
  const context = await createContext(browser, profile);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return { browser, context, page };
}
