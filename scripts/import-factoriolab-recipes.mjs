import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const defaultInputPath = "C:/Users/Adrian/Downloads/factoriolab_list(2).csv";
const defaultCatalogOutputPath = path.join(rootDir, "client", "src", "lib", "factoriolabRecipeCatalog.generated.ts");
const defaultMetadataOutputPath = path.join(rootDir, "client", "src", "lib", "factoriolabReference.generated.ts");
const factorioLabDataUrl = "https://raw.githubusercontent.com/factoriolab/factoriolab/main/src/data/dsp/data.json";

function parseCsv(text) {
  const rows = [];
  let row = [];
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

function parseQuantity(value) {
  const trimmed = String(value ?? "").trim().replace(/^=/, "");
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

function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function toDisplayName(value) {
  return String(value ?? "")
    .trim()
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseIoMap(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [itemName = "", quantityValue = "0"] = entry.split(":");
      return {
        itemKey: normalizeKey(itemName),
        displayName: toDisplayName(itemName),
        quantity: parseQuantity(quantityValue),
      };
    })
    .filter((entry) => entry.itemKey.length > 0 && entry.quantity > 0);
}

function buildCatalog(rows) {
  const sourceUrl = rows[0]?.length === 1 && /^https?:\/\//.test(rows[0][0]) ? rows[0][0].trim() : "";
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
  const recipeIndex = headerRow.indexOf("Recipe");
  const machinesIndex = headerRow.indexOf("Machines");
  const machineIndex = headerRow.indexOf("Machine");

  const recipes = rows.slice(headerRowIndex + 1).map((row) => {
    const itemKey = normalizeKey(row[itemIndex] ?? "");
    if (!itemKey) {
      return null;
    }

    return {
      itemKey,
      displayName: toDisplayName(row[itemIndex] ?? ""),
      throughputPerMinute: parseQuantity(row[itemsIndex] ?? ""),
      recipe: String(row[recipeIndex] ?? "").trim(),
      machineCount: parseQuantity(row[machinesIndex] ?? ""),
      machineLabel: String(row[machineIndex] ?? "").trim(),
      inputs: parseIoMap(row[inputsIndex] ?? ""),
      outputs: parseIoMap(row[outputsIndex] ?? ""),
    };
  }).filter((recipe) => recipe !== null);

  return { sourceUrl, recipes };
}

function serializeConst(name, value) {
  return `export const ${name} = ${JSON.stringify(value, null, 2)} as const;`;
}

const inputPath = process.argv[2] ?? defaultInputPath;
const catalogOutputPath = process.argv[3] ?? defaultCatalogOutputPath;
const metadataOutputPath = process.argv[4] ?? defaultMetadataOutputPath;

const csvText = await fs.readFile(inputPath, "utf8");
const rows = parseCsv(csvText);
const { sourceUrl, recipes } = buildCatalog(rows);

const factorioLabDataResponse = await fetch(factorioLabDataUrl);
if (!factorioLabDataResponse.ok) {
  throw new Error(`Failed to fetch FactorioLab DSP data: HTTP ${factorioLabDataResponse.status}`);
}

const factorioLabData = await factorioLabDataResponse.json();
const itemEntries = Object.values(factorioLabData.items ?? {});
const recipeEntries = Object.values(factorioLabData.recipes ?? {});
const productivityLimitations = new Set((factorioLabData.limitations?.productivity ?? []).map((entry) => normalizeKey(entry)));

const machineMetadataById = Object.fromEntries(
  itemEntries
    .filter((item) => item?.id && item?.machine)
    .map((item) => [
      item.id,
      {
        id: item.id,
        displayName: item.name ?? toDisplayName(item.id),
        speed: Number.isFinite(Number(item.machine.speed)) ? Number(item.machine.speed) : null,
        powerWatts: Number.isFinite(Number(item.machine.usage)) ? Number(item.machine.usage) * 1000 : null,
        moduleSlots: Number.isFinite(Number(item.machine.modules)) ? Number(item.machine.modules) : 0,
      },
    ]),
);

const recipeMetadataById = Object.fromEntries(
  recipeEntries
    .filter((recipe) => recipe?.id)
    .map((recipe) => [
      recipe.id,
      {
        id: recipe.id,
        displayName: recipe.name ?? toDisplayName(recipe.id),
        timeSeconds: Number.isFinite(Number(recipe.time)) ? Number(recipe.time) : null,
        supportsProductivity: productivityLimitations.has(normalizeKey(recipe.id)),
        inputs: Object.entries(recipe.in ?? {}).map(([itemKey, quantity]) => ({
          itemKey: normalizeKey(itemKey),
          displayName: toDisplayName(itemKey),
          quantity: Number(quantity),
        })),
        outputs: Object.entries(recipe.out ?? {}).map(([itemKey, quantity]) => ({
          itemKey: normalizeKey(itemKey),
          displayName: toDisplayName(itemKey),
          quantity: Number(quantity),
        })),
        producerIds: Array.isArray(recipe.producers) ? recipe.producers.map((producerId) => normalizeKey(producerId)) : [],
      },
    ]),
);

const catalogFileContents = `/* eslint-disable */
// Generated by scripts/import-factoriolab-recipes.mjs from ${JSON.stringify(inputPath)}
${serializeConst("FACTORIOLAB_RECIPE_SOURCE_URL", sourceUrl)}
${serializeConst("FACTORIOLAB_RECIPE_CATALOG", recipes)}
`;

const metadataFileContents = `/* eslint-disable */
// Generated by scripts/import-factoriolab-recipes.mjs using ${JSON.stringify(inputPath)} and ${JSON.stringify(factorioLabDataUrl)}
${serializeConst("FACTORIOLAB_DATA_SOURCE_URL", factorioLabDataUrl)}
${serializeConst("FACTORIOLAB_MACHINE_METADATA", machineMetadataById)}
${serializeConst("FACTORIOLAB_RECIPE_METADATA", recipeMetadataById)}
`;

await fs.writeFile(catalogOutputPath, catalogFileContents, "utf8");
await fs.writeFile(metadataOutputPath, metadataFileContents, "utf8");
console.log(`Wrote ${recipes.length} baseline recipes to ${catalogOutputPath}`);
console.log(`Wrote ${Object.keys(recipeMetadataById).length} clean recipes to ${metadataOutputPath}`);
