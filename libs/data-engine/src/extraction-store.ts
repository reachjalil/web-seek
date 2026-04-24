import { join } from "node:path";
import { rowsToCsv } from "./csv";
import { safeSlug, writeJsonFile } from "./json";
import { ensureParentDirectory, exportsDirectory, resolveWorkspacePath } from "./paths";
import type { ExtractionRunResult, SiteExtractionConfig } from "./schemas";

export interface SavedExtractionArtifacts {
  jsonPath?: string;
  csvPath?: string;
}

function outputDirectoryFor(config: SiteExtractionConfig): string {
  const directory = config.output.directory;
  if (directory === "exports") {
    return exportsDirectory();
  }
  return resolveWorkspacePath(directory);
}

export async function saveExtractionRun(
  config: SiteExtractionConfig,
  result: ExtractionRunResult,
): Promise<SavedExtractionArtifacts> {
  const baseName = `${safeSlug(config.id)}-${Date.now()}`;
  const directory = outputDirectoryFor(config);
  const artifacts: SavedExtractionArtifacts = {};

  if (config.output.format === "json" || config.output.format === "both") {
    artifacts.jsonPath = join(directory, `${baseName}.json`);
    await writeJsonFile(artifacts.jsonPath, result);
  }

  if (config.output.format === "csv" || config.output.format === "both") {
    artifacts.csvPath = join(directory, `${baseName}.csv`);
    await ensureParentDirectory(artifacts.csvPath);
    await Bun.write(artifacts.csvPath, rowsToCsv(result.rows));
  }

  return artifacts;
}
