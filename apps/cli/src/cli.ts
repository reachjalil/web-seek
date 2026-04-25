#!/usr/bin/env bun

import { intro, note, outro, select, spinner, text } from "@clack/prompts";
import { formatError, formatInfo, formatSuccess, formatTitle } from "@web-seek/cli-utils";
import {
  type ConfigEntry,
  type RecordingEntry,
  listRecordings,
  listSiteConfigs,
  readSiteConfig,
} from "@web-seek/data-engine";
import Table from "cli-table3";
import { authorSiteConfig } from "./config-author";
import { collectInputVariables, runExtractionConfig } from "./extractor";
import { authorSiteConfigWithOverlay } from "./overlay-author";
import { unwrapPrompt } from "./prompt-utils";
import { recordSession } from "./recorder";
import { replayRecording } from "./replayer";

const DEFAULT_RECORDING_URL = "https://en.wikipedia.org/wiki/Special:Random";

type MenuAction =
  | "record"
  | "list-recordings"
  | "replay"
  | "author-config"
  | "author-overlay-config"
  | "list-configs"
  | "run-config"
  | "blueprint"
  | "exit";

function renderRecordings(recordings: RecordingEntry[]): void {
  const table = new Table({
    head: ["File", "Created", "Events", "Target"],
    colWidths: [34, 28, 10, 72],
    wordWrap: true,
  });

  for (const recording of recordings) {
    table.push([
      recording.name,
      recording.createdAt,
      recording.eventCount?.toString() ?? "-",
      recording.targetUrl ?? "-",
    ]);
  }

  console.log(table.toString());
}

function renderConfigs(configs: ConfigEntry[]): void {
  const table = new Table({
    head: ["ID", "Name", "Group", "Steps", "Start URL"],
    colWidths: [32, 34, 22, 8, 70],
    wordWrap: true,
  });

  for (const config of configs) {
    table.push([
      config.id,
      config.name,
      config.group ?? "-",
      config.stepCount.toString(),
      config.startUrl,
    ]);
  }

  console.log(table.toString());
}

async function chooseRecording(): Promise<RecordingEntry | undefined> {
  const recordings = await listRecordings();
  if (recordings.length === 0) {
    note("No recordings found in ./recordings.", "Recordings");
    return undefined;
  }

  const selectedPath = await unwrapPrompt(
    select({
      message: "Choose a recording",
      options: recordings.map((recording) => ({
        value: recording.path,
        label: `${recording.name} - ${recording.eventCount ?? 0} events`,
        hint: recording.targetUrl,
      })),
    }),
  );

  return recordings.find((recording) => recording.path === selectedPath);
}

async function chooseConfig(): Promise<ConfigEntry | undefined> {
  const configs = await listSiteConfigs();
  if (configs.length === 0) {
    note("No site configs found in ./configs/sites.", "Configs");
    return undefined;
  }

  const selectedPath = await unwrapPrompt(
    select({
      message: "Choose a site config",
      options: configs.map((config) => ({
        value: config.path,
        label: `${config.name} (${config.id})`,
        hint: config.group ?? config.startUrl,
      })),
    }),
  );

  return configs.find((config) => config.path === selectedPath);
}

async function startRecording(): Promise<void> {
  const targetUrl = await unwrapPrompt(
    text({
      message: "Target URL",
      defaultValue: DEFAULT_RECORDING_URL,
      validate(value) {
        if (!value) {
          return "Enter a valid URL.";
        }
        try {
          new URL(value);
          return undefined;
        } catch {
          return "Enter a valid URL.";
        }
      },
    }),
  );
  const tagText = await unwrapPrompt(
    text({
      message: "Tags (comma-separated, optional)",
      placeholder: "research, catalog",
    }),
  );

  const result = await recordSession({
    targetUrl,
    tags: tagText
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  });

  note(
    `${result.recording.eventCount} rrweb events captured.\nSaved to ${result.path}`,
    "Recording saved",
  );
}

async function listSavedRecordings(): Promise<void> {
  const recordings = await listRecordings();
  if (recordings.length === 0) {
    note("No recordings found. Start a new recording first.", "Recordings");
    return;
  }

  renderRecordings(recordings);
}

async function replaySavedRecording(): Promise<void> {
  const recording = await chooseRecording();
  if (!recording) {
    return;
  }

  const result = await replayRecording(recording.path);
  note(`Temporary replay HTML generated at ${result.htmlPath}`, "Replay");
}

async function createExtractionConfig(): Promise<void> {
  const path = await authorSiteConfig();
  note(`Config saved to ${path}`, "Config saved");
}

async function createExtractionConfigWithOverlay(): Promise<void> {
  const path = await authorSiteConfigWithOverlay();
  note(`Config saved to ${path}`, "Config saved");
}

async function listConfigs(): Promise<void> {
  const configs = await listSiteConfigs();
  if (configs.length === 0) {
    note("No configs found. Use the interactive authoring flow first.", "Configs");
    return;
  }

  renderConfigs(configs);
}

async function runConfig(): Promise<void> {
  const entry = await chooseConfig();
  if (!entry) {
    return;
  }

  const config = await readSiteConfig(entry.path);
  const variables: Record<string, string> = {};
  for (const variable of collectInputVariables(config)) {
    variables[variable.name] = await unwrapPrompt(
      text({
        message: variable.label,
        placeholder: variable.name,
      }),
    );
  }

  const s = spinner();
  s.start(`Running ${config.name}`);
  try {
    const summary = await runExtractionConfig(config, { variables });
    s.stop(formatSuccess(`Extracted ${summary.result.rows.length} rows`));
    const output = [
      summary.artifacts.jsonPath ? `JSON: ${summary.artifacts.jsonPath}` : undefined,
      summary.artifacts.csvPath ? `CSV: ${summary.artifacts.csvPath}` : undefined,
      summary.result.downloads.length > 0
        ? `Downloads: ${summary.result.downloads.length}`
        : undefined,
      summary.result.warnings.length > 0
        ? `Warnings: ${summary.result.warnings.join("; ")}`
        : undefined,
    ]
      .filter(Boolean)
      .join("\n");
    note(output || "Run completed without output artifacts.", "Extraction complete");
  } catch (error) {
    s.stop(formatError("Extraction failed"));
    throw error;
  }
}

function showExtractionBlueprint(): void {
  const table = new Table({
    head: ["Page type", "What to detect", "Config strategy"],
    colWidths: [24, 46, 64],
    wordWrap: true,
  });

  table.push(
    [
      "Search form",
      "Keyword/category filters, hidden CSRF values, submit buttons.",
      "Store fill/select/click steps with {{input:name}} variables and a human checkpoint before submit.",
    ],
    [
      "Table results",
      "Headers, tbody rows, next/previous links, disabled states.",
      "Use extract-table with header-derived fields and pagination.nextSelector.",
    ],
    [
      "List/cards",
      "Repeated DOM signatures, profile links, status labels.",
      "Use extract-list; start broad with full text, then refine field selectors.",
    ],
    [
      "Infinite scroll",
      "Load-more buttons, scroll height changes, network requests.",
      "Use a click/scroll step pattern, cap max pages, and capture screenshots for drift review.",
    ],
    [
      "CSV/API export",
      "Download links, XHR endpoints, content-disposition filenames.",
      "Prefer download steps when exports are public and complete; store raw files beside normalized output.",
    ],
    [
      "Human-only gates",
      "CAPTCHA, terms, login, session timeout, or access-denied copy.",
      "Never bypass controls. Pause with human-in-loop, then resume from the same browser context.",
    ],
  );

  console.log(table.toString());
  note(
    "The durable unit is a JSON site config per site workflow. Recordings explain what happened; configs make it repeatable.",
    "Design principle",
  );
}

async function menuLoop(): Promise<void> {
  console.log(formatTitle("Web Seek"));
  intro("rrweb recording, replay, and config-first web extraction");

  while (true) {
    const action = await unwrapPrompt(
      select<MenuAction>({
        message: "What would you like to do?",
        options: [
          { value: "record", label: "Start a new rrweb recording" },
          { value: "list-recordings", label: "List recordings" },
          { value: "replay", label: "Replay a recording" },
          { value: "author-config", label: "Author extraction config from browser" },
          { value: "author-overlay-config", label: "Author extraction config with overlay" },
          { value: "list-configs", label: "List extraction configs" },
          { value: "run-config", label: "Run extraction config" },
          { value: "blueprint", label: "Show extraction workflow blueprint" },
          { value: "exit", label: "Exit" },
        ],
      }),
    );

    try {
      if (action === "record") {
        await startRecording();
      } else if (action === "list-recordings") {
        await listSavedRecordings();
      } else if (action === "replay") {
        await replaySavedRecording();
      } else if (action === "author-config") {
        await createExtractionConfig();
      } else if (action === "author-overlay-config") {
        await createExtractionConfigWithOverlay();
      } else if (action === "list-configs") {
        await listConfigs();
      } else if (action === "run-config") {
        await runConfig();
      } else if (action === "blueprint") {
        showExtractionBlueprint();
      } else {
        outro("Goodbye.");
        return;
      }
    } catch (error) {
      console.error(formatError(error instanceof Error ? error.message : String(error)));
      console.log(formatInfo("Returning to the main menu."));
    }
  }
}

menuLoop().catch((error) => {
  console.error(formatError(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
