import { Script, createContext } from "node:vm";
import type { FieldMap, LogEvent, SelectionDefinition } from "./types.js";
import { wildcardToRegExp } from "./wildcard.js";

/** Modifiers documented and supported by DetectionCI's Sigma subset. */
const SUPPORTED_MODIFIERS = new Set(["contains", "startswith", "endswith", "re", "all"]);

export class UnsupportedSigmaFeatureError extends Error {}

/** Thrown when a `|re` pattern takes too long to evaluate (likely catastrophic backtracking). */
export class SigmaRegexTimeoutError extends Error {}

/** Max time a single `|re` pattern is allowed to run against one field value. */
const REGEX_MATCH_TIMEOUT_MS = 250;

/**
 * Run `pattern.test(value)` inside a bounded-time VM context so a rule author's regex
 * (paired with an adversarial test/log event) can't hang the process with catastrophic
 * backtracking. Node's regex engine honors `vm` script timeouts, so this turns an
 * indefinite hang into a clear, bounded error.
 */
function testRegexWithTimeout(pattern: RegExp, value: string): boolean {
  try {
    const script = new Script("__pattern__.test(__value__)");
    const context = createContext({ __pattern__: pattern, __value__: value });
    return Boolean(script.runInContext(context, { timeout: REGEX_MATCH_TIMEOUT_MS }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("Script execution timed out")) {
      throw err;
    }
    throw new SigmaRegexTimeoutError(
      `The |re pattern ${pattern} took longer than ${REGEX_MATCH_TIMEOUT_MS}ms to evaluate ` +
        "(likely catastrophic backtracking). Rewrite the pattern to avoid nested/overlapping " +
        "quantifiers (e.g. (a+)+, (a|a)*).",
    );
  }
}

/** Look up a (possibly dotted) field path in a log event, e.g. "Event.System.EventID". */
export function getFieldValue(event: LogEvent, fieldPath: string): unknown {
  const parts = fieldPath.split(".");
  let current: unknown = event;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Split a Sigma field key like "CommandLine|contains|all" into field + modifiers. */
export function parseFieldKey(key: string): { field: string; modifiers: string[] } {
  const [field, ...modifiers] = key.split("|");
  for (const modifier of modifiers) {
    if (!SUPPORTED_MODIFIERS.has(modifier)) {
      throw new UnsupportedSigmaFeatureError(
        `Unsupported Sigma modifier "|${modifier}" on field "${field}". ` +
          `Supported modifiers: ${[...SUPPORTED_MODIFIERS].join(", ")}. See README Limitations.`,
      );
    }
  }
  return { field, modifiers };
}

/** Match a single field value against a single pattern, honoring one modifier set. */
function matchSingleValue(fieldValue: unknown, pattern: unknown, modifiers: string[]): boolean {
  if (fieldValue === undefined || fieldValue === null) {
    return false;
  }
  const fieldStr = String(fieldValue);
  const patternStr = String(pattern);

  if (modifiers.includes("re")) {
    return testRegexWithTimeout(new RegExp(patternStr, "i"), fieldStr);
  }
  if (modifiers.includes("contains")) {
    return fieldStr.toLowerCase().includes(patternStr.toLowerCase());
  }
  if (modifiers.includes("startswith")) {
    return fieldStr.toLowerCase().startsWith(patternStr.toLowerCase());
  }
  if (modifiers.includes("endswith")) {
    return fieldStr.toLowerCase().endsWith(patternStr.toLowerCase());
  }
  // Default: exact match, with `*`/`?` treated as Sigma wildcards.
  return wildcardToRegExp(patternStr).test(fieldStr);
}

/** Match a field's value(s) against a Sigma value spec (single value or list). */
function matchFieldValues(fieldValue: unknown, spec: unknown, modifiers: string[]): boolean {
  const patterns = Array.isArray(spec) ? spec : [spec];
  const structuralModifiers = modifiers.filter((m) => m !== "all");
  if (modifiers.includes("all")) {
    // "|all" requires every listed pattern to match (AND instead of the default OR).
    return patterns.every((p) => matchSingleValue(fieldValue, p, structuralModifiers));
  }
  return patterns.some((p) => matchSingleValue(fieldValue, p, structuralModifiers));
}

/** Evaluate one field-map (all keys AND-ed together) against an event. */
export function matchFieldMap(event: LogEvent, fieldMap: FieldMap): boolean {
  const entries = Object.entries(fieldMap);
  if (entries.length === 0) {
    // An empty field map has no conditions to satisfy. Treat it the same way
    // matchSelection() treats an empty list: never vacuously true, so a
    // mistyped/empty selection body can't silently match every event.
    return false;
  }
  for (const [key, spec] of entries) {
    const { field, modifiers } = parseFieldKey(key);
    const fieldValue = getFieldValue(event, field);
    if (!matchFieldValues(fieldValue, spec, modifiers)) {
      return false;
    }
  }
  return true;
}

function isPlainFieldMap(value: unknown): value is FieldMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Evaluate a selection's raw definition against an event.
 *
 *  - a single map -> AND across its fields
 *  - a list of maps -> OR across each map's AND result
 *
 * Plain keyword-list selections (a bare list of strings with no field name)
 * are not supported -- see README Limitations -- and are rejected up front
 * by the parser, so this function only has to handle the two forms above.
 */
export function matchSelection(event: LogEvent, definition: SelectionDefinition): boolean {
  if (Array.isArray(definition)) {
    if (definition.length === 0) return false;
    return definition.some((entry) => {
      if (!isPlainFieldMap(entry)) {
        throw new UnsupportedSigmaFeatureError(
          "Keyword-list selections (a bare list of strings with no field name) are not supported. See README Limitations.",
        );
      }
      return matchFieldMap(event, entry as FieldMap);
    });
  }
  if (isPlainFieldMap(definition)) {
    return matchFieldMap(event, definition);
  }
  throw new UnsupportedSigmaFeatureError(
    `Unsupported selection shape: ${JSON.stringify(definition)}. See README Limitations.`,
  );
}
