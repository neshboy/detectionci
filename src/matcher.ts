import type { FieldMap, LogEvent, SelectionDefinition } from "./types.js";
import { wildcardToRegExp } from "./wildcard.js";

/** Modifiers documented and supported by DetectionCI's Sigma subset. */
const SUPPORTED_MODIFIERS = new Set(["contains", "startswith", "endswith", "re", "all"]);

export class UnsupportedSigmaFeatureError extends Error {}

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
    return new RegExp(patternStr, "i").test(fieldStr);
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
  for (const [key, spec] of Object.entries(fieldMap)) {
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
