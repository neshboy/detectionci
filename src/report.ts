import chalk from "chalk";
import type { RunReport, TestCaseResult } from "./types.js";

function formatCaseLine(result: TestCaseResult): string {
  if (result.passed) {
    return `  ${chalk.green("PASS")}  ${result.caseName}`;
  }

  const detail =
    result.kind === "false_negative"
      ? chalk.red("false negative") + " -- expected a match, rule did not fire"
      : chalk.red("false positive") + " -- expected no match, rule fired anyway";

  return `  ${chalk.red("FAIL")}  ${result.caseName}  (${detail})`;
}

/** Render a full run report as a human-readable, CI-log-friendly string. */
export function formatReport(report: RunReport): string {
  const lines: string[] = [];

  const byRule = new Map<string, TestCaseResult[]>();
  for (const result of report.results) {
    const key = `${result.ruleTitle}\u0000${result.ruleFilePath}`;
    const list = byRule.get(key) ?? [];
    list.push(result);
    byRule.set(key, list);
  }

  for (const [key, results] of byRule) {
    const [ruleTitle, ruleFilePath] = key.split("\u0000");
    lines.push(`${chalk.bold(ruleTitle)} ${chalk.dim(`(${ruleFilePath})`)}`);
    for (const result of results) {
      lines.push(formatCaseLine(result));
    }
    lines.push("");
  }

  const summaryColor = report.failCount > 0 ? chalk.red : chalk.green;
  lines.push(
    summaryColor(
      `${report.passCount} passed, ${report.failCount} failed, ${report.results.length} total`,
    ),
  );

  return lines.join("\n");
}
