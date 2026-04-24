import { basename } from "node:path";
import type { z } from "zod";
import { ensureParentDirectory } from "./paths";

export async function readJsonFile<T>(
  path: string,
  schema?: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> {
  const raw = await Bun.file(path).text();
  const parsed = JSON.parse(raw) as unknown;
  return schema ? schema.parse(parsed) : (parsed as T);
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await ensureParentDirectory(path);
  await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function fileStem(path: string): string {
  return basename(path).replace(/\.json$/i, "");
}

export function safeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
