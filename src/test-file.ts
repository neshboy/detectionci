import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { LogEvent, TestCase, TestFile } from "./types.js";

export class TestFileParseError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse a DetectionCI test file. Schema:
 *
 *   rule: ../rules/some_rule.yml   # path resolved relative to this file
 *   cases:
 *     - name: some human-readable case name
 *       should_match: true
 *       event: { ...arbitrary JSON log event... }
 */
export function parseTestFileString(yamlText: string, filePath: string): TestFile {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    throw new TestFileParseError(
      `Failed to parse YAML in ${filePath}: ${(err as Error).message}`,
    );
  }

  if (!isRecord(raw)) {
    throw new TestFileParseError(`Test file ${filePath} does not contain a YAML mapping.`);
  }

  if (typeof raw.rule !== "string" || raw.rule.trim() === "") {
    throw new TestFileParseError(`Test file ${filePath} is missing a required "rule" field.`);
  }

  if (!Array.isArray(raw.cases) || raw.cases.length === 0) {
    throw new TestFileParseError(
      `Test file ${filePath} must define a non-empty "cases" list.`,
    );
  }

  const cases: TestCase[] = raw.cases.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new TestFileParseError(`Test file ${filePath}: cases[${index}] is not a mapping.`);
    }
    if (typeof entry.should_match !== "boolean") {
      throw new TestFileParseError(
        `Test file ${filePath}: cases[${index}] is missing a boolean "should_match" field.`,
      );
    }
    if (!isRecord(entry.event)) {
      throw new TestFileParseError(
        `Test file ${filePath}: cases[${index}] is missing an "event" mapping.`,
      );
    }
    const name = typeof entry.name === "string" && entry.name.trim() !== "" ? entry.name : `case ${index + 1}`;
    return { name, shouldMatch: entry.should_match, event: entry.event as LogEvent };
  });

  const rulePath = resolve(dirname(filePath), raw.rule);

  return { filePath, rulePath, cases };
}

/** Load and parse a single DetectionCI test file from disk. */
export function loadTestFile(filePath: string): TestFile {
  const text = readFileSync(filePath, "utf8");
  return parseTestFileString(text, filePath);
}
