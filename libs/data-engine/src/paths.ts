import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";

let workspaceRootCache: string | undefined;

function hasWorkspaceMarker(directory: string): boolean {
  return (
    existsSync(join(directory, "pnpm-workspace.yaml")) ||
    existsSync(join(directory, "bun.lock")) ||
    existsSync(join(directory, "bun.lockb"))
  );
}

export function findWorkspaceRoot(startDirectory = process.cwd()): string {
  if (workspaceRootCache) {
    return workspaceRootCache;
  }

  let current = resolve(startDirectory);
  const root = parse(current).root;

  while (current !== root) {
    if (hasWorkspaceMarker(current)) {
      workspaceRootCache = current;
      return current;
    }
    current = dirname(current);
  }

  workspaceRootCache = resolve(startDirectory);
  return workspaceRootCache;
}

export function resolveWorkspacePath(...segments: string[]): string {
  if (segments.length === 1 && isAbsolute(segments[0] ?? "")) {
    return segments[0] ?? "";
  }
  return join(findWorkspaceRoot(), ...segments);
}

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function ensureParentDirectory(path: string): Promise<void> {
  await ensureDirectory(dirname(path));
}

export function recordingsDirectory(): string {
  return resolveWorkspacePath("recordings");
}

export function browserFlowsDirectory(): string {
  return resolveWorkspacePath("flows");
}

export function qaBriefsDirectory(): string {
  return resolveWorkspacePath("qa-briefs");
}

export function browserFlowRunsDirectory(): string {
  return resolveWorkspacePath("flows", "runs");
}

export function browserFlowArtifactsDirectory(): string {
  return resolveWorkspacePath("flows", "artifacts");
}

export function configsDirectory(): string {
  return resolveWorkspacePath("configs", "sites");
}

export function exportsDirectory(): string {
  return resolveWorkspacePath("exports");
}

export function replayDirectory(): string {
  return resolveWorkspacePath(".cache", "replays");
}
