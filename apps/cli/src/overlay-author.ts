import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { note, spinner, text } from "@clack/prompts";
import {
  type ExtractionStep,
  type FieldSelector,
  type PaginationConfig,
  type SelectorMeta,
  type SiteExtractionConfig,
  resolveWorkspacePath,
  safeSlug,
  saveSiteConfig,
} from "@web-seek/data-engine";
import type { Page } from "playwright";
import { createContext, launchChrome } from "./browser";
import { unwrapPrompt } from "./prompt-utils";
import {
  type BrowserRecordingSession,
  type BrowserRecordingStatus,
  type RecordingResult,
  startBrowserRecording,
} from "./recorder";
import { waitForEnter } from "./terminal";

const DEFAULT_URL = "https://en.wikipedia.org/wiki/Special:Random";
const BRIDGE_NAME = "webSeekOverlayBridge";

interface OverlayDraftField {
  id: string;
  name: string;
  selector: string;
  attribute: string;
  required: boolean;
  transform?: FieldSelector["transform"];
  selectorMeta?: SelectorMeta;
}

interface OverlayDraft {
  id: string;
  name: string;
  jurisdiction?: string;
  startUrl: string;
  sourceUrl: string;
  extractionKind: "list" | "table";
  itemSelector?: string;
  tableSelector?: string;
  rowSelector?: string;
  fields: OverlayDraftField[];
  pagination?: PaginationConfig & { selectorMeta?: SelectorMeta };
  lastPreviewRowCount?: number;
  notes?: string;
}

interface OverlayBridgeMessage {
  type: "ready" | "draft-change" | "save-config" | "close-overlay" | "recording-status";
  draft?: OverlayDraft;
}

interface OverlayAssets {
  js: string;
  css: string;
}

interface SavedRecordingMetadata {
  id: string;
  path: string;
  eventCount: number;
}

function fieldName(value: string, fallback: string): string {
  const slug = safeSlug(value).replaceAll("-", "_");
  return slug.length > 0 ? slug : fallback;
}

function normalizeOptionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function validateUrl(value: string | undefined): string | undefined {
  if (!value) {
    return "Enter a valid URL.";
  }
  try {
    new URL(value);
    return undefined;
  } catch {
    return "Enter a valid URL.";
  }
}

async function runOverlayBuild(overlayDirectory: string): Promise<void> {
  const process = Bun.spawn(["bun", "run", "build"], {
    cwd: overlayDirectory,
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
      ["Overlay build failed. Run `bun install` and try again.", stdout.trim(), stderr.trim()]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

async function readOverlayAssets(): Promise<OverlayAssets> {
  const overlayDirectory = resolveWorkspacePath("apps", "overlay");
  const s = spinner();
  s.start("Building overlay");
  try {
    await runOverlayBuild(overlayDirectory);
    s.stop("Overlay built");
  } catch (error) {
    s.stop("Overlay build failed");
    throw error;
  }

  const assetsDirectory = join(overlayDirectory, "dist", "assets");
  const files = await readdir(assetsDirectory);
  const jsFile = files.find((file) => file.endsWith(".js") && !file.endsWith(".map"));
  const cssFile = files.find((file) => file.endsWith(".css"));

  if (!jsFile || !cssFile) {
    throw new Error("Overlay build did not produce injectable JS and CSS assets.");
  }

  const [js, css] = await Promise.all([
    Bun.file(join(assetsDirectory, jsFile)).text(),
    Bun.file(join(assetsDirectory, cssFile)).text(),
  ]);

  return { js, css };
}

function normalizeFields(fields: OverlayDraftField[]): FieldSelector[] {
  return fields.map((field, index) => ({
    name: fieldName(field.name, `field_${index + 1}`),
    selector: field.selector,
    attribute: field.attribute || "text",
    required: field.required,
    transform: field.transform,
    selectorMeta: field.selectorMeta,
  }));
}

function normalizePagination(
  pagination: OverlayDraft["pagination"] | undefined,
): PaginationConfig | undefined {
  if (!pagination?.nextSelector) {
    return undefined;
  }

  return {
    nextSelector: pagination.nextSelector,
    maxPages:
      Number.isInteger(pagination.maxPages) && pagination.maxPages > 0 ? pagination.maxPages : 25,
    waitAfterMs:
      Number.isInteger(pagination.waitAfterMs) && pagination.waitAfterMs >= 0
        ? pagination.waitAfterMs
        : 750,
    stopWhenSelectorDisabled: pagination.stopWhenSelectorDisabled ?? true,
  };
}

function buildExtractionStep(draft: OverlayDraft): ExtractionStep {
  if (!draft.itemSelector) {
    throw new Error("Select a repeated item before saving.");
  }
  if (draft.fields.length === 0) {
    throw new Error("Select at least one field before saving.");
  }

  const fields = normalizeFields(draft.fields);
  const pagination = normalizePagination(draft.pagination);

  if (draft.extractionKind === "table" && draft.tableSelector && draft.rowSelector) {
    return {
      id: "extract-overlay-table",
      type: "extract-table",
      label: "Overlay table extraction",
      optional: false,
      selector: draft.tableSelector,
      rowSelector: draft.rowSelector,
      fields,
      pagination,
      outputKey: "rows",
    };
  }

  return {
    id: "extract-overlay-list",
    type: "extract-list",
    label: "Overlay list extraction",
    optional: false,
    itemSelector: draft.itemSelector,
    fields,
    pagination,
    outputKey: "items",
  };
}

function buildConfigFromDraft(
  draft: OverlayDraft,
  currentUrl: string,
  recording?: SavedRecordingMetadata,
): SiteExtractionConfig {
  const now = new Date().toISOString();
  const sourceUrl = draft.sourceUrl || currentUrl;
  const extractionStep = buildExtractionStep(draft);

  return {
    schema: "web-seek.site-config.v1",
    id: safeSlug(draft.id),
    name: draft.name.trim(),
    jurisdiction: normalizeOptionalText(draft.jurisdiction ?? ""),
    startUrl: draft.startUrl,
    description:
      "Authored with the browser overlay. Edit selectors and input variables as the site changes.",
    tags: ["overlay", "interactive", "government-data"],
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
    authoring: {
      sourceUrl,
      createdWith: "overlay",
      lastPreviewRowCount: draft.lastPreviewRowCount,
      recordingId: recording?.id,
      recordingPath: recording?.path,
      recordingEventCount: recording?.eventCount,
      notes: normalizeOptionalText(draft.notes ?? ""),
    },
    steps: [
      {
        id: "open-authored-page",
        type: "navigate",
        label: "Open authored page",
        optional: false,
        url: sourceUrl,
        waitUntil: "domcontentloaded",
      },
      {
        id: "human-review",
        type: "human-checkpoint",
        label: "Human review",
        optional: false,
        reason: "Review the page, solve CAPTCHA if present, and confirm the data page is ready.",
      },
      extractionStep,
    ],
    output: {
      format: "both",
      directory: "exports",
    },
  };
}

async function injectOverlay(
  page: Page,
  assets: OverlayAssets,
  initialDraft: OverlayDraft,
  recording: BrowserRecordingSession,
  recordingMetadata: {
    userAgent?: string;
    viewport?: { width: number; height: number };
  },
): Promise<string> {
  let latestDraft = initialDraft;
  let savedRecording: RecordingResult | undefined;
  let resolveSaved: (path: string) => void = () => undefined;
  let rejectSaved: (error: Error) => void = () => undefined;
  const saved = new Promise<string>((resolve, reject) => {
    resolveSaved = resolve;
    rejectSaved = reject;
  });

  const recordingStatus = (): BrowserRecordingStatus & { path?: string } => ({
    ...recording.status(),
    path: savedRecording?.path,
  });

  const saveRecordingOnce = async (
    draft: OverlayDraft,
    tags: string[],
  ): Promise<RecordingResult> => {
    if (!savedRecording) {
      savedRecording = await recording.save({
        targetUrl: draft.startUrl,
        tags,
        notes: `Overlay authoring session for ${draft.name}`,
        userAgent: recordingMetadata.userAgent,
        viewport: recordingMetadata.viewport,
      });
    }
    return savedRecording;
  };

  await page.exposeBinding(
    BRIDGE_NAME,
    async (source: { page: Page }, message: OverlayBridgeMessage) => {
      if (message.draft) {
        latestDraft = message.draft;
      }

      if (message.type === "recording-status") {
        return { ok: true, recording: recordingStatus() };
      }

      if (message.type === "close-overlay") {
        await saveRecordingOnce(latestDraft, ["overlay-authoring", "abandoned"]);
        rejectSaved(new Error("Overlay authoring closed without saving."));
        return { ok: true, recording: recordingStatus() };
      }

      if (message.type !== "save-config") {
        return { ok: true, recording: recordingStatus() };
      }

      try {
        const draft = message.draft ?? latestDraft;
        const savedAuthoringRecording = await saveRecordingOnce(draft, [
          "overlay-authoring",
          "config-authoring",
          draft.id,
        ]);
        const config = buildConfigFromDraft(draft, source.page.url(), {
          id: savedAuthoringRecording.recording.id,
          path: savedAuthoringRecording.path,
          eventCount: savedAuthoringRecording.recording.eventCount,
        });
        const path = await saveSiteConfig(config);
        resolveSaved(path);
        return { ok: true, path, recording: recordingStatus() };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  await page.evaluate(
    ({ bridgeName, css, draft, initialRecording }) => {
      const bridge = (window as unknown as Record<string, (message: unknown) => Promise<unknown>>)[
        bridgeName
      ];
      window.__WEB_SEEK_OVERLAY_CSS__ = css;
      window.__WEB_SEEK_OVERLAY_INIT__ = { draft, recording: initialRecording };
      window.webSeekBridge = {
        send(message) {
          return bridge(message) as Promise<{
            ok: boolean;
            path?: string;
            error?: string;
            recording?: {
              id: string;
              startedAt: string;
              eventCount: number;
              urlCount: number;
              durationMs: number;
              path?: string;
            };
          }>;
        },
      };
    },
    {
      bridgeName: BRIDGE_NAME,
      css: assets.css,
      draft: initialDraft,
      initialRecording: recordingStatus(),
    },
  );

  await page.addScriptTag({ content: assets.js });
  return saved;
}

export async function authorSiteConfigWithOverlay(): Promise<string> {
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
      validate: validateUrl,
    }),
  );

  const assets = await readOverlayAssets();
  const browser = await launchChrome({ headless: false });
  const context = await createContext(browser, {
    headless: false,
    viewport: { width: 1440, height: 1000 },
  });

  try {
    const recording = await startBrowserRecording(context, {
      targetUrl: startUrl,
      tags: ["overlay-authoring"],
      notes: `Overlay authoring session for ${name}`,
    });
    const page = await context.newPage();
    const s = spinner();
    s.start("Opening target page");
    await page.goto(startUrl, { waitUntil: "domcontentloaded" });
    recording.addUrl(page.url());
    s.stop("Target page opened");
    const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => undefined);
    const viewport = page.viewportSize() ?? undefined;

    await waitForEnter(
      "Navigate, search, or solve any challenge until the browser shows the data page. Press Enter here to inject the overlay.",
    );

    const draft: OverlayDraft = {
      id: safeSlug(id),
      name,
      jurisdiction: normalizeOptionalText(jurisdiction),
      startUrl,
      sourceUrl: page.url(),
      extractionKind: "list",
      fields: [],
    };

    note(
      "Recording is active. Use the overlay toolbar in Chrome to select an item, fields, optional pagination, preview, then save.",
      "Overlay ready",
    );
    return await injectOverlay(page, assets, draft, recording, { userAgent, viewport });
  } finally {
    await context.close();
    await browser.close();
  }
}
