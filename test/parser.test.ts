import { describe, expect, it } from "vitest";
import { parseSigmaRuleString, SigmaParseError } from "../src/parser.js";
import { evaluateRule } from "../src/evaluator.js";

const VALID_RULE = `
title: Test Rule
id: 00000000-0000-0000-0000-000000000000
status: experimental
description: a rule for testing
level: medium
logsource:
  product: windows
detection:
  selection1:
    EventID: 4625
  selection2:
    LogonType: [3, 10]
  condition: selection1 and selection2
`;

describe("parseSigmaRuleString", () => {
  it("parses title, metadata, and the detection block", () => {
    const rule = parseSigmaRuleString(VALID_RULE, "test.yml");
    expect(rule.title).toBe("Test Rule");
    expect(rule.level).toBe("medium");
    expect(rule.detection.condition).toBe("selection1 and selection2");
    expect(Object.keys(rule.detection.selections)).toEqual(["selection1", "selection2"]);
  });

  it("produces a rule that evaluateRule can run against an event", () => {
    const rule = parseSigmaRuleString(VALID_RULE, "test.yml");
    expect(evaluateRule(rule, { EventID: 4625, LogonType: 3 }).matched).toBe(true);
    expect(evaluateRule(rule, { EventID: 4625, LogonType: 2 }).matched).toBe(false);
  });

  it("rejects YAML that isn't a mapping", () => {
    expect(() => parseSigmaRuleString("- just\n- a\n- list\n", "bad.yml")).toThrow(SigmaParseError);
  });

  it("rejects a rule missing a title", () => {
    expect(() =>
      parseSigmaRuleString("detection:\n  selection1:\n    EventID: 1\n  condition: selection1\n", "bad.yml"),
    ).toThrow(SigmaParseError);
  });

  it("rejects a rule missing a detection block", () => {
    expect(() => parseSigmaRuleString("title: No Detection\n", "bad.yml")).toThrow(SigmaParseError);
  });

  it("rejects a detection block missing a condition", () => {
    expect(() =>
      parseSigmaRuleString("title: No Condition\ndetection:\n  selection1:\n    EventID: 1\n", "bad.yml"),
    ).toThrow(SigmaParseError);
  });

  it("rejects a detection block with no named selections", () => {
    expect(() =>
      parseSigmaRuleString("title: No Selections\ndetection:\n  condition: selection1\n", "bad.yml"),
    ).toThrow(SigmaParseError);
  });
});
