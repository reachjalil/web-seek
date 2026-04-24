import { createRequire } from "node:module";
import {
  type RecordingFile,
  type RrwebEvent,
  createRecordingId,
  rrwebEventSchema,
  saveRecording,
} from "@web-seek/data-engine";
import type { Page } from "playwright";
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
    if (w.__webSeekStopRecorder || !w.rrweb || typeof w.rrweb.record !== "function") {
      return;
    }

    w.__webSeekStopRecorder = w.rrweb.record({
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

export async function recordSession(options: RecordingOptions): Promise<RecordingResult> {
  const startedAtDate = new Date();
  const id = createRecordingId(startedAtDate);
  const events: RrwebEvent[] = [];
  const urls = new Set<string>([options.targetUrl]);
  const rrwebScript = await loadRrwebScript();
  const browser = await launchChrome({ headless: false });

  try {
    const context = await createContext(browser, {
      headless: false,
      viewport: { width: 1440, height: 1000 },
    });

    await context.exposeBinding("webSeekEmitRrweb", (_source, payload: unknown) => {
      const parsed = rrwebEventSchema.safeParse(payload);
      if (parsed.success) {
        events.push(parsed.data);
      }
    });

    await context.addInitScript({ content: buildRecorderInitScript(rrwebScript) });

    context.on("page", (page) => attachUrlTracking(page, urls));
    const page = await context.newPage();
    attachUrlTracking(page, urls);
    await page.goto(options.targetUrl, { waitUntil: "domcontentloaded" });
    urls.add(page.url());

    const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => undefined);
    const viewport = page.viewportSize() ?? undefined;

    await waitForEnter(
      "Recording is active. Use the browser normally, then press Enter here to stop recording.",
    );

    const stoppedAtDate = new Date();
    const recording: RecordingFile = {
      schema: "web-seek.recording.v1",
      id,
      targetUrl: options.targetUrl,
      startedAt: startedAtDate.toISOString(),
      stoppedAt: stoppedAtDate.toISOString(),
      durationMs: stoppedAtDate.getTime() - startedAtDate.getTime(),
      eventCount: events.length,
      userAgent,
      viewport,
      urls: Array.from(urls),
      events,
      tags: options.tags ?? [],
      notes: options.notes,
    };

    const path = await saveRecording(recording);
    await context.close();
    return { path, recording };
  } finally {
    await browser.close();
  }
}
