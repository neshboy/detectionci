import { describe, expect, it } from "vitest";
import { matchSelection, SigmaRegexTimeoutError, UnsupportedSigmaFeatureError } from "../src/matcher.js";

describe("matchSelection: exact match", () => {
  it("matches when field value equals the pattern", () => {
    expect(matchSelection({ EventID: 4625 }, { EventID: 4625 })).toBe(true);
  });

  it("does not match when field value differs", () => {
    expect(matchSelection({ EventID: 4624 }, { EventID: 4625 })).toBe(false);
  });

  it("matches when field value is any one of a list (OR)", () => {
    expect(matchSelection({ LogonType: 10 }, { LogonType: [3, 10] })).toBe(true);
    expect(matchSelection({ LogonType: 2 }, { LogonType: [3, 10] })).toBe(false);
  });

  it("ANDs multiple fields within one selection map", () => {
    const def = { EventID: 4625, LogonType: 3 };
    expect(matchSelection({ EventID: 4625, LogonType: 3 }, def)).toBe(true);
    expect(matchSelection({ EventID: 4625, LogonType: 2 }, def)).toBe(false);
  });

  it("does not match when the field is missing from the event", () => {
    expect(matchSelection({ OtherField: 1 }, { EventID: 4625 })).toBe(false);
  });
});

describe("matchSelection: wildcard (*) matching", () => {
  it("matches a trailing wildcard pattern", () => {
    expect(matchSelection({ Image: "C:\\Windows\\System32\\cmd.exe" }, { Image: "*\\cmd.exe" })).toBe(
      true,
    );
  });

  it("matches a leading and trailing wildcard pattern", () => {
    expect(
      matchSelection({ CommandLine: "powershell.exe -enc AAAA" }, { CommandLine: "*-enc*" }),
    ).toBe(true);
  });

  it("does not match when the wildcard pattern does not fit", () => {
    expect(matchSelection({ Image: "C:\\Windows\\System32\\notepad.exe" }, { Image: "*\\cmd.exe" })).toBe(
      false,
    );
  });

  it("wildcard matching is case-insensitive", () => {
    expect(matchSelection({ Image: "C:\\WINDOWS\\CMD.EXE" }, { Image: "*\\cmd.exe" })).toBe(true);
  });
});

describe("matchSelection: |contains / |startswith / |endswith modifiers", () => {
  it("|contains matches a substring anywhere", () => {
    expect(
      matchSelection(
        { CommandLine: "powershell.exe -EncodedCommand AAAA" },
        { "CommandLine|contains": "-EncodedCommand" },
      ),
    ).toBe(true);
    expect(
      matchSelection({ CommandLine: "powershell.exe -Command Get-Process" }, { "CommandLine|contains": "-EncodedCommand" }),
    ).toBe(false);
  });

  it("|contains with a list of values is OR-ed", () => {
    const def = { "CommandLine|contains": ["-enc", "-EncodedCommand"] };
    expect(matchSelection({ CommandLine: "foo -enc bar" }, def)).toBe(true);
    expect(matchSelection({ CommandLine: "foo -EncodedCommand bar" }, def)).toBe(true);
    expect(matchSelection({ CommandLine: "foo -Command bar" }, def)).toBe(false);
  });

  it("|startswith matches a prefix", () => {
    expect(matchSelection({ CommandLine: "-enc AAAA" }, { "CommandLine|startswith": "-enc" })).toBe(
      true,
    );
    expect(matchSelection({ CommandLine: "foo -enc AAAA" }, { "CommandLine|startswith": "-enc" })).toBe(
      false,
    );
  });

  it("|endswith matches a suffix", () => {
    expect(matchSelection({ Image: "C:\\Windows\\System32\\cmd.exe" }, { "Image|endswith": "\\cmd.exe" })).toBe(
      true,
    );
    expect(matchSelection({ Image: "C:\\Windows\\System32\\cmd.exe.bak" }, { "Image|endswith": "\\cmd.exe" })).toBe(
      false,
    );
  });

  it("modifiers are case-insensitive", () => {
    expect(matchSelection({ CommandLine: "FOO -ENC BAR" }, { "CommandLine|contains": "-enc" })).toBe(
      true,
    );
  });
});

describe("matchSelection: |re and |all modifiers", () => {
  it("|re matches against a regular expression", () => {
    expect(matchSelection({ EventID: "4625" }, { "EventID|re": "^46(24|25)$" })).toBe(true);
    expect(matchSelection({ EventID: "4634" }, { "EventID|re": "^46(24|25)$" })).toBe(false);
  });

  it("|all requires every listed value to match", () => {
    const def = { "CommandLine|contains|all": ["-enc", "AAAA"] };
    expect(matchSelection({ CommandLine: "foo -enc AAAA" }, def)).toBe(true);
    expect(matchSelection({ CommandLine: "foo -enc only" }, def)).toBe(false);
  });

  it("|re bounds catastrophic backtracking instead of hanging", () => {
    const def = { "CommandLine|re": "^(a+)+$" };
    const evilValue = `${"a".repeat(40)}!`;
    expect(() => matchSelection({ CommandLine: evilValue }, def)).toThrow(SigmaRegexTimeoutError);
  });
});

describe("matchSelection: list-of-maps selections (OR across maps)", () => {
  it("matches if any map in the list matches", () => {
    const def = [{ EventID: 4625, LogonType: 3 }, { EventID: 4625, LogonType: 10 }];
    expect(matchSelection({ EventID: 4625, LogonType: 10 }, def)).toBe(true);
    expect(matchSelection({ EventID: 4625, LogonType: 2 }, def)).toBe(false);
  });
});

describe("matchSelection: empty field map never vacuously matches", () => {
  it("returns false for an empty single-map selection", () => {
    expect(matchSelection({ EventID: 4625 }, {})).toBe(false);
  });

  it("returns false for a list entry that is an empty map", () => {
    expect(matchSelection({ EventID: 4625 }, [{}])).toBe(false);
  });
});

describe("matchSelection: unsupported features raise a clear error", () => {
  it("rejects bare keyword-list selections", () => {
    expect(() => matchSelection({ CommandLine: "foo" }, ["foo", "bar"] as never)).toThrow(
      UnsupportedSigmaFeatureError,
    );
  });

  it("rejects unknown modifiers", () => {
    expect(() => matchSelection({ Field: "x" }, { "Field|winsomething": "x" })).toThrow(
      UnsupportedSigmaFeatureError,
    );
  });
});
