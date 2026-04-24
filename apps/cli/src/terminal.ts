import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

export async function waitForEnter(message: string): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    await rl.question(`${message}\n`);
  } finally {
    rl.close();
  }
}
