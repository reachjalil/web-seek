export function hasExceededDuration(
  startedAtMs: number,
  maxDurationMs: number,
  nowMs = Date.now(),
): boolean {
  return nowMs - startedAtMs > maxDurationMs;
}
