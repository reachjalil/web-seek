import { intro, outro, spinner, select, isCancel } from "@clack/prompts";
import { loadSampleData, type Project } from "@web-seek/data-engine";
import { formatTitle, formatSuccess, formatError, formatInfo } from "@web-seek/cli-utils";
import Table from "cli-table3";

async function main() {
  console.log(formatTitle("Web Seek CLI"));

  intro("Starting up the CLI application...");

  const s = spinner();
  s.start("Loading sample data from cache");

  // simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 1000));

  let data: Project[];
  try {
    data = loadSampleData();
    s.stop(formatSuccess("Data loaded successfully"));
  } catch (error) {
    s.stop(formatError("Failed to load data"));
    console.error(error);
    process.exit(1);
  }

  const action = await select({
    message: "What would you like to do with the data?",
    options: [
      { value: "view", label: "View all projects" },
      { value: "filterActive", label: "View active projects only" },
      { value: "exit", label: "Exit" },
    ],
  });

  if (isCancel(action) || action === "exit") {
    outro("Goodbye!");
    process.exit(0);
  }

  let displayData = data;
  if (action === "filterActive") {
    displayData = data.filter((d) => d.status === "active");
    console.log(formatInfo(`Found ${displayData.length} active projects.`));
  }

  const table = new Table({
    head: ["ID", "Name", "Status"],
    colWidths: [10, 30, 15],
  });

  for (const item of displayData) {
    table.push([item.id.toString(), item.name, item.status]);
  }

  console.log(table.toString());

  outro("Task completed.");
}

main().catch(console.error);
