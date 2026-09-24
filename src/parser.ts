import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { Detection, SelectionDefinition, SigmaRule } from "./types.js";

export class SigmaParseError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse a Sigma rule from a raw YAML string. `filePath` is used only for error messages. */
export function parseSigmaRuleString(yamlText: string, filePath: string): SigmaRule {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    throw new SigmaParseError(`Failed to parse YAML in ${filePath}: ${(err as Error).message}`);
  }

  if (!isRecord(raw)) {
    throw new SigmaParseError(`Rule file ${filePath} does not contain a YAML mapping.`);
  }

  if (typeof raw.title !== "string" || raw.title.trim() === "") {
    throw new SigmaParseError(`Rule file ${filePath} is missing a required "title" field.`);
  }

  const detectionRaw = raw.detection;
  if (!isRecord(detectionRaw)) {
    throw new SigmaParseError(`Rule file ${filePath} is missing a "detection" block.`);
  }

  const { condition, ...selectionEntries } = detectionRaw;
  if (typeof condition !== "string" || condition.trim() === "") {
    throw new SigmaParseError(
      `Rule file ${filePath}'s detection block is missing a "condition" string.`,
    );
  }

  const selectionNames = Object.keys(selectionEntries);
  if (selectionNames.length === 0) {
    throw new SigmaParseError(
      `Rule file ${filePath}'s detection block defines no named selections.`,
    );
  }

  const selections: Record<string, SelectionDefinition> = {};
  for (const name of selectionNames) {
    selections[name] = selectionEntries[name] as SelectionDefinition;
  }

  const detection: Detection = { condition, selections };

  return {
    filePath,
    id: typeof raw.id === "string" ? raw.id : undefined,
    title: raw.title,
    description: typeof raw.description === "string" ? raw.description : undefined,
    status: typeof raw.status === "string" ? raw.status : undefined,
    level: typeof raw.level === "string" ? raw.level : undefined,
    logsource: isRecord(raw.logsource) ? raw.logsource : undefined,
    detection,
    raw,
  };
}

/** Load and parse a single Sigma rule file from disk. */
export function loadSigmaRuleFile(filePath: string): SigmaRule {
  const text = readFileSync(filePath, "utf8");
  return parseSigmaRuleString(text, filePath);
}
