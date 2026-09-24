# DetectionCI

A CI regression-testing framework for [Sigma](https://github.com/SigmaHQ/sigma) detection
rules. Write your SOC's Sigma rules and a few labeled sample log events, and DetectionCI
tells you which rules fired correctly, which had **false negatives** (should have matched
and didn't), and which had **false positives** (matched something it shouldn't) -- with a
CI-friendly exit code.

## Why

Detection rules rot. A field gets renamed upstream, a log source changes shape, someone
"simplifies" a condition during a refactor -- and a rule that used to catch failed RDP
logon bursts silently stops firing, or starts paging on-call for noise. Unlike application
code, most SOCs have no regression tests for their detections: rules are eyeballed, maybe
run against production for a few days, and then left alone until someone notices (or
doesn't) that they've gone quiet.

DetectionCI treats detection rules like code: pair each rule with sample events that should
and shouldn't trigger it, and run that suite on every PR that touches `rules/`. If a rule
edit breaks expected behavior, CI fails before it ships.

## What it actually does (no hand-waving)

- A real Sigma YAML parser (`src/parser.ts`) that reads a rule's `detection:` block --
  named selections plus a `condition:` string.
- A real field-matching evaluator (`src/matcher.ts`) that resolves dot-path fields out of a
  JSON log event and evaluates them against Sigma selections: exact match, wildcards
  (`*`, `?`), and the `|contains`, `|startswith`, `|endswith`, `|re`, and `|all` modifiers.
- A real boolean-expression parser/evaluator for the `condition:` string
  (`src/condition.ts`): a hand-written tokenizer + recursive-descent parser supporting
  `and`/`or`/`not`, parentheses, and `N of selection*` / `all of selection*` / `all of them`
  aggregate quantifiers.
- A real test runner (`src/runner.ts`) that loads every rule under `--rules`, every test
  file under `--tests`, actually evaluates each rule against each sample event, and diffs
  the real result against the expected `should_match`.

Nothing here is mocked or hardcoded to the shipped examples -- point `--rules`/`--tests` at
your own directories and it evaluates your rules against your events.

## Install / quick start

```bash
git clone <this repo>
cd detectionci
npm install
npm run build
```

Run the shipped example suite:

```bash
node dist/cli.js test --rules ./rules --tests ./tests
# or, once linked/published: detectionci test --rules ./rules --tests ./tests
```

### A minimal example

A Sigma rule, `rules/powershell_encoded_command.yml` (trimmed):

```yaml
title: Suspicious PowerShell EncodedCommand Execution
detection:
  selection_image:
    Image|endswith:
      - '\powershell.exe'
      - '\pwsh.exe'
  selection_encoded_flag:
    CommandLine|contains:
      - '-enc'
      - '-EncodedCommand'
  filter_approved_deployment_script:
    CommandLine|contains: 'ApprovedDeploymentScript.ps1'
  condition: selection_image and selection_encoded_flag and not filter_approved_deployment_script
```

A matching test file, `tests/powershell_encoded_command.test.yml`:

```yaml
rule: ../rules/powershell_encoded_command.yml
cases:
  - name: powershell.exe with -enc flag should match
    should_match: true
    event:
      Image: C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
      CommandLine: powershell.exe -enc SQBFAFgA...

  - name: plain powershell invocation with no encoded flag should not match
    should_match: false
    event:
      Image: C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
      CommandLine: powershell.exe -Command Get-Process
```

`detectionci test` loads every `*.yml`/`*.yaml` rule under `--rules`, every test file under
`--tests`, resolves each test file's `rule:` path relative to the test file itself, runs
every case, and prints a pass/fail report per rule with false-positive/false-negative detail.
It exits non-zero if any case fails -- wire it into your PR checks for any diff touching
`rules/`.

### Test file schema

```yaml
rule: <path to a Sigma rule, resolved relative to this test file>
cases:
  - name: <human-readable case name>
    should_match: true | false
    event: { ...any JSON object shaped like your log source... }
```

One test file can hold many cases against one rule; ship as many test files per rule as you
need to cover both true positives and known-noisy false-positive scenarios.

## Shipped example rules

`rules/` ships three real, hand-written Sigma rules with matching fixtures in `tests/`, used
both as usage examples and as the fixtures for this repo's own end-to-end test:

- `windows_failed_logon_burst.yml` -- a **simplified**, single-event stand-in for the classic
  "failed logon burst" detection (Event ID 4625 with a network/RDP logon type, filtering a
  known health-check account). The real Sigma pattern for a "burst" uses `| count() > N`
  with a `timeframe`, which requires correlating multiple events -- not supported here (see
  Limitations).
- `powershell_encoded_command.yml` -- flags `powershell.exe`/`pwsh.exe` invocations with an
  encoded/obfuscated command line, filtering a known approved deployment script.
- `office_spawning_lolbin.yml` -- flags a Microsoft Office app spawning `cmd.exe`,
  `powershell.exe`, or `wscript.exe` as a child process, using the `1 of selection_child*`
  aggregate condition.

## Automated tests

```bash
npm test
```

runs the vitest suite (`test/`), which covers:

- `matcher.test.ts` -- exact-match selections, `*` wildcards, `|contains`/`|startswith`/`|endswith`/`|re`/`|all` modifiers, list-of-maps OR-ing, and rejection of unsupported features.
- `condition.test.ts` -- `and`/`or`/`not` logic, operator precedence, parentheses, and `N of selection*`/`all of selection*`/`all of them` aggregates.
- `parser.test.ts` -- parsing a rule's metadata and detection block, and rejecting malformed rules.
- `e2e.test.ts` -- runs `detectionci test` (via the same `runTests` the CLI calls) against the shipped `rules/`+`tests/` fixtures and asserts everything passes; then, on a **throwaway copy** of those fixtures, deliberately mutates `windows_failed_logon_burst.yml` (changes the EventID it looks for so it can never fire), reruns, asserts the tool reports false negatives for exactly the affected cases with exit-worthy failures, then reverts the mutation and asserts the suite is green again. The real, git-tracked fixtures are never touched by this test.

## Limitations (read this before relying on it)

DetectionCI implements the **mainstream subset** of Sigma's condition and detection grammar,
not the full spec. Specifically supported:

- Field-match selections as a single map (fields AND-ed, list values OR-ed) or a list of
  maps (OR-ed across maps).
- Modifiers: `|contains`, `|startswith`, `|endswith`, `|re`, `|all`.
- `*` and `?` wildcards on unmodified string values.
- Dot-path field lookup into nested JSON (`Event.System.EventID`).
- Condition operators `and`, `or`, `not`, parentheses, and `N of <pattern>` /
  `all of <pattern>` / `all of them` aggregates over selection-name globs.
- Case-insensitive string comparison throughout (matches typical Windows-log conventions).

**Not supported** (rules using these will error out or silently mis-evaluate the unsupported
piece -- don't assume they degrade gracefully):

- Aggregation functions in conditions, e.g. `count()`, `min()`, `max()`, `avg()`, `sum()` and
  their `by <field>` grouping -- Sigma features like `| count() by SourceIp > 5`.
- Cross-event correlation and `timeframe`/`near` logic (multi-event, time-windowed
  detections such as true "burst" or "N failed logons in 5 minutes" rules).
- Sigma correlation rules (the newer `correlation:`-type rule format).
- Bare keyword-list selections (a selection that's just a list of strings with no field
  name, i.e. full-text/keyword search over a log line).
- Additional modifiers beyond the five listed above (e.g. `|base64`, `|cidr`, `|windash`,
  `|fieldref`, `|expand`, `|gt`/`|lt`/`|gte`/`|lte`, `|utf16`, timezone-related modifiers).
- Sigma's field-to-field comparisons and value-list files (`valuelist.txt`-style external
  lists).
- Rule collections / `action: global` and multi-document rule files.

If a rule needs one of the above, DetectionCI will either throw a clear
`UnsupportedSigmaFeatureError`/`ConditionSyntaxError` at parse/evaluation time (for most of
the above) or, in the case of features it doesn't recognize at all, simply won't produce the
detection you expect -- so treat "it doesn't error" as necessary but not sufficient, and keep
your test fixtures honest.

## License

MIT, see [LICENSE](./LICENSE).
