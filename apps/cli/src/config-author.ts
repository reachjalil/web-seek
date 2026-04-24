import { confirm, note, select, spinner, text } from "@clack/prompts";
import {
  type ExtractionStep,
  type SiteExtractionConfig,
  safeSlug,
  saveSiteConfig,
} from "@web-seek/data-engine";
import Table from "cli-table3";
import type { Page } from "playwright";
import { createContext, launchChrome } from "./browser";
import {
  type PageCandidate,
  analyzeCurrentPage,
  captureElementSelection,
  clearCandidateHighlights,
  highlightCandidates,
} from "./page-analysis";
import { asString, unwrapPrompt } from "./prompt-utils";
import { waitForEnter } from "./terminal";

const DEFAULT_URL = "https://en.wikipedia.org/wiki/Special:Random";

function fieldName(value: string, fallback: string): string {
  const slug = safeSlug(value).replaceAll("-", "_");
  return slug.length > 0 ? slug : fallback;
}

function candidateLabel(candidate: PageCandidate): string {
  const detail =
    candidate.type === "table"
      ? `${candidate.details.rows ?? "?"} rows, ${candidate.details.columns ?? "?"} cols`
      : candidate.type === "list"
        ? `${candidate.details.itemCount ?? "?"} items`
        : candidate.selector;
  return `${candidate.id} - ${candidate.label} (${detail})`;
}

function printCandidates(candidates: PageCandidate[]): void {
  const table = new Table({
    head: ["ID", "Type", "Score", "Selector", "Details"],
    colWidths: [16, 13, 8, 42, 46],
    wordWrap: true,
  });

  for (const candidate of candidates.slice(0, 15)) {
    table.push([
      candidate.id,
      candidate.type,
      String(candidate.score),
      candidate.selector,
      JSON.stringify(candidate.details),
    ]);
  }

  console.log(table.toString());
}

async function selectCandidate(
  candidates: PageCandidate[],
  type: PageCandidate["type"],
  message: string,
): Promise<PageCandidate | undefined> {
  const typed = candidates.filter((candidate) => candidate.type === type);
  if (typed.length === 0) {
    return undefined;
  }

  const selectedId = await unwrapPrompt(
    select({
      message,
      options: typed.map((candidate) => ({
        value: candidate.id,
        label: candidateLabel(candidate).slice(0, 120),
      })),
    }),
  );

  return typed.find((candidate) => candidate.id === selectedId);
}

async function choosePagination(candidates: PageCandidate[]) {
  const pagination = candidates.filter((candidate) => candidate.type === "pagination");
  if (pagination.length === 0) {
    return undefined;
  }

  const selectedId = await unwrapPrompt(
    select({
      message: "Pagination detected. Which control should advance pages?",
      options: [
        { value: "none", label: "Do not paginate" },
        ...pagination.map((candidate) => ({
          value: candidate.id,
          label: candidateLabel(candidate).slice(0, 120),
        })),
      ],
    }),
  );

  if (selectedId === "none") {
    return undefined;
  }

  const candidate = pagination.find((item) => item.id === selectedId);
  return candidate
    ? {
        nextSelector: candidate.selector,
        maxPages: 25,
        waitAfterMs: 750,
        stopWhenSelectorDisabled: true,
      }
    : undefined;
}

async function buildTableStep(
  candidate: PageCandidate,
  candidates: PageCandidate[],
): Promise<ExtractionStep> {
  const headers = Array.isArray(candidate.details.headers) ? candidate.details.headers : [];
  const columns = Number(candidate.details.columns ?? headers.length);
  const fields = Array.from({ length: columns }).map((_, index) => {
    const header = asString(headers[index]);
    return {
      name: fieldName(header, `column_${index + 1}`),
      selector: `td:nth-of-type(${index + 1})`,
      attribute: "text" as const,
      required: false,
      transform: "trim" as const,
    };
  });

  return {
    id: "extract-table",
    type: "extract-table",
    label: candidate.label,
    optional: false,
    selector: candidate.selector,
    rowSelector: asString(candidate.details.rowSelector || "tbody tr"),
    fields,
    pagination: await choosePagination(candidates),
    outputKey: "rows",
  };
}

async function buildListStep(
  candidate: PageCandidate,
  candidates: PageCandidate[],
): Promise<ExtractionStep> {
  return {
    id: "extract-list",
    type: "extract-list",
    label: candidate.label,
    optional: false,
    itemSelector: asString(candidate.details.itemSelector || candidate.selector),
    fields: [
      {
        name: "text",
        selector: ":scope",
        attribute: "text",
        required: false,
        transform: "trim",
      },
    ],
    pagination: await choosePagination(candidates),
    outputKey: "items",
  };
}

function buildDownloadStep(candidate: PageCandidate): ExtractionStep {
  return {
    id: "download-export",
    type: "download",
    label: candidate.label,
    optional: false,
    selector: candidate.selector,
    timeoutMs: 30_000,
  };
}

async function collectManualFields(
  step: Extract<ExtractionStep, { type: "extract-list" }>,
  page: Page,
): Promise<ExtractionStep> {
  const fieldCountValue = await unwrapPrompt(
    text({
      message: "How many page-level fields should be captured?",
      defaultValue: "3",
      validate(value) {
        const count = Number(value);
        return Number.isInteger(count) && count > 0 && count <= 30
          ? undefined
          : "Enter a number from 1 to 30.";
      },
    }),
  );
  const fieldCount = Number(fieldCountValue);

  for (let index = 0; index < fieldCount; index += 1) {
    note(`Click field ${index + 1} in the browser window.`, "Selector capture");
    const selection = await captureElementSelection(page);
    const defaultName = fieldName(selection.text, `field_${index + 1}`);
    const name = await unwrapPrompt(
      text({
        message: `Name for ${selection.selector}`,
        defaultValue: defaultName,
      }),
    );

    step.fields.push({
      name,
      selector: selection.selector,
      attribute: "text",
      required: false,
      transform: "trim",
    });
  }

  return step;
}

export async function authorSiteConfig(): Promise<string> {
  const id = await unwrapPrompt(
    text({
      message: "Config id",
      placeholder: "colorado-professional-engineers",
      validate(value) {
        if (!value) {
          return "Config id is required.";
        }
        return value.trim().length > 0 ? undefined : "Config id is required.";
      },
    }),
  );
  const name = await unwrapPrompt(
    text({
      message: "Display name",
      placeholder: "Colorado Professional Engineers",
      validate(value) {
        if (!value) {
          return "Display name is required.";
        }
        return value.trim().length > 0 ? undefined : "Display name is required.";
      },
    }),
  );
  const jurisdiction = await unwrapPrompt(
    text({
      message: "Jurisdiction or state",
      placeholder: "Colorado",
    }),
  );
  const startUrl = await unwrapPrompt(
    text({
      message: "Start URL",
      defaultValue: DEFAULT_URL,
      validate(value) {
        if (!value) {
          return "Enter a valid URL.";
        }
        try {
          new URL(value);
          return undefined;
        } catch {
          return "Enter a valid URL.";
        }
      },
    }),
  );

  const browser = await launchChrome({ headless: false });
  const context = await createContext(browser, {
    headless: false,
    viewport: { width: 1440, height: 1000 },
  });

  try {
    const page = await context.newPage();
    const s = spinner();
    s.start("Opening target page");
    await page.goto(startUrl, { waitUntil: "domcontentloaded" });
    s.stop("Target page opened");

    await waitForEnter(
      "Navigate, search, or solve any challenge until the browser shows the data page. Press Enter here to analyze it.",
    );

    const analysis = await analyzeCurrentPage(page);
    await highlightCandidates(page, analysis.candidates);
    printCandidates(analysis.candidates);

    const mode = await unwrapPrompt(
      select({
        message: "What pattern should this config extract?",
        options: [
          { value: "table", label: "Structured table with optional pagination" },
          { value: "list", label: "Repeated list/cards, one text record per item" },
          { value: "export", label: "CSV/Excel/download link" },
          { value: "manual", label: "Manual page-level selectors" },
        ],
      }),
    );

    let extractionStep: ExtractionStep;
    if (mode === "table") {
      const candidate = await selectCandidate(
        analysis.candidates,
        "table",
        "Choose a table candidate",
      );
      if (!candidate) {
        throw new Error("No table candidates were detected.");
      }
      extractionStep = await buildTableStep(candidate, analysis.candidates);
    } else if (mode === "list") {
      const candidate = await selectCandidate(
        analysis.candidates,
        "list",
        "Choose a repeated list candidate",
      );
      if (!candidate) {
        throw new Error("No list candidates were detected.");
      }
      extractionStep = await buildListStep(candidate, analysis.candidates);
    } else if (mode === "export") {
      const candidate = await selectCandidate(
        analysis.candidates,
        "export",
        "Choose an export/download candidate",
      );
      if (!candidate) {
        throw new Error("No export candidates were detected.");
      }
      extractionStep = buildDownloadStep(candidate);
    } else {
      const manualStep: Extract<ExtractionStep, { type: "extract-list" }> = {
        id: "extract-manual-fields",
        type: "extract-list",
        label: "Manual page-level fields",
        optional: false,
        itemSelector: "html",
        fields: [],
        outputKey: "record",
      };
      extractionStep = await collectManualFields(manualStep, page);
    }

    const includeCheckpoint = await unwrapPrompt(
      confirm({
        message: "Add a human checkpoint before extraction?",
        initialValue: true,
      }),
    );

    const now = new Date().toISOString();
    const currentUrl = page.url();
    const steps: ExtractionStep[] = [
      {
        id: "open-start",
        type: "navigate",
        label: "Open start URL",
        optional: false,
        url: currentUrl,
        waitUntil: "domcontentloaded",
      },
    ];

    if (includeCheckpoint) {
      steps.push({
        id: "human-review",
        type: "human-checkpoint",
        label: "Human review",
        optional: false,
        reason: "Review the page, solve CAPTCHA if present, and confirm the data page is ready.",
      });
    }
    steps.push(extractionStep);

    const config: SiteExtractionConfig = {
      schema: "web-seek.site-config.v1",
      id: safeSlug(id),
      name,
      jurisdiction: jurisdiction || undefined,
      startUrl,
      description:
        "Authored from an interactive browser session. Edit selectors and input variables as the site changes.",
      tags: ["interactive", "government-data"],
      createdAt: now,
      updatedAt: now,
      browser: {
        headless: false,
        viewport: { width: 1440, height: 1000 },
        slowMoMs: 0,
      },
      humanInLoop: {
        enabled: true,
        pauseBeforeRun: false,
        challengeDetection: true,
        instructions: "Use the browser when the CLI requests human action.",
      },
      steps,
      output: {
        format: "both",
        directory: "exports",
      },
    };

    await clearCandidateHighlights(page);
    const path = await saveSiteConfig(config);
    return path;
  } finally {
    await context.close();
    await browser.close();
  }
}
