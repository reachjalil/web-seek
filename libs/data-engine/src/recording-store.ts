import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "./json";
import { ensureDirectory, recordingsDirectory } from "./paths";
import { type RecordingFile, recordingFileSchema } from "./schemas";

export interface RecordingEntry {
  name: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
  eventCount?: number;
  targetUrl?: string;
}

export function createRecordingId(date = new Date()): string {
  const seconds = Math.floor(date.getTime() / 1000);
  return `session-${seconds}`;
}

export function recordingPathForId(id: string): string {
  return join(recordingsDirectory(), `${id}.json`);
}

export async function saveRecording(recording: RecordingFile): Promise<string> {
  const path = recordingPathForId(recording.id);
  await writeJsonFile(path, recording);
  return path;
}

export async function readRecording(path: string): Promise<RecordingFile> {
  return readJsonFile(path, recordingFileSchema);
}

export async function listRecordings(): Promise<RecordingEntry[]> {
  const directory = recordingsDirectory();
  await ensureDirectory(directory);

  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(directory, entry.name));

  const summaries = await Promise.all(
    files.map(async (path) => {
      const file = Bun.file(path);
      const stat = await file.stat();
      let metadata: Pick<RecordingEntry, "createdAt" | "eventCount" | "targetUrl"> = {
        createdAt: stat.mtime.toISOString(),
      };

      try {
        const recording = await readRecording(path);
        metadata = {
          createdAt: recording.startedAt,
          eventCount: recording.eventCount,
          targetUrl: recording.targetUrl,
        };
      } catch {
        // Keep malformed files visible so the operator can inspect or remove them.
      }

      return {
        name: path.split("/").at(-1) ?? path,
        path,
        sizeBytes: stat.size,
        ...metadata,
      };
    }),
  );

  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
