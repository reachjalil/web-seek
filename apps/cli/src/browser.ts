import type { BrowserProfile } from "@web-seek/data-engine";
import type { Browser, BrowserContext, BrowserContextOptions, Page } from "playwright";
import { chromium } from "playwright";

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
