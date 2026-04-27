#!/usr/bin/env bun

import { confirm, intro, note, outro, select, spinner, text } from "@clack/prompts";
import { formatError, formatInfo, formatSuccess, formatTitle } from "@web-seek/cli-utils";
import {
  type BrowserFlowEntry,
  type ConfigEntry,
  listBrowserFlows,
  listSiteConfigs,
  readSiteConfig,
} from "@web-seek/data-engine";
import Table from "cli-table3";
import { authorBrowserFlow } from "./browser-flow-author";
import { replayBrowserFlow } from "./browser-flow-replay";
import { authorBrowserQaBrief } from "./browser-qa-brief-author";
import { collectInputVariables, runExtractionConfig } from "./extractor";
import { authorSiteConfigWithOverlay } from "./overlay-author";
import { unwrapPrompt } from "./prompt-utils";

type MenuAction =
  | "create-qa-brief"
  | "create-extraction"
  | "run-extraction"
  | "create-flow"
  | "replay-flow"
  | "exit";

function renderBrowserFlows(flows: BrowserFlowEntry[]): void {
  const table = new Table({
    head: ["Name", "Updated", "Steps", "Start URL"],
    colWidths: [34, 28, 8, 72],
    wordWrap: true,
  });

  for (const flow of flows) {
    table.push([flow.name, flow.updatedAt, flow.stepCount.toString(), flow.startUrl]);
  }

  console.log(table.toString());
}

function renderSiteConfigs(configs: ConfigEntry[]): void {
  const table = new Table({
    head: ["ID", "Name", "Updated", "Steps", "Start URL"],
    colWidths: [30, 34, 28, 8, 72],
    wordWrap: true,
  });

  for (const config of configs) {
    table.push([
      config.id,
      config.name,
      config.updatedAt,
      config.stepCount.toString(),
      config.startUrl,
    ]);
  }

  console.log(table.toString());
}

async function chooseSiteConfig(): Promise<ConfigEntry | undefined> {
  const configs = await listSiteConfigs();
  if (configs.length === 0) {
    note("No extraction workflows found in ./configs/sites.", "Extraction workflows");
    return undefined;
  }

  renderSiteConfigs(configs);

  const selectedPath = await unwrapPrompt(
    select({
      message: "Choose an extraction workflow",
      options: configs.map((config) => ({
        value: config.path,
        label: `${config.name} (${config.id})`,
        hint: config.group ?? config.startUrl,
      })),
    }),
  );

  return configs.find((config) => config.path === selectedPath);
}

async function chooseBrowserFlow(): Promise<BrowserFlowEntry | undefined> {
  const flows = await listBrowserFlows();
  if (flows.length === 0) {
    note("No browser flows found in ./flows.", "Browser flows");
    return undefined;
  }

  renderBrowserFlows(flows);

  const selectedPath = await unwrapPrompt(
    select({
      message: "Choose a browser flow",
      options: flows.map((flow) => ({
        value: flow.path,
        label: `${flow.name} - ${flow.stepCount} steps`,
        hint: flow.startUrl,
      })),
    }),
  );

  return flows.find((flow) => flow.path === selectedPath);
}

async function runExtractionWorkflowPath(path: string): Promise<void> {
  const config = await readSiteConfig(path);
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
    note(
      [
        `Rows: ${summary.result.rows.length}`,
        `Pages: ${summary.result.pageCount}`,
        summary.artifacts.jsonPath ? `JSON: ${summary.artifacts.jsonPath}` : undefined,
        summary.artifacts.csvPath ? `CSV: ${summary.artifacts.csvPath}` : undefined,
        summary.result.downloads.length > 0
          ? `Downloads: ${summary.result.downloads.length}`
          : undefined,
        summary.result.screenshots.length > 0
          ? `Screenshots: ${summary.result.screenshots.length}`
          : undefined,
        summary.result.warnings.length > 0
          ? `Warnings: ${summary.result.warnings.join("; ")}`
          : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
      "Extraction complete",
    );
  } catch (error) {
    s.stop(formatError("Extraction failed"));
    throw error;
  }
}

async function createExtractionWorkflow(): Promise<void> {
  const path = await authorSiteConfigWithOverlay();
  note(`Saved to ${path}`, "Extraction workflow saved");

  const shouldRun = await unwrapPrompt(
    confirm({
      message: "Run a smoke extraction now?",
      initialValue: false,
    }),
  );
  if (shouldRun) {
    await runExtractionWorkflowPath(path);
  }
}

async function runExtractionWorkflow(): Promise<void> {
  const config = await chooseSiteConfig();
  if (!config) {
    return;
  }
  await runExtractionWorkflowPath(config.path);
}

async function createBrowserQaBrief(): Promise<void> {
  const path = await authorBrowserQaBrief();
  note(`Saved to ${path}`, "Browser QA brief saved");
}

async function createBrowserFlow(): Promise<void> {
  const path = await authorBrowserFlow();
  note(`Saved to ${path}`, "Browser flow saved");
}

async function replaySavedBrowserFlow(): Promise<void> {
  const flow = await chooseBrowserFlow();
  if (!flow) {
    return;
  }

  const resultPath = await replayBrowserFlow(flow.path);
  note(
    [
      "Replay stopped. The browser stays open when Keep open is enabled in the controller.",
      resultPath ? `Replay result: ${resultPath}` : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
    "Replay",
  );
}

async function menuLoop(): Promise<void> {
  console.log(formatTitle("Web Seek"));
  intro("Browser QA automation brief authoring with legacy extraction and replay tools");

  while (true) {
    const action = await unwrapPrompt(
      select<MenuAction>({
        message: "What would you like to do?",
        options: [
          { value: "create-qa-brief", label: "Create browser QA brief" },
          { value: "create-extraction", label: "Create extraction workflow (legacy)" },
          { value: "run-extraction", label: "Run extraction workflow" },
          { value: "create-flow", label: "Create browser flow (QA debug)" },
          { value: "replay-flow", label: "Replay browser flow (QA debug)" },
          { value: "exit", label: "Exit" },
        ],
      }),
    );

    try {
      if (action === "create-qa-brief") {
        await createBrowserQaBrief();
      } else if (action === "create-extraction") {
        await createExtractionWorkflow();
      } else if (action === "run-extraction") {
        await runExtractionWorkflow();
      } else if (action === "create-flow") {
        await createBrowserFlow();
      } else if (action === "replay-flow") {
        await replaySavedBrowserFlow();
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
