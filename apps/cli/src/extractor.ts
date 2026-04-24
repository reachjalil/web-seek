import { basename, join } from "node:path";
import {
  type ExtractionRow,
  type ExtractionRunResult,
  type ExtractionStep,
  type SiteExtractionConfig,
  ensureParentDirectory,
  exportsDirectory,
  extractionRunResultSchema,
  saveExtractionRun,
} from "@web-seek/data-engine";
import type { Page } from "playwright";
import { createContext, launchChrome } from "./browser";
import { waitForEnter } from "./terminal";

export interface ExtractionRunOptions {
  variables?: Record<string, string>;
}

export interface ExtractionRunSummary {
  result: ExtractionRunResult;
  artifacts: Awaited<ReturnType<typeof saveExtractionRun>>;
}

const INPUT_VARIABLE_PATTERN = /\{\{input:([a-zA-Z0-9_.-]+)(?:\|([^}]+))?\}\}/g;

export interface InputVariable {
  name: string;
  label: string;
}

export function collectInputVariables(config: SiteExtractionConfig): InputVariable[] {
  const variables = new Map<string, string>();
  const scan = (value: string): void => {
    for (const match of value.matchAll(INPUT_VARIABLE_PATTERN)) {
      const name = match[1] ?? "";
      const label = match[2] ?? name;
      if (name) {
        variables.set(name, label);
      }
    }
  };

  for (const step of config.steps) {
    if (step.type === "fill" || step.type === "select") {
      scan(step.value);
    }
    if (step.type === "navigate") {
      scan(step.url);
    }
  }

  return Array.from(variables.entries()).map(([name, label]) => ({ name, label }));
}

function resolveTemplate(value: string, variables: Record<string, string> | undefined): string {
  return value.replace(INPUT_VARIABLE_PATTERN, (_full, name: string) => variables?.[name] ?? "");
}

function applyTransform(value: string, transform: string | undefined): string | number {
  const trimmed = transform === undefined || transform === "trim" ? value.trim() : value;

  switch (transform) {
    case "number": {
      const normalized = trimmed.replace(/[$,%\s]/g, "");
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : trimmed;
    }
    case "date": {
      const timestamp = Date.parse(trimmed);
      return Number.isNaN(timestamp) ? trimmed : new Date(timestamp).toISOString();
    }
    case "uppercase":
      return trimmed.toUpperCase();
    case "lowercase":
      return trimmed.toLowerCase();
    case "license-status":
      return trimmed.replace(/\s+/g, " ").toUpperCase();
    default:
      return trimmed;
  }
}

async function detectHumanChallenge(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const bodyText = (document.body?.innerText ?? "").toLowerCase();
    if (
      /(captcha|verify you are human|human verification|cloudflare|access denied)/i.test(bodyText)
    ) {
      return "The page appears to be asking for human verification.";
    }

    const frames = Array.from(document.querySelectorAll("iframe"));
    const challengeFrame = frames.find((frame) =>
      /(recaptcha|hcaptcha|turnstile|captcha|challenge)/i.test(
        `${frame.getAttribute("src") ?? ""} ${frame.getAttribute("title") ?? ""}`,
      ),
    );

    return challengeFrame ? "A CAPTCHA or anti-bot iframe was detected." : undefined;
  });
}

async function pauseForChallengeIfNeeded(
  page: Page,
  config: SiteExtractionConfig,
  warnings: string[],
): Promise<void> {
  if (!config.humanInLoop.enabled || !config.humanInLoop.challengeDetection) {
    return;
  }

  const reason = await detectHumanChallenge(page);
  if (reason) {
    warnings.push(reason);
    await waitForEnter(`${reason} Solve it in the browser, then press Enter to continue.`);
  }
}

async function isDisabled(page: Page, selector: string): Promise<boolean> {
  return page.$eval(selector, (element) => {
    const htmlElement = element as HTMLElement;
    return (
      htmlElement.hasAttribute("disabled") ||
      htmlElement.getAttribute("aria-disabled") === "true" ||
      htmlElement.classList.contains("disabled")
    );
  });
}

async function clickNextPage(
  page: Page,
  selector: string,
  waitAfterMs: number,
  stopWhenDisabled: boolean,
): Promise<boolean> {
  const next = await page.$(selector);
  if (!next) {
    return false;
  }

  if (stopWhenDisabled && (await isDisabled(page, selector).catch(() => false))) {
    return false;
  }

  await next.click();
  await page.waitForTimeout(waitAfterMs);
  return true;
}

async function extractTableRows(
  page: Page,
  step: Extract<ExtractionStep, { type: "extract-table" }>,
) {
  return page.$eval(
    step.selector,
    (table, args) => {
      const readValue = (root: Element, selector: string, attribute: string): string => {
        const target = selector === ":scope" ? root : root.querySelector(selector);
        if (!target) {
          return "";
        }

        if (attribute === "text") {
          return target.textContent ?? "";
        }
        if (attribute === "html") {
          return target.innerHTML;
        }
        if (attribute === "value" && "value" in target) {
          return String((target as HTMLInputElement).value ?? "");
        }
        return target.getAttribute(attribute) ?? "";
      };

      const rows = Array.from(table.querySelectorAll(args.rowSelector));
      return rows.map((row) => {
        const result: Record<string, string> = {};
        for (const field of args.fields) {
          result[field.name] = readValue(row, field.selector, field.attribute);
        }
        return result;
      });
    },
    {
      rowSelector: step.rowSelector,
      fields: step.fields.map((field) => ({
        name: field.name,
        selector: field.selector,
        attribute: field.attribute,
      })),
    },
  );
}

async function extractListRows(
  page: Page,
  step: Extract<ExtractionStep, { type: "extract-list" }>,
) {
  return page.$$eval(
    step.itemSelector,
    (items, args) => {
      const readValue = (root: Element, selector: string, attribute: string): string => {
        const target = selector === ":scope" ? root : root.querySelector(selector);
        if (!target) {
          return "";
        }

        if (attribute === "text") {
          return target.textContent ?? "";
        }
        if (attribute === "html") {
          return target.innerHTML;
        }
        if (attribute === "value" && "value" in target) {
          return String((target as HTMLInputElement).value ?? "");
        }
        return target.getAttribute(attribute) ?? "";
      };

      return items.map((item) => {
        const result: Record<string, string> = {};
        for (const field of args.fields) {
          result[field.name] = readValue(item, field.selector, field.attribute);
        }
        return result;
      });
    },
    {
      fields: step.fields.map((field) => ({
        name: field.name,
        selector: field.selector,
        attribute: field.attribute,
      })),
    },
  );
}

function normalizeRows(
  rawRows: Record<string, string>[],
  step: Extract<ExtractionStep, { type: "extract-table" | "extract-list" }>,
): ExtractionRow[] {
  return rawRows
    .map((row) => {
      const normalized: ExtractionRow = {};
      for (const field of step.fields) {
        normalized[field.name] = applyTransform(row[field.name] ?? "", field.transform);
      }
      return normalized;
    })
    .filter((row) => Object.values(row).some((value) => String(value).trim().length > 0));
}

async function extractWithPagination(
  page: Page,
  config: SiteExtractionConfig,
  step: Extract<ExtractionStep, { type: "extract-table" | "extract-list" }>,
  warnings: string[],
): Promise<{ rows: ExtractionRow[]; pageCount: number }> {
  const rows: ExtractionRow[] = [];
  let pageCount = 0;

  while (true) {
    await pauseForChallengeIfNeeded(page, config, warnings);
    const rawRows =
      step.type === "extract-table"
        ? await extractTableRows(page, step)
        : await extractListRows(page, step);
    rows.push(...normalizeRows(rawRows, step));
    pageCount += 1;

    if (!step.pagination || pageCount >= step.pagination.maxPages) {
      break;
    }

    const didClick = await clickNextPage(
      page,
      step.pagination.nextSelector,
      step.pagination.waitAfterMs,
      step.pagination.stopWhenSelectorDisabled,
    );

    if (!didClick) {
      break;
    }
  }

  return { rows, pageCount };
}

async function saveScreenshot(
  page: Page,
  config: SiteExtractionConfig,
  name: string,
  fullPage: boolean,
) {
  const path = join(exportsDirectory(), "screenshots", `${config.id}-${name}-${Date.now()}.png`);
  await ensureParentDirectory(path);
  await page.screenshot({ path, fullPage });
  return path;
}

async function runDownload(
  page: Page,
  config: SiteExtractionConfig,
  step: Extract<ExtractionStep, { type: "download" }>,
) {
  const downloadPromise = page.waitForEvent("download", { timeout: step.timeoutMs });
  await page.click(step.selector, { timeout: step.timeoutMs });
  const download = await downloadPromise;
  const suggested = step.outputName ?? download.suggestedFilename();
  const path = join(
    exportsDirectory(),
    "downloads",
    `${config.id}-${Date.now()}-${basename(suggested)}`,
  );
  await ensureParentDirectory(path);
  await download.saveAs(path);
  return path;
}

async function executeStep(
  page: Page,
  config: SiteExtractionConfig,
  step: ExtractionStep,
  options: ExtractionRunOptions,
  result: ExtractionRunResult,
): Promise<void> {
  await pauseForChallengeIfNeeded(page, config, result.warnings);

  switch (step.type) {
    case "navigate":
      await page.goto(resolveTemplate(step.url, options.variables), { waitUntil: step.waitUntil });
      break;
    case "wait-for-selector":
      await page.waitForSelector(step.selector, { timeout: step.timeoutMs });
      break;
    case "click":
      await page.click(step.selector, { timeout: step.timeoutMs });
      break;
    case "fill":
      await page.fill(step.selector, resolveTemplate(step.value, options.variables), {
        timeout: step.timeoutMs,
      });
      break;
    case "select":
      await page.selectOption(step.selector, resolveTemplate(step.value, options.variables), {
        timeout: step.timeoutMs,
      });
      break;
    case "human-checkpoint":
      await waitForEnter(`${step.reason} Press Enter when the browser is ready to continue.`);
      break;
    case "screenshot":
      result.screenshots.push(await saveScreenshot(page, config, step.name, step.fullPage));
      break;
    case "scroll":
      await page.evaluate(
        ({ x, y, behavior }) => {
          window.scrollTo({ left: x, top: y, behavior });
        },
        { x: step.x, y: step.y, behavior: step.behavior },
      );
      await page.waitForTimeout(step.waitAfterMs);
      break;
    case "download":
      result.downloads.push(await runDownload(page, config, step));
      break;
    case "extract-table":
    case "extract-list": {
      const extracted = await extractWithPagination(page, config, step, result.warnings);
      result.rows.push(...extracted.rows);
      result.pageCount += extracted.pageCount;
      break;
    }
  }
}

export async function runExtractionConfig(
  config: SiteExtractionConfig,
  options: ExtractionRunOptions = {},
): Promise<ExtractionRunSummary> {
  const startedAt = new Date();
  const browser = await launchChrome(config.browser);
  const context = await createContext(browser, config.browser);

  try {
    const page = await context.newPage();

    if (config.humanInLoop.enabled && config.humanInLoop.pauseBeforeRun) {
      await waitForEnter("Browser is ready. Press Enter to start the configured workflow.");
    }

    const result: ExtractionRunResult = {
      schema: "web-seek.extraction-run.v1",
      configId: config.id,
      configName: config.name,
      startedAt: startedAt.toISOString(),
      finishedAt: startedAt.toISOString(),
      rows: [],
      downloads: [],
      screenshots: [],
      pageCount: 0,
      warnings: [],
    };

    for (const step of config.steps) {
      try {
        await executeStep(page, config, step, options, result);
      } catch (error) {
        if (step.optional) {
          result.warnings.push(
            `Optional step ${step.id} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        } else {
          throw error;
        }
      }
    }

    result.finishedAt = new Date().toISOString();
    const validated = extractionRunResultSchema.parse(result);
    const artifacts = await saveExtractionRun(config, validated);
    return { result: validated, artifacts };
  } finally {
    await context.close();
    await browser.close();
  }
}
