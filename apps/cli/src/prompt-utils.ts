import { cancel, isCancel } from "@clack/prompts";

export async function unwrapPrompt<T>(value: Promise<T | symbol> | T | symbol): Promise<T> {
  const resolved = await value;
  if (isCancel(resolved)) {
    cancel("Cancelled.");
    process.exit(0);
  }
  return resolved;
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}
