import type { ResourceDefinition } from "./types";

type CsvImportGoal = {
  resourceId: string;
  quantity: number;
};

export type ImportedProject = {
  goals: CsvImportGoal[];
  projectName: string;
  projectNotes: string;
  skippedRawResources: string[];
};

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === "\"") {
      if (inQuotes && nextCharacter === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && character === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!inQuotes && (character === "\n" || character === "\r")) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += character;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((currentRow) => currentRow.some((value) => value.trim().length > 0));
}

function normalizeResourceKey(value: string) {
  return value.trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function parseQuantity(value: string) {
  const trimmed = value.trim().replace(/^=/, "");
  if (!trimmed) {
    return 0;
  }

  const fractionMatch = /^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(trimmed);
  if (fractionMatch) {
    const numerator = Number(fractionMatch[1]);
    const denominator = Number(fractionMatch[2]);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
      throw new Error(`Unsupported quantity expression: ${value}`);
    }
    return numerator / denominator;
  }

  const numericValue = Number(trimmed);
  if (!Number.isFinite(numericValue)) {
    throw new Error(`Unsupported quantity expression: ${value}`);
  }

  return numericValue;
}

function buildProjectName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").trim() || "Imported CSV Project";
}

function buildResourceAliasMap(resources: ResourceDefinition[]) {
  const aliasMap = new Map<string, ResourceDefinition>();

  for (const resource of resources) {
    aliasMap.set(normalizeResourceKey(resource.name), resource);
  }

  const extraAliases = new Map<string, string>([
    ["optical-grating-crystal", "Grating Crystal"],
    ["spiniform-stalagmite-crystal", "Stalagmite Crystal"],
    ["sulphuric-acid", "Sulfuric Acid"],
  ]);

  for (const [alias, resourceName] of extraAliases.entries()) {
    const resource = resources.find((item) => item.name === resourceName);
    if (resource) {
      aliasMap.set(alias, resource);
    }
  }

  return aliasMap;
}

export function parseFactorioLabProjectCsv(
  fileName: string,
  text: string,
  resources: ResourceDefinition[],
): ImportedProject {
  const rows = parseCsv(text);
  const headerRowIndex = rows.findIndex((row) => row.includes("Item") && row.includes("Items") && row.includes("Inputs"));

  if (headerRowIndex === -1) {
    throw new Error("CSV format not recognized.");
  }

  const headerRow = rows[headerRowIndex];
  const itemIndex = headerRow.indexOf("Item");
  const itemsIndex = headerRow.indexOf("Items");
  const inputsIndex = headerRow.indexOf("Inputs");

  const aliasMap = buildResourceAliasMap(resources);
  const quantityByResourceId = new Map<string, number>();
  const skippedRawResources = new Set<string>();

  for (const row of rows.slice(headerRowIndex + 1)) {
    const item = row[itemIndex] ?? "";
    const items = row[itemsIndex] ?? "";
    const inputs = row[inputsIndex] ?? "";

    if (!item.trim() || inputs.trim()) {
      continue;
    }

    const resource = aliasMap.get(normalizeResourceKey(item));
    if (!resource) {
      skippedRawResources.add(item.trim());
      continue;
    }

    const rawQuantity = parseQuantity(items);
    const goalQuantity = resource.type === "ore_vein" ? rawQuantity / 30 : rawQuantity;
    if (goalQuantity <= 0) {
      continue;
    }

    quantityByResourceId.set(resource.id, (quantityByResourceId.get(resource.id) ?? 0) + goalQuantity);
  }

  const goals = Array.from(quantityByResourceId.entries()).map(([resourceId, quantity]) => ({
    resourceId,
    quantity,
  }));

  if (goals.length === 0) {
    throw new Error("No supported raw-resource requirements were found in the CSV.");
  }

  return {
    goals,
    projectName: buildProjectName(fileName),
    projectNotes: `Imported raw-resource requirements from ${fileName}.`,
    skippedRawResources: Array.from(skippedRawResources).sort((left, right) => left.localeCompare(right)),
  };
}
