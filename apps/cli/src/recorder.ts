import { createRequire } from "node:module";
import {
  type RecordingFile,
  type RrwebEvent,
  createRecordingId,
  rrwebEventSchema,
  saveRecording,
} from "@web-seek/data-engine";
import type { BrowserContext, Page } from "playwright";
import { createContext, launchChrome } from "./browser";
import { waitForEnter } from "./terminal";

const require = createRequire(import.meta.url);

export interface RecordingOptions {
  targetUrl: string;
  tags?: string[];
  notes?: string;
}

export interface RecordingResult {
  path: string;
  recording: RecordingFile;
}

export interface BrowserRecordingOptions {
  targetUrl: string;
  tags?: string[];
  notes?: string;
  onEvent?: (eventCount: number) => void;
}

export interface BrowserRecordingStatus {
  id: string;
  startedAt: string;
  eventCount: number;
  urlCount: number;
  durationMs: number;
}

export interface BrowserRecordingSession {
  id: string;
  startedAt: Date;
  addUrl(url: string): void;
  status(): BrowserRecordingStatus;
  save(metadata?: {
    targetUrl?: string;
    tags?: string[];
    notes?: string;
    userAgent?: string;
    viewport?: { width: number; height: number };
  }): Promise<RecordingResult>;
}

async function readFirstExistingAsset(candidates: string[]): Promise<string> {
  const failures: string[] = [];

  for (const candidate of candidates) {
    try {
      const path = require.resolve(candidate);
      return await Bun.file(path).text();
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Unable to locate rrweb browser bundle.\n${failures.join("\n")}`);
}

async function loadRrwebScript(): Promise<string> {
  return readFirstExistingAsset([
    "rrweb/dist/rrweb.min.js",
    "rrweb/dist/record/rrweb-record.min.js",
    "rrweb/dist/rrweb.umd.cjs",
  ]);
}

function buildRecorderInitScript(rrwebScript: string): string {
  return `
${rrwebScript}
(() => {
  const w = window;
  if (w.__webSeekRecorderBooted) return;
  w.__webSeekRecorderBooted = true;

  const emit = (event) => {
    if (typeof w.webSeekEmitRrweb === "function") {
      w.webSeekEmitRrweb(JSON.parse(JSON.stringify(event)));
    }
  };

  const start = () => {
    const rrwebApi = w.rrweb || (typeof rrweb !== "undefined" ? rrweb : undefined);
    if (rrwebApi && !w.rrweb) {
      w.rrweb = rrwebApi;
    }

    if (w.__webSeekStopRecorder || !rrwebApi || typeof rrwebApi.record !== "function") {
      return;
    }

    w.__webSeekStopRecorder = rrwebApi.record({
      emit,
      checkoutEveryNms: 15000,
      collectFonts: true,
      inlineImages: true,
      inlineStylesheet: true,
      maskAllInputs: false,
      recordCanvas: true,
      recordCrossOriginIframes: true,
      sampling: {
        mousemove: 50,
        mouseInteraction: true,
        scroll: 150,
        input: "last"
      }
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
`;
}

function attachUrlTracking(page: Page, urls: Set<string>): void {
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      urls.add(frame.url());
    }
  });
}

export async function startBrowserRecording(
  context: BrowserContext,
  options: BrowserRecordingOptions,
): Promise<BrowserRecordingSession> {
  const startedAtDate = new Date();
  const id = createRecordingId(startedAtDate);
  const events: RrwebEvent[] = [];
  const urls = new Set<string>([options.targetUrl]);
  const rrwebScript = await loadRrwebScript();

  await context.exposeBinding("webSeekEmitRrweb", (_source, payload: unknown) => {
    const parsed = rrwebEventSchema.safeParse(payload);
    if (parsed.success) {
      events.push(parsed.data);
      options.onEvent?.(events.length);
    }
  });

  await context.addInitScript({ content: buildRecorderInitScript(rrwebScript) });

  const attachPage = (page: Page): void => {
    urls.add(page.url());
    attachUrlTracking(page, urls);
  };

  for (const page of context.pages()) {
    attachPage(page);
    await page
      .addScriptTag({ content: buildRecorderInitScript(rrwebScript) })
      .catch(() => undefined);
  }
  context.on("page", attachPage);

  return {
    id,
    startedAt: startedAtDate,
    addUrl(url: string): void {
      urls.add(url);
    },
    status(): BrowserRecordingStatus {
      return {
        id,
        startedAt: startedAtDate.toISOString(),
        eventCount: events.length,
        urlCount: urls.size,
        durationMs: Date.now() - startedAtDate.getTime(),
      };
    },
    async save(metadata): Promise<RecordingResult> {
      const stoppedAtDate = new Date();
      const recording: RecordingFile = {
        schema: "web-seek.recording.v1",
        id,
        targetUrl: metadata?.targetUrl ?? options.targetUrl,
        startedAt: startedAtDate.toISOString(),
        stoppedAt: stoppedAtDate.toISOString(),
        durationMs: stoppedAtDate.getTime() - startedAtDate.getTime(),
        eventCount: events.length,
        userAgent: metadata?.userAgent,
        viewport: metadata?.viewport,
        urls: Array.from(urls),
        events,
        tags: metadata?.tags ?? options.tags ?? [],
        notes: metadata?.notes ?? options.notes,
      };

      const path = await saveRecording(recording);
      return { path, recording };
    },
  };
}

export async function recordSession(options: RecordingOptions): Promise<RecordingResult> {
  const browser = await launchChrome({ headless: false });
  const context = await createContext(browser, {
    headless: false,
    viewport: { width: 1440, height: 1000 },
  });

  try {
    const recording = await startBrowserRecording(context, options);
    const page = await context.newPage();
    await page.goto(options.targetUrl, { waitUntil: "domcontentloaded" });
    recording.addUrl(page.url());

    const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => undefined);
    const viewport = page.viewportSize() ?? undefined;

    await waitForEnter(
      "Recording is active. Use the browser normally, then press Enter here to stop recording.",
    );

    const result = await recording.save({ userAgent, viewport });
    await context.close();
    return result;
  } finally {
    await browser.close();
  }
}
