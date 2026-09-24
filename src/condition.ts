/**
 * A small boolean-expression parser/evaluator for Sigma's `condition:`
 * string. Supports the mainstream subset of Sigma's condition grammar:
 *
 *   - identifiers referencing named selections           e.g. `selection1`
 *   - boolean operators                                  `and`, `or`, `not`
 *   - parentheses for grouping                           `(selection1 or selection2) and not filter`
 *   - aggregate-over-pattern quantifiers                 `1 of selection*`, `all of selection*`, `all of them`
 *
 * NOT supported (see README Limitations): `count()`/aggregation functions,
 * cross-event correlation, `near`/timeframe logic, and Sigma's full
 * near-miss grammar edge cases.
 */

export class ConditionSyntaxError extends Error {}

type TokenType = "LPAREN" | "RPAREN" | "AND" | "OR" | "NOT" | "OF" | "ALL" | "NUMBER" | "IDENT";

interface Token {
  type: TokenType;
  text: string;
}

const KEYWORD_TOKEN_TYPES: Record<string, TokenType> = {
  and: "AND",
  or: "OR",
  not: "NOT",
  of: "OF",
  all: "ALL",
};

function tokenize(condition: string): Token[] {
  const rawTokens = condition.match(/\(|\)|[A-Za-z0-9_*]+/g);
  if (!rawTokens) {
    throw new ConditionSyntaxError(`Could not tokenize condition: "${condition}"`);
  }
  return rawTokens.map((text): Token => {
    if (text === "(") return { type: "LPAREN", text };
    if (text === ")") return { type: "RPAREN", text };
    const lower = text.toLowerCase();
    if (lower in KEYWORD_TOKEN_TYPES) {
      return { type: KEYWORD_TOKEN_TYPES[lower], text: lower };
    }
    if (/^[0-9]+$/.test(text)) {
      return { type: "NUMBER", text };
    }
    return { type: "IDENT", text };
  });
}

export type ConditionNode =
  | { kind: "ident"; name: string }
  | { kind: "not"; operand: ConditionNode }
  | { kind: "and"; left: ConditionNode; right: ConditionNode }
  | { kind: "or"; left: ConditionNode; right: ConditionNode }
  | { kind: "aggregate"; quantifier: number | "all"; pattern: string };

class Parser {
  private pos = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly source: string,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const token = this.tokens[this.pos];
    if (!token) {
      throw new ConditionSyntaxError(`Unexpected end of condition: "${this.source}"`);
    }
    this.pos += 1;
    return token;
  }

  private expect(type: TokenType): Token {
    const token = this.next();
    if (token.type !== type) {
      throw new ConditionSyntaxError(
        `Expected ${type} but got "${token.text}" in condition: "${this.source}"`,
      );
    }
    return token;
  }

  parse(): ConditionNode {
    const node = this.parseOr();
    if (this.pos !== this.tokens.length) {
      throw new ConditionSyntaxError(
        `Unexpected trailing token "${this.peek()?.text}" in condition: "${this.source}"`,
      );
    }
    return node;
  }

  private parseOr(): ConditionNode {
    let left = this.parseAnd();
    while (this.peek()?.type === "OR") {
      this.next();
      const right = this.parseAnd();
      left = { kind: "or", left, right };
    }
    return left;
  }

  private parseAnd(): ConditionNode {
    let left = this.parseNot();
    while (this.peek()?.type === "AND") {
      this.next();
      const right = this.parseNot();
      left = { kind: "and", left, right };
    }
    return left;
  }

  private parseNot(): ConditionNode {
    if (this.peek()?.type === "NOT") {
      this.next();
      return { kind: "not", operand: this.parseNot() };
    }
    return this.parseAtom();
  }

  private parseAtom(): ConditionNode {
    const token = this.peek();
    if (!token) {
      throw new ConditionSyntaxError(`Unexpected end of condition: "${this.source}"`);
    }

    if (token.type === "LPAREN") {
      this.next();
      const inner = this.parseOr();
      this.expect("RPAREN");
      return inner;
    }

    if (token.type === "NUMBER") {
      this.next();
      this.expect("OF");
      const patternToken = this.next();
      return { kind: "aggregate", quantifier: Number(token.text), pattern: patternToken.text };
    }

    if (token.type === "ALL") {
      this.next();
      this.expect("OF");
      const patternToken = this.next();
      return { kind: "aggregate", quantifier: "all", pattern: patternToken.text };
    }

    if (token.type === "IDENT") {
      this.next();
      return { kind: "ident", name: token.text };
    }

    throw new ConditionSyntaxError(
      `Unexpected token "${token.text}" in condition: "${this.source}"`,
    );
  }
}

/** Parse a Sigma `condition:` string into an AST. */
export function parseCondition(condition: string): ConditionNode {
  const tokens = tokenize(condition);
  return new Parser(tokens, condition).parse();
}

/** Resolve a `1 of selection*` / `all of them` pattern to matching selection names. */
function resolvePattern(pattern: string, selectionNames: string[]): string[] {
  if (pattern === "them") {
    return selectionNames;
  }
  if (!pattern.includes("*")) {
    return selectionNames.includes(pattern) ? [pattern] : [];
  }
  const regex = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
  return selectionNames.filter((name) => regex.test(name));
}

/** Evaluate a parsed condition AST against each selection's boolean match result. */
export function evaluateCondition(
  node: ConditionNode,
  selectionResults: Record<string, boolean>,
): boolean {
  const selectionNames = Object.keys(selectionResults);

  switch (node.kind) {
    case "ident": {
      if (!(node.name in selectionResults)) {
        throw new ConditionSyntaxError(
          `Condition references unknown selection "${node.name}". Known selections: ${selectionNames.join(", ")}`,
        );
      }
      return selectionResults[node.name];
    }
    case "not":
      return !evaluateCondition(node.operand, selectionResults);
    case "and":
      return (
        evaluateCondition(node.left, selectionResults) &&
        evaluateCondition(node.right, selectionResults)
      );
    case "or":
      return (
        evaluateCondition(node.left, selectionResults) ||
        evaluateCondition(node.right, selectionResults)
      );
    case "aggregate": {
      const matches = resolvePattern(node.pattern, selectionNames);
      if (matches.length === 0) {
        throw new ConditionSyntaxError(
          `"${node.quantifier} of ${node.pattern}" did not match any known selection. Known selections: ${selectionNames.join(", ")}`,
        );
      }
      const trueCount = matches.filter((name) => selectionResults[name]).length;
      if (node.quantifier === "all") {
        return trueCount === matches.length;
      }
      return trueCount >= node.quantifier;
    }
  }
}
