import boxen from "boxen";
import chalk from "chalk";
import logSymbols from "log-symbols";

export function formatTitle(text: string): string {
  return boxen(chalk.bold.cyan(text), {
    padding: 1,
    margin: 1,
    borderStyle: "round",
    borderColor: "cyan",
  });
}

export function formatSuccess(text: string): string {
  return `${logSymbols.success} ${chalk.green(text)}`;
}

export function formatError(text: string): string {
  return `${logSymbols.error} ${chalk.red(text)}`;
}

export function formatInfo(text: string): string {
  return `${logSymbols.info} ${chalk.blue(text)}`;
}
