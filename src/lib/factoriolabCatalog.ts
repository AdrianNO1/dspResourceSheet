import { FACTORIOLAB_RECIPE_CATALOG } from "./factoriolabRecipeCatalog.generated";
import { FACTORIOLAB_MACHINE_METADATA, FACTORIOLAB_RECIPE_METADATA } from "./factoriolabReference.generated";
import type { ProjectImportedDependency, ProjectImportedItem } from "./types";

export type FactorioLabIoEntry = {
  itemKey: string;
  displayName: string;
  quantity: number;
};

export type FactorioLabReference = {
  recipeId: string;
  recipeName: string;
  inputs: FactorioLabIoEntry[];
  outputs: FactorioLabIoEntry[];
  baseCycleSeconds: number | null;
  machineLabel: string;
  machineDisplayName: string;
  machineSpeed: number | null;
  machinePowerWatts: number | null;
  supportsProductivity: boolean;
  primaryOutputQuantity: number;
};

export type InferredProliferatorMode = "none" | "extra-products" | "speedup" | "unknown";

export type InferredProliferatorUsage = {
  level: 0 | 1 | 2 | 3;
  mode: InferredProliferatorMode;
  energyMultiplier: number;
  speedMultiplier: number;
  outputMultiplier: number;
  outputBonusPerCycle: number;
  baseCycleSeconds: number | null;
  adjustedCycleSeconds: number | null;
  machineCountExpectation: number | null;
  relativeError: number | null;
};

type BaselineCatalogEntry = (typeof FACTORIOLAB_RECIPE_CATALOG)[number];
type MachineMetadataEntry = (typeof FACTORIOLAB_MACHINE_METADATA)[keyof typeof FACTORIOLAB_MACHINE_METADATA];
type RecipeMetadataEntry = (typeof FACTORIOLAB_RECIPE_METADATA)[keyof typeof FACTORIOLAB_RECIPE_METADATA];

const baselineByItemKey = new Map<string, BaselineCatalogEntry>(FACTORIOLAB_RECIPE_CATALOG.map((entry) => [entry.itemKey, entry]));
const machineMetadataById = new Map<string, MachineMetadataEntry>(
  Object.values(FACTORIOLAB_MACHINE_METADATA).map((entry) => [entry.id, entry]),
);
const recipeMetadataById = new Map<string, RecipeMetadataEntry>(
  Object.values(FACTORIOLAB_RECIPE_METADATA).map((entry) => [entry.id, entry]),
);

function normalizeKey(value: string) {
  return String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
}

const rawResourceAliases = new Map<string, string>([
  ["optical-grating-crystal", "Grating Crystal"],
  ["spiniform-stalagmite-crystal", "Stalagmite Crystal"],
  ["sulphuric-acid", "Sulfuric Acid"],
]);

function getCanonicalResourceReference(itemKey: string, displayName: string) {
  const canonicalDisplayName =
    rawResourceAliases.get(normalizeKey(itemKey)) ??
    rawResourceAliases.get(normalizeKey(displayName));

  if (!canonicalDisplayName) {
    return null;
  }

  return {
    itemKey: normalizeKey(canonicalDisplayName),
    displayName: canonicalDisplayName,
  };
}

function getDisplayName(value: string, fallback: string) {
  const displayName = value?.trim() || fallback;
  return getCanonicalResourceReference(displayName, displayName)?.displayName ?? displayName;
}

const proliferatorBonusByLevel: Record<number, { energyMultiplier: number; speedMultiplier: number; outputMultiplier: number }> = {
  0: { energyMultiplier: 1, speedMultiplier: 1, outputMultiplier: 1 },
  1: { energyMultiplier: 1.3, speedMultiplier: 1.25, outputMultiplier: 1.125 },
  2: { energyMultiplier: 1.7, speedMultiplier: 1.5, outputMultiplier: 1.2 },
  3: { energyMultiplier: 2.5, speedMultiplier: 2, outputMultiplier: 1.25 },
};

function getImportedItemProliferatorLevel(importedItem: ProjectImportedItem | null): 0 | 1 | 2 | 3 {
  if (!importedItem) {
    return 0;
  }

  if (importedItem.dependencies.some((dependency) => dependency.item_key === "proliferator-3")) {
    return 3;
  }
  if (importedItem.dependencies.some((dependency) => dependency.item_key === "proliferator-2")) {
    return 2;
  }
  if (importedItem.dependencies.some((dependency) => dependency.item_key === "proliferator-1")) {
    return 1;
  }
  return 0;
}

function getCandidateMachineCount(
  importedItem: ProjectImportedItem,
  reference: FactorioLabReference,
  speedMultiplier: number,
  outputMultiplier: number,
) {
  const throughputPerMinute = Number(importedItem.imported_throughput_per_minute);
  if (!(throughputPerMinute > 0)) {
    return null;
  }

  if (reference.baseCycleSeconds !== null && reference.machineSpeed && reference.primaryOutputQuantity > 0) {
    return (
      (throughputPerMinute * reference.baseCycleSeconds) /
      (60 * reference.machineSpeed * speedMultiplier * reference.primaryOutputQuantity * outputMultiplier)
    );
  }

  const baseline = baselineByItemKey.get(importedItem.item_key);
  if (!baseline || baseline.throughputPerMinute <= 0) {
    return null;
  }

  return (
    (Number(baseline.machineCount) * throughputPerMinute) /
    (Number(baseline.throughputPerMinute) * speedMultiplier * outputMultiplier)
  );
}

export function getFactorioLabReference(importedItem: ProjectImportedItem | null): FactorioLabReference | null {
  if (!importedItem) {
    return null;
  }

  const recipeId = normalizeKey(importedItem.recipe || importedItem.item_key);
  const recipe = recipeMetadataById.get(recipeId) ?? null;
  const machine = machineMetadataById.get(importedItem.machine_label) ?? null;
  if (!recipe) {
    return null;
  }

  const outputs = recipe.outputs.map((entry) => {
    const canonicalReference = getCanonicalResourceReference(entry.itemKey, entry.displayName);
    return {
      itemKey: canonicalReference?.itemKey ?? entry.itemKey,
      displayName: canonicalReference?.displayName ?? getDisplayName(entry.displayName, importedItem.display_name),
      quantity: Number(entry.quantity),
    };
  });
  const canonicalImportedItemKey =
    getCanonicalResourceReference(importedItem.item_key, importedItem.display_name)?.itemKey ?? importedItem.item_key;
  const primaryOutput = outputs.find((entry) => entry.itemKey === canonicalImportedItemKey) ?? outputs[0] ?? null;

  return {
    recipeId,
    recipeName: getDisplayName(recipe.displayName, importedItem.recipe || importedItem.display_name),
    inputs: recipe.inputs.map((entry) => {
      const canonicalReference = getCanonicalResourceReference(entry.itemKey, entry.displayName);
      return {
        itemKey: canonicalReference?.itemKey ?? entry.itemKey,
        displayName: canonicalReference?.displayName ?? getDisplayName(entry.displayName, entry.itemKey),
        quantity: Number(entry.quantity),
      };
    }),
    outputs,
    baseCycleSeconds: Number.isFinite(Number(recipe.timeSeconds)) ? Number(recipe.timeSeconds) : null,
    machineLabel: importedItem.machine_label,
    machineDisplayName: getDisplayName(machine?.displayName ?? "", importedItem.machine_label || "Imported machine"),
    machineSpeed: Number.isFinite(Number(machine?.speed)) ? Number(machine?.speed) : null,
    machinePowerWatts: Number.isFinite(Number(machine?.powerWatts)) ? Number(machine?.powerWatts) : null,
    supportsProductivity: Boolean(recipe.supportsProductivity),
    primaryOutputQuantity: primaryOutput?.quantity ?? 1,
  };
}

export function inferImportedItemProliferatorUsage(importedItem: ProjectImportedItem | null) : InferredProliferatorUsage | null {
  const reference = getFactorioLabReference(importedItem);
  if (!importedItem || !reference) {
    return null;
  }

  const actualMachineCount = Number(importedItem.machine_count);
  const level = getImportedItemProliferatorLevel(importedItem);
  const bonus = proliferatorBonusByLevel[level];

  if (!(actualMachineCount > 0)) {
    return {
      level,
      mode: level === 0 ? "none" : "unknown",
      energyMultiplier: bonus.energyMultiplier,
      speedMultiplier: level === 0 ? 1 : bonus.speedMultiplier,
      outputMultiplier: level === 0 ? 1 : bonus.outputMultiplier,
      outputBonusPerCycle: 0,
      baseCycleSeconds: reference.baseCycleSeconds,
      adjustedCycleSeconds:
        reference.baseCycleSeconds !== null && reference.machineSpeed
          ? reference.baseCycleSeconds / reference.machineSpeed
          : null,
      machineCountExpectation: null,
      relativeError: null,
    };
  }

  const candidates = [
    {
      mode: "none" as const,
      speedMultiplier: 1,
      outputMultiplier: 1,
      allowed: level === 0,
    },
    {
      mode: "extra-products" as const,
      speedMultiplier: 1,
      outputMultiplier: bonus.outputMultiplier,
      allowed: level > 0 && reference.supportsProductivity,
    },
    {
      mode: "speedup" as const,
      speedMultiplier: bonus.speedMultiplier,
      outputMultiplier: 1,
      allowed: level > 0,
    },
  ].filter((candidate) => candidate.allowed);

  if (candidates.length === 0) {
    return null;
  }

  const rankedCandidates = candidates
    .map((candidate) => {
      const expectedMachineCount = getCandidateMachineCount(importedItem, reference, candidate.speedMultiplier, candidate.outputMultiplier);
      const relativeError =
        expectedMachineCount && actualMachineCount > 0
          ? Math.abs(expectedMachineCount - actualMachineCount) / Math.max(actualMachineCount, expectedMachineCount, 1e-6)
          : Number.POSITIVE_INFINITY;
      return {
        ...candidate,
        expectedMachineCount,
        relativeError,
      };
    })
    .sort((left, right) => left.relativeError - right.relativeError);

  const bestCandidate = rankedCandidates[0];
  const mode =
    Number.isFinite(bestCandidate.relativeError) && bestCandidate.relativeError <= 0.12
      ? bestCandidate.mode
      : level === 0
        ? "none"
        : "unknown";

  const effectiveSpeedMultiplier = mode === "speedup" ? bestCandidate.speedMultiplier : 1;
  const effectiveOutputMultiplier = mode === "extra-products" ? bestCandidate.outputMultiplier : 1;

  return {
    level,
    mode,
    energyMultiplier: level > 0 ? bonus.energyMultiplier : 1,
    speedMultiplier: effectiveSpeedMultiplier,
    outputMultiplier: effectiveOutputMultiplier,
    outputBonusPerCycle: reference.primaryOutputQuantity * Math.max(0, effectiveOutputMultiplier - 1),
    baseCycleSeconds: reference.baseCycleSeconds,
    adjustedCycleSeconds:
      reference.baseCycleSeconds !== null && reference.machineSpeed
        ? reference.baseCycleSeconds / (reference.machineSpeed * effectiveSpeedMultiplier)
        : null,
    machineCountExpectation: bestCandidate.expectedMachineCount,
    relativeError: Number.isFinite(bestCandidate.relativeError) ? bestCandidate.relativeError : null,
  };
}

export function getImportedItemExpectedMachineCount(
  importedItem: ProjectImportedItem | null,
  throughputPerMinute?: number | null,
) {
  if (!importedItem) {
    return null;
  }

  const baselineThroughputPerMinute = Number(importedItem.imported_throughput_per_minute);
  if (!(baselineThroughputPerMinute > 0)) {
    return null;
  }

  const baselineMachineCount =
    inferImportedItemProliferatorUsage(importedItem)?.machineCountExpectation ??
    Number(importedItem.machine_count);
  if (!Number.isFinite(baselineMachineCount)) {
    return null;
  }

  const effectiveThroughputPerMinute =
    throughputPerMinute === undefined || throughputPerMinute === null
      ? baselineThroughputPerMinute
      : Number(throughputPerMinute);
  if (!(effectiveThroughputPerMinute > 0)) {
    return 0;
  }

  return baselineMachineCount * (effectiveThroughputPerMinute / baselineThroughputPerMinute);
}

export function getImportedItemDependencyDemandPerMinute(
  importedItem: ProjectImportedItem | null,
  dependencyItemKey: string,
): number | null {
  const reference = getFactorioLabReference(importedItem);
  if (!importedItem || !reference) {
    return null;
  }

  const input = reference.inputs.find((entry) => entry.itemKey === dependencyItemKey);
  if (!input || !(importedItem.imported_throughput_per_minute > 0) || !(reference.primaryOutputQuantity > 0)) {
    return null;
  }

  const proliferatorUsage = inferImportedItemProliferatorUsage(importedItem);
  const effectiveOutputMultiplier =
    proliferatorUsage?.mode === "extra-products" && proliferatorUsage.outputMultiplier > 0
      ? proliferatorUsage.outputMultiplier
      : 1;

  return (
    (Number(importedItem.imported_throughput_per_minute) * Number(input.quantity)) /
    (reference.primaryOutputQuantity * effectiveOutputMultiplier)
  );
}

export function getCanonicalImportedItemDependencies(
  importedItem: ProjectImportedItem | null,
): ProjectImportedDependency[] | null {
  const reference = getFactorioLabReference(importedItem);
  if (!importedItem || !reference) {
    return null;
  }

  const exactDependencyByKey = new Map(importedItem.dependencies.map((dependency) => [
    getCanonicalResourceReference(dependency.item_key, dependency.display_name)?.itemKey ?? dependency.item_key,
    dependency,
  ]));
  const remainingDependencies = [...importedItem.dependencies];
  const matchedDependencies = new Set<ProjectImportedDependency>();

  const takeMatchingDependency = (input: FactorioLabIoEntry) => {
    const exactMatch = exactDependencyByKey.get(input.itemKey);
    if (exactMatch) {
      matchedDependencies.add(exactMatch);
      return exactMatch;
    }

    const displayNameKey = normalizeKey(input.displayName);
    const aliasMatch = remainingDependencies.find((dependency) => normalizeKey(dependency.display_name) === displayNameKey);
    if (aliasMatch) {
      matchedDependencies.add(aliasMatch);
      return aliasMatch;
    }

    return null;
  };

  const canonicalRecipeDependencies = reference.inputs.map<ProjectImportedDependency>((input) => {
    const existingDependency = takeMatchingDependency(input);
    const canonicalReference = getCanonicalResourceReference(input.itemKey, input.displayName);
    const importedDemandPerMinute =
      getImportedItemDependencyDemandPerMinute(importedItem, input.itemKey) ??
      (
        reference.primaryOutputQuantity > 0
          ? (Number(importedItem.imported_throughput_per_minute) * Number(input.quantity)) / reference.primaryOutputQuantity
          : 0
      );
    const perUnitRatio =
      importedItem.imported_throughput_per_minute > 0
        ? importedDemandPerMinute / Number(importedItem.imported_throughput_per_minute)
        : (
          reference.primaryOutputQuantity > 0
            ? Number(input.quantity) / reference.primaryOutputQuantity
            : 0
        );

    return {
      item_key: canonicalReference?.itemKey ?? existingDependency?.item_key ?? input.itemKey,
      display_name: canonicalReference?.displayName ?? existingDependency?.display_name ?? getDisplayName(input.displayName, input.itemKey),
      dependency_type: existingDependency?.dependency_type ?? "crafted",
      per_unit_ratio: perUnitRatio,
      imported_demand_per_minute: importedDemandPerMinute,
    };
  });

  const preservedExtraDependencies = importedItem.dependencies
    .filter((dependency) => !matchedDependencies.has(dependency))
    .map((dependency) => ({
      item_key: dependency.item_key,
      display_name: dependency.display_name,
      dependency_type: dependency.dependency_type,
      per_unit_ratio: Number(dependency.per_unit_ratio),
      imported_demand_per_minute: Number(dependency.imported_demand_per_minute),
    }));

  return [...canonicalRecipeDependencies, ...preservedExtraDependencies];
}
