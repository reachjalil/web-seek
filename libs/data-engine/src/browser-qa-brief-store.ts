import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readJsonFile, safeSlug, writeJsonFile } from "./json";
import { ensureDirectory, qaBriefsDirectory } from "./paths";
import { type BrowserQaBrief, browserQaBriefSchema } from "./schemas";

export interface BrowserQaBriefEntry {
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  startUrl: string;
  visitedUrlCount: number;
  stepCount: number;
}

export function createBrowserQaBriefId(name: string, date = new Date()): string {
  const slug = safeSlug(name) || "browser-qa-brief";
  const timestamp = date
    .toISOString()
    .replaceAll(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `${slug}-${timestamp}`;
}

export function browserQaBriefPathForId(id: string): string {
  return join(qaBriefsDirectory(), `${safeSlug(id)}.json`);
}

export async function saveBrowserQaBrief(brief: BrowserQaBrief): Promise<string> {
  const parsed = browserQaBriefSchema.parse(brief);
  const path = browserQaBriefPathForId(parsed.id);
  await writeJsonFile(path, parsed);
  return path;
}

export async function readBrowserQaBrief(path: string): Promise<BrowserQaBrief> {
  return readJsonFile(path, browserQaBriefSchema);
}

export async function listBrowserQaBriefs(): Promise<BrowserQaBriefEntry[]> {
  const directory = qaBriefsDirectory();
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
        const brief = await readBrowserQaBrief(path);
        return {
          id: brief.id,
          name: brief.name,
          path,
          sizeBytes: stat.size,
          createdAt: brief.createdAt,
          updatedAt: brief.updatedAt,
          startUrl: brief.startUrl,
          visitedUrlCount: brief.visitedUrls.length,
          stepCount: brief.steps.length,
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
          visitedUrlCount: 0,
          stepCount: 0,
        };
      }
    }),
  );

  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
