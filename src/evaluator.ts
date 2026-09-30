import type { ConditionNode } from "./condition.js";
import { evaluateCondition, parseCondition } from "./condition.js";
import { matchSelection } from "./matcher.js";
import type { EvaluationResult, LogEvent, SigmaRule } from "./types.js";

// A SigmaRule's `detection.condition` string never changes after it's loaded,
// so its parsed AST is cached here (keyed by the rule object itself) instead
// of being re-tokenized/re-parsed on every evaluateRule() call -- e.g. once
// per test case when the same rule is checked against many sample events.
const conditionAstCache = new WeakMap<SigmaRule, ConditionNode>();

function getConditionAst(rule: SigmaRule): ConditionNode {
  let ast = conditionAstCache.get(rule);
  if (!ast) {
    ast = parseCondition(rule.detection.condition);
    conditionAstCache.set(rule, ast);
  }
  return ast;
}

/** Evaluate a parsed Sigma rule against a single log event. */
export function evaluateRule(rule: SigmaRule, event: LogEvent): EvaluationResult {
  const selectionResults: Record<string, boolean> = {};
  for (const [name, definition] of Object.entries(rule.detection.selections)) {
    selectionResults[name] = matchSelection(event, definition);
  }

  const ast = getConditionAst(rule);
  const matched = evaluateCondition(ast, selectionResults);

  return { matched, selectionResults };
}
