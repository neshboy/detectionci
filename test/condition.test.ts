import { describe, expect, it } from "vitest";
import { evaluateCondition, parseCondition, ConditionSyntaxError } from "../src/condition.js";

function evalCond(condition: string, selectionResults: Record<string, boolean>): boolean {
  return evaluateCondition(parseCondition(condition), selectionResults);
}

describe("condition: identifiers", () => {
  it("evaluates a bare selection reference", () => {
    expect(evalCond("selection1", { selection1: true })).toBe(true);
    expect(evalCond("selection1", { selection1: false })).toBe(false);
  });

  it("throws on unknown selection references", () => {
    expect(() => evalCond("selection1", {})).toThrow(ConditionSyntaxError);
  });
});

describe("condition: and / or / not", () => {
  it("and requires both sides true", () => {
    expect(evalCond("a and b", { a: true, b: true })).toBe(true);
    expect(evalCond("a and b", { a: true, b: false })).toBe(false);
  });

  it("or requires either side true", () => {
    expect(evalCond("a or b", { a: false, b: true })).toBe(true);
    expect(evalCond("a or b", { a: false, b: false })).toBe(false);
  });

  it("not negates", () => {
    expect(evalCond("not a", { a: true })).toBe(false);
    expect(evalCond("not a", { a: false })).toBe(true);
  });

  it("supports parentheses and operator precedence (and binds tighter than or)", () => {
    // a or (b and c)
    expect(evalCond("a or b and c", { a: false, b: true, c: true })).toBe(true);
    expect(evalCond("a or b and c", { a: false, b: true, c: false })).toBe(false);
  });

  it("supports explicit grouping that overrides default precedence", () => {
    // (a or b) and c
    expect(evalCond("(a or b) and c", { a: true, b: false, c: false })).toBe(false);
    expect(evalCond("(a or b) and c", { a: true, b: false, c: true })).toBe(true);
  });

  it("combines and/or/not the way a realistic rule does", () => {
    const cond = "selection_failed_logon and selection_remote_logon_type and not filter_known_healthcheck_account";
    expect(
      evalCond(cond, {
        selection_failed_logon: true,
        selection_remote_logon_type: true,
        filter_known_healthcheck_account: false,
      }),
    ).toBe(true);
    expect(
      evalCond(cond, {
        selection_failed_logon: true,
        selection_remote_logon_type: true,
        filter_known_healthcheck_account: true,
      }),
    ).toBe(false);
  });
});

describe("condition: aggregate 'N of selection*' / 'all of selection*' / 'all of them'", () => {
  it("'1 of selection*' is true when at least one matching selection is true", () => {
    const cond = "1 of selection*";
    expect(evalCond(cond, { selection_a: false, selection_b: true, other: false })).toBe(true);
    expect(evalCond(cond, { selection_a: false, selection_b: false, other: true })).toBe(false);
  });

  it("'2 of selection*' requires at least two matching selections to be true", () => {
    const cond = "2 of selection*";
    expect(evalCond(cond, { selection_a: true, selection_b: true, selection_c: false })).toBe(true);
    expect(evalCond(cond, { selection_a: true, selection_b: false, selection_c: false })).toBe(false);
  });

  it("'all of selection*' requires every matching selection to be true", () => {
    const cond = "all of selection*";
    expect(evalCond(cond, { selection_a: true, selection_b: true })).toBe(true);
    expect(evalCond(cond, { selection_a: true, selection_b: false })).toBe(false);
  });

  it("'all of them' considers every known selection", () => {
    const cond = "all of them";
    expect(evalCond(cond, { a: true, b: true })).toBe(true);
    expect(evalCond(cond, { a: true, b: false })).toBe(false);
  });

  it("throws when the aggregate pattern matches no known selection", () => {
    expect(() => evalCond("1 of nomatch*", { selection_a: true })).toThrow(ConditionSyntaxError);
  });

  it("combines an aggregate with a plain AND, like the office-LOLBin rule", () => {
    const cond = "selection_office_parent and 1 of selection_child*";
    expect(
      evalCond(cond, {
        selection_office_parent: true,
        selection_child_cmd: true,
        selection_child_powershell: false,
        selection_child_wscript: false,
      }),
    ).toBe(true);
    expect(
      evalCond(cond, {
        selection_office_parent: true,
        selection_child_cmd: false,
        selection_child_powershell: false,
        selection_child_wscript: false,
      }),
    ).toBe(false);
    expect(
      evalCond(cond, {
        selection_office_parent: false,
        selection_child_cmd: true,
        selection_child_powershell: false,
        selection_child_wscript: false,
      }),
    ).toBe(false);
  });
});
