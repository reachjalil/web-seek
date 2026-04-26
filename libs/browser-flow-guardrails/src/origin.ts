import type { BrowserFlow } from "@web-seek/data-engine";

export function normalizeAllowedOrigins(flow: Pick<BrowserFlow, "allowedOrigins">): Set<string> {
  return new Set(flow.allowedOrigins.map((origin) => new URL(origin).origin));
}

export function isAllowedUrl(url: string, allowedOrigins: Set<string>): boolean {
  try {
    return allowedOrigins.has(new URL(url).origin);
  } catch {
    return false;
  }
}
