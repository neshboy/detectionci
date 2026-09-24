/**
 * Core types shared across the Sigma parser, matcher, condition evaluator,
 * and test runner.
 */

/** A single JSON-ish log event to evaluate rules against. */
export type LogEvent = Record<string, unknown>;

/**
 * A field-match "atom": one field name (with an optional Sigma modifier
 * suffix, e.g. `CommandLine|contains`) mapped to a value or list of values.
 */
export type FieldMap = Record<string, unknown>;

/**
 * A single selection's raw definition, as it appears under `detection:` in a
 * Sigma rule. Sigma allows a selection to be:
 *  - a single map of field -> value(s), where all fields are AND-ed
 *    together and a list value for one field is OR-ed together, or
 *  - a list of maps, where each map is evaluated as above and the results
 *    are OR-ed together, or
 *  - a plain list of keyword strings (unsupported "keyword detection" --
 *    see README limitations).
 */
export type SelectionDefinition = FieldMap | FieldMap[] | unknown[];

/** The parsed `detection:` block: named selections plus a condition string. */
export interface Detection {
  condition: string;
  selections: Record<string, SelectionDefinition>;
}

/** A fully parsed Sigma rule. */
export interface SigmaRule {
  /** Absolute or repo-relative path this rule was loaded from. */
  filePath: string;
  id?: string;
  title: string;
  description?: string;
  status?: string;
  level?: string;
  logsource?: Record<string, unknown>;
  detection: Detection;
  /** Raw parsed YAML, kept around for debugging/inspection. */
  raw: Record<string, unknown>;
}

/** Result of evaluating one rule against one event. */
export interface EvaluationResult {
  matched: boolean;
  /** Per-selection boolean results, useful for debugging. */
  selectionResults: Record<string, boolean>;
}

/** One labeled sample event plus the expected outcome for a rule. */
export interface TestCase {
  name: string;
  shouldMatch: boolean;
  event: LogEvent;
}

/** A parsed test file: which rule it targets, and its test cases. */
export interface TestFile {
  filePath: string;
  /** Path to the rule file, resolved relative to the test file's directory. */
  rulePath: string;
  cases: TestCase[];
}

/** Outcome of running a single test case against its target rule. */
export interface TestCaseResult {
  testFile: string;
  ruleTitle: string;
  ruleFilePath: string;
  caseName: string;
  shouldMatch: boolean;
  actuallyMatched: boolean;
  passed: boolean;
  /** Populated when passed === false. */
  kind?: "false_negative" | "false_positive";
}

/** Aggregate report for a full `detectionci test` run. */
export interface RunReport {
  results: TestCaseResult[];
  passCount: number;
  failCount: number;
}
