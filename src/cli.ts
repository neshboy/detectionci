#!/usr/bin/env node
import { Command } from "commander";
import { formatReport } from "./report.js";
import { runTests } from "./runner.js";

const program = new Command();

program
  .name("detectionci")
  .description(
    "Regression-test Sigma detection rules against labeled sample log events.",
  )
  .version("0.1.0");

program
  .command("test")
  .description("Run every test file's cases against its target Sigma rule and report results.")
  .option("--rules <dir>", "directory containing Sigma rule YAML files", "./rules")
  .option("--tests <dir>", "directory containing DetectionCI test YAML files", "./tests")
  .action((options: { rules: string; tests: string }) => {
    try {
      const report = runTests(options.rules, options.tests);
      console.log(formatReport(report));
      process.exitCode = report.failCount > 0 ? 1 : 0;
    } catch (err) {
      console.error(`detectionci: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

program.parse(process.argv);
