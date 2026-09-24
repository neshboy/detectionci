import { resolve } from "node:path";
import { globSync } from "glob";
import { evaluateRule } from "./evaluator.js";
import { loadSigmaRuleFile } from "./parser.js";
import { loadTestFile } from "./test-file.js";
import type { RunReport, SigmaRule, TestCaseResult, TestFile } from "./types.js";

/** Normalize a path for cross-platform (case-insensitive on Windows) lookup. */
function pathKey(path: string): string {
  return resolve(path).toLowerCase();
}

/** Discover and parse every Sigma rule (`*.yml`/`*.yaml`) under `rulesDir`. */
export function loadRulesFromDir(rulesDir: string): SigmaRule[] {
  const files = globSync("**/*.{yml,yaml}", { cwd: rulesDir, absolute: true, nodir: true });
  if (files.length === 0) {
    throw new Error(`No rule files (*.yml/*.yaml) found under "${rulesDir}".`);
  }
  return files.sort().map((file) => loadSigmaRuleFile(file));
}

/** Discover and parse every test file (`*.yml`/`*.yaml`) under `testsDir`. */
export function loadTestFilesFromDir(testsDir: string): TestFile[] {
  const files = globSync("**/*.{yml,yaml}", { cwd: testsDir, absolute: true, nodir: true });
  if (files.length === 0) {
    throw new Error(`No test files (*.yml/*.yaml) found under "${testsDir}".`);
  }
  return files.sort().map((file) => loadTestFile(file));
}

/**
 * Run every test file's cases against its target rule and produce a report.
 * Throws if a test file references a rule that isn't loaded from `rulesDir`.
 */
export function runTests(rulesDir: string, testsDir: string): RunReport {
  const rules = loadRulesFromDir(rulesDir);
  const testFiles = loadTestFilesFromDir(testsDir);

  const rulesByPath = new Map<string, SigmaRule>();
  for (const rule of rules) {
    rulesByPath.set(pathKey(rule.filePath), rule);
  }

  const results: TestCaseResult[] = [];

  for (const testFile of testFiles) {
    const rule = rulesByPath.get(pathKey(testFile.rulePath));
    if (!rule) {
      throw new Error(
        `Test file "${testFile.filePath}" references rule "${testFile.rulePath}", ` +
          `which was not found under rules dir "${rulesDir}".`,
      );
    }

    for (const testCase of testFile.cases) {
      const { matched } = evaluateRule(rule, testCase.event);
      const passed = matched === testCase.shouldMatch;
      let kind: TestCaseResult["kind"];
      if (!passed) {
        kind = testCase.shouldMatch ? "false_negative" : "false_positive";
      }

      results.push({
        testFile: testFile.filePath,
        ruleTitle: rule.title,
        ruleFilePath: rule.filePath,
        caseName: testCase.name,
        shouldMatch: testCase.shouldMatch,
        actuallyMatched: matched,
        passed,
        kind,
      });
    }
  }

  const passCount = results.filter((r) => r.passed).length;
  const failCount = results.length - passCount;

  return { results, passCount, failCount };
}
