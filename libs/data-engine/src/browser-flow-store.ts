import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readJsonFile, safeSlug, writeJsonFile } from "./json";
import { browserFlowRunsDirectory, browserFlowsDirectory, ensureDirectory } from "./paths";
import {
  type BrowserFlow,
  type BrowserFlowReplayResult,
  browserFlowReplayResultSchema,
  browserFlowSchema,
} from "./schemas";

export interface BrowserFlowEntry {
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  startUrl: string;
  stepCount: number;
}

export function createBrowserFlowId(name: string, date = new Date()): string {
  const slug = safeSlug(name) || "browser-flow";
  const timestamp = date
    .toISOString()
    .replaceAll(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `${slug}-${timestamp}`;
}

export function browserFlowPathForId(id: string): string {
  return join(browserFlowsDirectory(), `${id}.json`);
}

export function browserFlowReplayResultPathForId(id: string): string {
  return join(browserFlowRunsDirectory(), `${safeSlug(id)}.json`);
}

export async function saveBrowserFlow(flow: BrowserFlow): Promise<string> {
  const parsed = browserFlowSchema.parse(flow);
  const path = browserFlowPathForId(parsed.id);
  await writeJsonFile(path, parsed);
  return path;
}

export async function readBrowserFlow(path: string): Promise<BrowserFlow> {
  return readJsonFile(path, browserFlowSchema);
}

export async function saveBrowserFlowReplayResult(
  result: BrowserFlowReplayResult,
): Promise<string> {
  const parsed = browserFlowReplayResultSchema.parse(result);
  const path = browserFlowReplayResultPathForId(parsed.id);
  await writeJsonFile(path, parsed);
  return path;
}

export async function listBrowserFlows(): Promise<BrowserFlowEntry[]> {
  const directory = browserFlowsDirectory();
  await ensureDirectory(directory);

  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(directory, entry.name));

  const summaries = await Promise.all(
    files.map(async (path) => {
      const file = Bun.file(path);
      const stat = await file.stat();
      const fallbackDate = stat.mtime.toISOString();

      try {
        const flow = await readBrowserFlow(path);
        return {
          id: flow.id,
          name: flow.name,
          path,
          sizeBytes: stat.size,
          createdAt: flow.createdAt,
          updatedAt: flow.updatedAt,
          startUrl: flow.startUrl,
          stepCount: flow.steps.length,
        };
      } catch {
        return {
          id:
            path
              .split("/")
              .at(-1)
              ?.replace(/\.json$/i, "") ?? path,
          name: path.split("/").at(-1) ?? path,
          path,
          sizeBytes: stat.size,
          createdAt: fallbackDate,
          updatedAt: fallbackDate,
          startUrl: "-",
          stepCount: 0,
        };
      }
    }),
  );

  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
