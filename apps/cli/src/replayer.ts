import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureDirectory, readRecording, replayDirectory } from "@web-seek/data-engine";
import { launchChrome } from "./browser";
import { waitForEnter } from "./terminal";

const require = createRequire(import.meta.url);

export interface ReplayResult {
  htmlPath: string;
}

async function tryReadPackageAsset(candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    try {
      return await Bun.file(require.resolve(candidate)).text();
    } catch {
      // Try the next package build path.
    }
  }
  return undefined;
}

function safeJsonScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003C").replaceAll("\u2028", "\\u2028");
}

async function buildReplayHtml(recordingPath: string): Promise<string> {
  const recording = await readRecording(recordingPath);
  const playerJs = await tryReadPackageAsset([
    "rrweb-player/dist/index.js",
    "rrweb-player/dist/rrweb-player.js",
  ]);
  const playerCss = await tryReadPackageAsset([
    "rrweb-player/dist/style.css",
    "rrweb-player/dist/index.css",
  ]);

  const localAssets =
    playerJs && playerCss
      ? `<style>${playerCss}</style><script>${playerJs}</script>`
      : `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/rrweb-player@latest/dist/style.css"><script src="https://cdn.jsdelivr.net/npm/rrweb-player@latest/dist/index.js"></script>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Replay ${recording.id}</title>
    ${localAssets}
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #121212;
        background: #f6f7f9;
      }

      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        padding: 16px 20px;
        border-bottom: 1px solid #d9dde4;
        background: #ffffff;
      }

      h1 {
        margin: 0;
        font-size: 18px;
        font-weight: 650;
      }

      .meta {
        color: #555d6b;
        font-size: 13px;
      }

      #player {
        padding: 16px;
      }
    </style>
  </head>
  <body>
    <header>
      <div>
        <h1>${recording.id}</h1>
        <div class="meta">${recording.eventCount} events from ${recording.targetUrl}</div>
      </div>
      <div class="meta">${recording.startedAt}</div>
    </header>
    <main id="player"></main>
    <script>
      const events = ${safeJsonScript(recording.events)};
      new rrwebPlayer({
        target: document.getElementById("player"),
        props: {
          events,
          autoPlay: true,
          showController: true,
          width: Math.min(window.innerWidth - 32, 1440),
          height: Math.max(window.innerHeight - 150, 520)
        }
      });
    </script>
  </body>
</html>
`;
}

export async function replayRecording(recordingPath: string): Promise<ReplayResult> {
  const directory = replayDirectory();
  await ensureDirectory(directory);

  const html = await buildReplayHtml(recordingPath);
  const htmlPath = join(directory, `${basename(recordingPath, ".json")}.html`);
  await Bun.write(htmlPath, html);

  const browser = await launchChrome({ headless: false });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).toString(), { waitUntil: "domcontentloaded" });
    await waitForEnter("Replay is open in Chrome. Press Enter here to close it.");
  } finally {
    await browser.close();
  }

  return { htmlPath };
}
