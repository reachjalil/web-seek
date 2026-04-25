import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readJsonFile, safeSlug, writeJsonFile } from "./json";
import { configsDirectory, ensureDirectory } from "./paths";
import { type SiteExtractionConfig, siteExtractionConfigSchema } from "./schemas";

export interface ConfigEntry {
  id: string;
  name: string;
  group?: string;
  jurisdiction?: string;
  path: string;
  updatedAt: string;
  startUrl: string;
  stepCount: number;
}

export function configPathForId(id: string): string {
  return join(configsDirectory(), `${safeSlug(id)}.json`);
}

export async function saveSiteConfig(config: SiteExtractionConfig): Promise<string> {
  const validated = siteExtractionConfigSchema.parse(config);
  const path = configPathForId(validated.id);
  await writeJsonFile(path, validated);
  return path;
}

export async function readSiteConfig(path: string): Promise<SiteExtractionConfig> {
  return readJsonFile(path, siteExtractionConfigSchema);
}

export async function listSiteConfigs(): Promise<ConfigEntry[]> {
  const directory = configsDirectory();
  await ensureDirectory(directory);

  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(directory, entry.name));

  const configs: ConfigEntry[] = [];
  for (const path of files) {
    try {
      const config = await readSiteConfig(path);
      configs.push({
        id: config.id,
        name: config.name,
        group: config.group ?? config.jurisdiction,
        jurisdiction: config.jurisdiction,
        path,
        updatedAt: config.updatedAt,
        startUrl: config.startUrl,
        stepCount: config.steps.length,
      });
    } catch {
      // Invalid configs are intentionally skipped from executable choices.
    }
  }

  return configs.sort((a, b) => a.name.localeCompare(b.name));
}
