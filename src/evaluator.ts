import { evaluateCondition, parseCondition } from "./condition.js";
import { matchSelection } from "./matcher.js";
import type { EvaluationResult, LogEvent, SigmaRule } from "./types.js";

/** Evaluate a parsed Sigma rule against a single log event. */
export function evaluateRule(rule: SigmaRule, event: LogEvent): EvaluationResult {
  const selectionResults: Record<string, boolean> = {};
  for (const [name, definition] of Object.entries(rule.detection.selections)) {
    selectionResults[name] = matchSelection(event, definition);
  }

  const ast = parseCondition(rule.detection.condition);
  const matched = evaluateCondition(ast, selectionResults);

  return { matched, selectionResults };
}
