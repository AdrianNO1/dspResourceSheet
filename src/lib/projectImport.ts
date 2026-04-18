import { getCanonicalImportedItemDependencies } from "./factoriolabCatalog";
import type { ImportedItemCategory, ProjectImportedDependency, ProjectImportedItem, ResourceDefinition } from "./types";

type CsvImportGoal = {
  resourceId: string;
  quantity: number;
};

export type ImportedProject = {
  goals: CsvImportGoal[];
  importedItems: Omit<ProjectImportedItem, "id" | "project_id">[];
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

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function toDisplayName(value: string) {
  return value
    .trim()
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

function parseIoMap(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [itemName = "", quantityValue = "0"] = entry.split(":");
      return {
        itemKey: normalizeKey(itemName),
        rawName: itemName.trim(),
        quantity: parseQuantity(quantityValue),
      };
    })
    .filter((entry) => entry.itemKey.length > 0 && entry.quantity > 0);
}

function buildProjectName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").trim() || "Imported CSV Project";
}

function buildResourceAliasMap(resources: ResourceDefinition[]) {
  const aliasMap = new Map<string, ResourceDefinition>();

  for (const resource of resources) {
    aliasMap.set(normalizeKey(resource.name), resource);
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
  const headerRowIndex = rows.findIndex(
    (row) =>
      row.includes("Item") &&
      row.includes("Items") &&
      row.includes("Inputs") &&
      row.includes("Outputs") &&
      row.includes("Belts") &&
      row.includes("Machine"),
  );

  if (headerRowIndex === -1) {
    throw new Error("CSV format not recognized.");
  }

  const headerRow = rows[headerRowIndex];
  const itemIndex = headerRow.indexOf("Item");
  const itemsIndex = headerRow.indexOf("Items");
  const inputsIndex = headerRow.indexOf("Inputs");
  const outputsIndex = headerRow.indexOf("Outputs");
  const beltsIndex = headerRow.indexOf("Belts");
  const beltIndex = headerRow.indexOf("Belt");
  const recipeIndex = headerRow.indexOf("Recipe");
  const machinesIndex = headerRow.indexOf("Machines");
  const machineIndex = headerRow.indexOf("Machine");

  const aliasMap = buildResourceAliasMap(resources);
  const quantityByResourceId = new Map<string, number>();
  const skippedRawResources = new Set<string>();
  const importedItems: Omit<ProjectImportedItem, "id" | "project_id">[] = [];

  for (const [sortOrder, row] of rows.slice(headerRowIndex + 1).entries()) {
    const itemValue = row[itemIndex] ?? "";
    const itemKey = normalizeKey(itemValue);
    if (!itemKey) {
      continue;
    }

    const throughputPerMinute = parseQuantity(row[itemsIndex] ?? "");
    if (throughputPerMinute <= 0) {
      continue;
    }

    const inputs = parseIoMap(row[inputsIndex] ?? "");
    const outputs = parseIoMap(row[outputsIndex] ?? "");
    const primaryOutput = outputs.find((entry) => entry.itemKey === itemKey) ?? outputs[0] ?? {
      itemKey,
      rawName: itemValue.trim(),
      quantity: 1,
    };
    const outputQuantity = primaryOutput.quantity > 0 ? primaryOutput.quantity : 1;
    const resource = aliasMap.get(itemKey);

    const beltLabel = (row[beltIndex] ?? "").trim();
    const outputBelts = parseQuantity(row[beltsIndex] ?? "");
    const beltSpeedPerMinute = outputBelts > 0 ? throughputPerMinute / outputBelts : null;
    const category: ImportedItemCategory = inputs.length === 0 && resource ? "raw" : "crafted";

    if (category === "raw" && resource) {
      const goalQuantity = resource.type === "ore_vein" ? throughputPerMinute / 30 : throughputPerMinute;
      if (goalQuantity > 0) {
        quantityByResourceId.set(resource.id, (quantityByResourceId.get(resource.id) ?? 0) + goalQuantity);
      }
    } else if (inputs.length === 0 && !resource && outputs.length === 0) {
      skippedRawResources.add(itemValue.trim());
      continue;
    }

    const dependencies: ProjectImportedDependency[] = inputs.map((input) => {
      const rawResource = aliasMap.get(input.itemKey) ?? null;
      return {
        item_key: rawResource ? normalizeKey(rawResource.name) : input.itemKey,
        display_name: rawResource?.name ?? toDisplayName(input.rawName || input.itemKey),
        dependency_type: rawResource ? "raw" : "crafted",
        per_unit_ratio: input.quantity / outputQuantity,
        imported_demand_per_minute: (input.quantity / outputQuantity) * throughputPerMinute,
      };
    });

    const importedItem: Omit<ProjectImportedItem, "id" | "project_id"> = {
      item_key: itemKey,
      display_name: resource?.name ?? toDisplayName(itemValue),
      category,
      imported_throughput_per_minute: throughputPerMinute,
      machine_count: parseQuantity(row[machinesIndex] ?? ""),
      machine_label: (row[machineIndex] ?? "").trim(),
      belt_label: beltLabel,
      belt_speed_per_minute: beltSpeedPerMinute,
      output_belts: outputBelts,
      recipe: (row[recipeIndex] ?? "").trim(),
      outputs: row[outputsIndex] ?? "",
      dependencies,
      sort_order: sortOrder,
    };

    importedItems.push({
      ...importedItem,
      dependencies: getCanonicalImportedItemDependencies({
        ...importedItem,
        id: "",
        project_id: "",
      }) ?? dependencies,
    });
  }

  const goals = Array.from(quantityByResourceId.entries()).map(([resourceId, quantity]) => ({
    resourceId,
    quantity,
  }));

  if (goals.length === 0 && importedItems.length === 0) {
    throw new Error("No supported raw-resource or production requirements were found in the CSV.");
  }

  return {
    goals,
    importedItems,
    projectName: buildProjectName(fileName),
    projectNotes: `Imported raw and production requirements from ${fileName}.`,
    skippedRawResources: Array.from(skippedRawResources).sort((left, right) => left.localeCompare(right)),
  };
}
