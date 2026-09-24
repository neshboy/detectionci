import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runTests } from "../src/runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

describe("end-to-end: detectionci test against the shipped example rules", () => {
  it("all shipped rules pass all of their shipped test cases", () => {
    const report = runTests(join(REPO_ROOT, "rules"), join(REPO_ROOT, "tests"));
    expect(report.failCount).toBe(0);
    expect(report.passCount).toBe(report.results.length);
    // 3 shipped rules x 5 cases each, at the time of writing.
    expect(report.results.length).toBeGreaterThanOrEqual(15);
  });
});

describe("end-to-end: a deliberately broken rule is caught, then a revert makes the suite green again", () => {
  it("reports false negatives for a broken rule and passes again once reverted", () => {
    // Work on a throwaway copy of rules/+tests/ so the real, git-tracked
    // fixtures are never touched.
    const tmpDir = mkdtempSync(join(tmpdir(), "detectionci-e2e-"));
    const rulesDir = join(tmpDir, "rules");
    const testsDir = join(tmpDir, "tests");
    cpSync(join(REPO_ROOT, "rules"), rulesDir, { recursive: true });
    cpSync(join(REPO_ROOT, "tests"), testsDir, { recursive: true });

    const brokenRulePath = join(rulesDir, "windows_failed_logon_burst.yml");
    const originalContent = readFileSync(brokenRulePath, "utf8");

    try {
      // Sanity check: the copy behaves like the original before any mutation.
      const before = runTests(rulesDir, testsDir);
      expect(before.failCount).toBe(0);

      // Deliberately break the rule: change the failed-logon EventID it looks
      // for from 4625 to 9999, an ID that never appears in any sample event.
      // The rule can now never fire, so its "should match" cases must fail.
      const mutatedContent = originalContent.replace("EventID: 4625", "EventID: 9999");
      expect(mutatedContent).not.toBe(originalContent);
      writeFileSync(brokenRulePath, mutatedContent, "utf8");

      const afterBreak = runTests(rulesDir, testsDir);
      expect(afterBreak.failCount).toBeGreaterThan(0);

      const falseNegatives = afterBreak.results.filter(
        (r) => r.ruleFilePath === brokenRulePath && !r.passed,
      );
      expect(falseNegatives.length).toBeGreaterThan(0);
      for (const result of falseNegatives) {
        expect(result.kind).toBe("false_negative");
        expect(result.shouldMatch).toBe(true);
        expect(result.actuallyMatched).toBe(false);
      }
      // Cases that expected no match are unaffected by this particular break.
      const otherRuleResults = afterBreak.results.filter((r) => r.ruleFilePath !== brokenRulePath);
      expect(otherRuleResults.every((r) => r.passed)).toBe(true);

      // Revert the mutation; the suite should be fully green again.
      writeFileSync(brokenRulePath, originalContent, "utf8");
      const afterRevert = runTests(rulesDir, testsDir);
      expect(afterRevert.failCount).toBe(0);
      expect(afterRevert.passCount).toBe(afterRevert.results.length);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
