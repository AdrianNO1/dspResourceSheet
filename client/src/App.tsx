import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, DragEvent as ReactDragEvent, TextareaHTMLAttributes } from "react";
import "./App.css";
import { ResourceIcon } from "./components/ResourceIcon";
import { ResourceSelect } from "./components/ResourceSelect";
import { deleteBootstrap, exportSnapshot, getBootstrap, importSnapshot, patchBootstrap, postBootstrap } from "./lib/api";
import { parseClusterAddress, getSystemDistanceLy as getGeneratedSystemDistanceLy } from "./lib/dspCluster";
import { buildProductionDraftPreview, buildProductionPlanner } from "./lib/productionPlanner";
import type { ProductionItemSummary } from "./lib/productionPlanner";
import { resolveGameIconPath } from "./lib/gameIcons";
import { parseFactorioLabProjectCsv } from "./lib/projectImport";
import {
  getAdvancedMinerOutputPerMinute,
  getAdvancedMinerPowerMw,
  getItemsPerMinutePerVessel,
  getMultiSourceTransportPlan,
  getOilOutputPerSecond,
  getOrbitalCollectorTrueBoost,
  getPumpOutputPerMinute,
  getRegularMinerOutputPerMinute,
  getRequiredStations,
  getTargetStationsNeeded,
  getTransportRoundTripSeconds,
  OIL_EXTRACTOR_POWER_MW,
  PUMP_POWER_MW,
  REGULAR_MINER_POWER_MW,
} from "./lib/dspMath";
import type {
  BootstrapData,
  GasGiantOutput,
  GasGiantSite,
  MinerType,
  OilExtractor,
  OreVeinMiner,
  Planet,
  Project,
  ProjectGoal,
  ProjectImportedItem,
  ResourceDefinition,
  ResourceSummary,
  ResourceType,
  SystemDistance,
} from "./lib/types";

type MinerDraft = {
  minerType: MinerType;
  coveredNodes: number;
  advancedSpeedPercent: number;
};

type GasOutputDraft = {
  resourceId: string;
  ratePerSecond: number;
};

type SystemDistanceDraft = {
  systemAId: string;
  systemBId: string;
  distanceLy: number;
};

type ResourceOriginEntry = {
  planetId: string;
  systemId: string;
  supplyMetric: number;
  supplyPerMinute: number;
  supplyPerSecond: number;
  placementId: string;
};

type ResourceOriginBreakdownRow = {
  id: string;
  name: string;
  context: string;
  supplyMetric: number;
  supplyPerMinute: number;
  supplyPerSecond: number;
  placementCount: number;
  percentOfTotal: number;
};

type ResourceOriginTransportSource = {
  id: string;
  name: string;
  context: string;
  systemId: string;
  systemName: string;
  supplyMetric: number;
  supplyPerMinute: number;
  supplyPerSecond: number;
  placementCount: number;
};

type OverviewTransportSystemRow = {
  systemId: string;
  systemName: string;
  planetCount: number;
  supplyPerMinute: number;
};

type MapSelection = {
  scope: "system" | "planet";
  id: string;
};

type ExtractionRollupRow = {
  resourceId: string;
  name: string;
  type: ResourceType;
  iconUrl: string | null;
  colorStart: string;
  colorEnd: string;
  supplyMetric: number;
  supplyPerMinute: number;
  supplyPerSecond: number;
  placementCount: number;
};

type ExtractionActivityRow = {
  id: string;
  kind: "ore" | "liquid" | "oil" | "gas";
  title: string;
  detail: string;
  createdAt: string;
  planetId: string;
  planetName: string;
  systemId: string;
  systemName: string;
};

type ProductionTreeNode = {
  itemKey: string;
  summary: ProductionItemSummary;
  inputs: ProductionTreeInput[];
  usages: ProductionTreeUsage[];
};

type ProductionTreeInput = {
  itemKey: string;
  displayName: string;
  dependencyType: "raw" | "crafted";
  demandPerMinute: number;
  sharePercent: number;
  isSharedCrafted: boolean;
};

type ProductionTreeUsage = {
  itemKey: string;
  displayName: string;
  demandPerMinute: number;
  sharePercent: number;
};

function describeExtractionRollup(row: ExtractionRollupRow) {
  if (row.type === "ore_vein") {
    return `${formatValue(row.supplyMetric)} node eq | ${formatValue(row.supplyPerMinute)} / min`;
  }

  if (row.type === "liquid_pump") {
    return `${formatValue(row.supplyPerMinute)} / min`;
  }

  return `${formatValue(row.supplyPerSecond)} / sec | ${formatValue(row.supplyPerMinute)} / min`;
}

function getExtractionView(
  data: BootstrapData,
  planetIds: string[],
  oreMinerLookup: Record<string, OreVeinMiner[]>,
  gasOutputLookup: Record<string, GasGiantOutput[]>,
  resourceLookup: Map<string, ResourceDefinition>,
  planetLookup: Map<string, Planet>,
  systemLookup: Map<string, { id: string; name: string }>,
) {
  type ExtractionRollupRecord = Omit<ExtractionRollupRow, "placementCount"> & {
    placementIds: Set<string>;
  };

  const planetIdSet = new Set(planetIds);
  const rollups = new Map<string, ExtractionRollupRecord>();
  const activityRows: ExtractionActivityRow[] = [];

  function getPlanetContext(planetId: string) {
    const planet = planetLookup.get(planetId);
    if (!planet) {
      return null;
    }

    return {
      planet,
      planetName: planet.name,
      systemId: planet.solar_system_id,
      systemName: systemLookup.get(planet.solar_system_id)?.name ?? "Unknown System",
    };
  }

  function ensureRollup(resourceId: string) {
    const resource = resourceLookup.get(resourceId);
    if (!resource) {
      return null;
    }

    const existing = rollups.get(resourceId);
    if (existing) {
      return existing;
    }

    const created: ExtractionRollupRecord = {
      resourceId,
      name: resource.name,
      type: resource.type,
      iconUrl: resource.icon_url,
      colorStart: resource.color_start,
      colorEnd: resource.color_end,
      supplyMetric: 0,
      supplyPerMinute: 0,
      supplyPerSecond: 0,
      placementIds: new Set<string>(),
    };
    rollups.set(resourceId, created);
    return created;
  }

  for (const vein of data.oreVeins) {
    if (!planetIdSet.has(vein.planet_id)) {
      continue;
    }

    const context = getPlanetContext(vein.planet_id);
    if (!context) {
      continue;
    }

    const miners = oreMinerLookup[vein.id] ?? [];
    const supplyPerMinute = getOreVeinOutputPerMinute(miners, data.settings.miningSpeedPercent);
    const rollup = ensureRollup(vein.resource_id);

    if (rollup) {
      rollup.placementIds.add(vein.id);
      rollup.supplyPerMinute += supplyPerMinute;
      rollup.supplyPerSecond = rollup.supplyPerMinute / 60;
      rollup.supplyMetric = rollup.supplyPerMinute / 30;
    }

    activityRows.push({
      id: vein.id,
      kind: "ore",
      title: getResourceName(data.resources, vein.resource_id),
      detail: `${miners.length} ${miners.length === 1 ? "miner" : "miners"} | ${formatValue(supplyPerMinute)} ore/min | ${formatValue(supplyPerMinute / 30)} node eq`,
      createdAt: vein.created_at,
      planetId: context.planet.id,
      planetName: context.planetName,
      systemId: context.systemId,
      systemName: context.systemName,
    });
  }

  for (const site of data.liquidSites) {
    if (!planetIdSet.has(site.planet_id)) {
      continue;
    }

    const context = getPlanetContext(site.planet_id);
    if (!context) {
      continue;
    }

    const supplyPerMinute = getPumpOutputPerMinute(Number(site.pump_count), data.settings.miningSpeedPercent);
    const rollup = ensureRollup(site.resource_id);

    if (rollup) {
      rollup.placementIds.add(site.id);
      rollup.supplyPerMinute += supplyPerMinute;
      rollup.supplyPerSecond = rollup.supplyPerMinute / 60;
      rollup.supplyMetric = rollup.supplyPerMinute;
    }

    activityRows.push({
      id: site.id,
      kind: "liquid",
      title: getResourceName(data.resources, site.resource_id),
      detail: `${site.pump_count} ${site.pump_count === 1 ? "pump" : "pumps"} | ${formatValue(supplyPerMinute)} / min`,
      createdAt: site.created_at,
      planetId: context.planet.id,
      planetName: context.planetName,
      systemId: context.systemId,
      systemName: context.systemName,
    });
  }

  for (const extractor of data.oilExtractors) {
    if (!planetIdSet.has(extractor.planet_id)) {
      continue;
    }

    const context = getPlanetContext(extractor.planet_id);
    if (!context) {
      continue;
    }

    const supplyPerSecond = getOilOutputPerSecond(Number(extractor.oil_per_second));
    const supplyPerMinute = supplyPerSecond * 60;
    const rollup = ensureRollup(extractor.resource_id);

    if (rollup) {
      rollup.placementIds.add(extractor.id);
      rollup.supplyPerSecond += supplyPerSecond;
      rollup.supplyPerMinute = rollup.supplyPerSecond * 60;
      rollup.supplyMetric = rollup.supplyPerMinute;
    }

    activityRows.push({
      id: extractor.id,
      kind: "oil",
      title: getResourceName(data.resources, extractor.resource_id),
      detail: `${formatValue(supplyPerSecond)} / sec | ${formatValue(supplyPerMinute)} / min`,
      createdAt: extractor.created_at,
      planetId: context.planet.id,
      planetName: context.planetName,
      systemId: context.systemId,
      systemName: context.systemName,
    });
  }

  for (const site of data.gasGiantSites) {
    if (!planetIdSet.has(site.planet_id)) {
      continue;
    }

    const context = getPlanetContext(site.planet_id);
    if (!context) {
      continue;
    }

    const outputs = gasOutputLookup[site.id] ?? [];
    const trueBoost = getOrbitalCollectorTrueBoost(
      outputs.map((output) => ({
        ratePerSecond: Number(output.rate_per_second),
        fuelValueMj: Number(resourceLookup.get(output.resource_id)?.fuel_value_mj ?? 0),
      })),
      data.settings.miningSpeedPercent,
    );

    for (const output of outputs) {
      const rollup = ensureRollup(output.resource_id);
      if (!rollup) {
        continue;
      }

      rollup.placementIds.add(site.id);
      rollup.supplyPerSecond += Number(output.rate_per_second) * trueBoost * Number(site.collector_count);
      rollup.supplyPerMinute = rollup.supplyPerSecond * 60;
      rollup.supplyMetric = rollup.supplyPerMinute;
    }

    activityRows.push({
      id: site.id,
      kind: "gas",
      title: "Collector ring",
      detail: outputs.length > 0
        ? `${site.collector_count} collectors | ${outputs
            .map(
              (output) =>
                `${getResourceName(data.resources, output.resource_id)} ${formatValue(
                  output.rate_per_second * trueBoost * site.collector_count * 60,
                )}/min`,
            )
            .join(" | ")}`
        : `${site.collector_count} collectors | No outputs configured`,
      createdAt: site.created_at,
      planetId: context.planet.id,
      planetName: context.planetName,
      systemId: context.systemId,
      systemName: context.systemName,
    });
  }

  const resourceRows = Array.from(rollups.values())
    .map<ExtractionRollupRow>((row) => ({
      resourceId: row.resourceId,
      name: row.name,
      type: row.type,
      iconUrl: row.iconUrl,
      colorStart: row.colorStart,
      colorEnd: row.colorEnd,
      supplyMetric: row.supplyMetric,
      supplyPerMinute: row.supplyPerMinute,
      supplyPerSecond: row.supplyPerSecond,
      placementCount: row.placementIds.size,
    }))
    .sort((left, right) => right.supplyMetric - left.supplyMetric || left.name.localeCompare(right.name));

  activityRows.sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime() ||
      left.title.localeCompare(right.title),
  );

  return {
    resourceRows,
    activityRows,
  };
}

function getBreakdownSecondaryText(summary: ResourceSummary, row: ResourceOriginBreakdownRow) {
  if (summary.type === "liquid_pump") {
    return `${formatValue(row.supplyPerMinute)} / min`;
  }

  return `${formatValue(row.supplyPerSecond)} / sec | ${formatValue(row.supplyPerMinute)} / min`;
}

function getResourceOriginEntries(
  data: BootstrapData,
  summary: ResourceSummary,
  oreMinerLookup: Record<string, OreVeinMiner[]>,
  gasOutputLookup: Record<string, GasGiantOutput[]>,
  resourceLookup: Map<string, ResourceDefinition>,
  planetLookup: Map<string, Planet>,
) {
  const originEntries: ResourceOriginEntry[] = [];

  for (const vein of data.oreVeins) {
    if (vein.resource_id !== summary.resourceId) {
      continue;
    }

    const planet = planetLookup.get(vein.planet_id);
    if (!planet) {
      continue;
    }

    const supplyPerMinute = getOreVeinOutputPerMinute(
      oreMinerLookup[vein.id] ?? [],
      data.settings.miningSpeedPercent,
    );

    if (supplyPerMinute <= 0) {
      continue;
    }

    originEntries.push({
      planetId: planet.id,
      systemId: planet.solar_system_id,
      supplyMetric: supplyPerMinute / 30,
      supplyPerMinute,
      supplyPerSecond: supplyPerMinute / 60,
      placementId: vein.id,
    });
  }

  for (const site of data.liquidSites) {
    if (site.resource_id !== summary.resourceId) {
      continue;
    }

    const planet = planetLookup.get(site.planet_id);
    if (!planet) {
      continue;
    }

    const supplyPerMinute = getPumpOutputPerMinute(
      Number(site.pump_count),
      data.settings.miningSpeedPercent,
    );

    if (supplyPerMinute <= 0) {
      continue;
    }

    originEntries.push({
      planetId: planet.id,
      systemId: planet.solar_system_id,
      supplyMetric: supplyPerMinute,
      supplyPerMinute,
      supplyPerSecond: supplyPerMinute / 60,
      placementId: site.id,
    });
  }

  for (const extractor of data.oilExtractors) {
    if (extractor.resource_id !== summary.resourceId) {
      continue;
    }

    const planet = planetLookup.get(extractor.planet_id);
    if (!planet) {
      continue;
    }

    const supplyPerSecond = getOilOutputPerSecond(Number(extractor.oil_per_second));
    const supplyPerMinute = supplyPerSecond * 60;

    if (supplyPerMinute <= 0) {
      continue;
    }

    originEntries.push({
      planetId: planet.id,
      systemId: planet.solar_system_id,
      supplyMetric: supplyPerMinute,
      supplyPerMinute,
      supplyPerSecond,
      placementId: extractor.id,
    });
  }

  for (const site of data.gasGiantSites) {
    const planet = planetLookup.get(site.planet_id);
    if (!planet) {
      continue;
    }

    const outputs = gasOutputLookup[site.id] ?? [];
    const trueBoost = getOrbitalCollectorTrueBoost(
      outputs.map((output) => ({
        ratePerSecond: Number(output.rate_per_second),
        fuelValueMj: Number(resourceLookup.get(output.resource_id)?.fuel_value_mj ?? 0),
      })),
      data.settings.miningSpeedPercent,
    );

    for (const output of outputs) {
      if (output.resource_id !== summary.resourceId) {
        continue;
      }

      const supplyPerSecond = Number(output.rate_per_second) * trueBoost * Number(site.collector_count);
      const supplyPerMinute = supplyPerSecond * 60;

      if (supplyPerMinute <= 0) {
        continue;
      }

      originEntries.push({
        planetId: planet.id,
        systemId: planet.solar_system_id,
        supplyMetric: supplyPerMinute,
        supplyPerMinute,
        supplyPerSecond,
        placementId: site.id,
      });
    }
  }

  return originEntries;
}

function getResourceOriginBreakdown(
  data: BootstrapData,
  summary: ResourceSummary,
  oreMinerLookup: Record<string, OreVeinMiner[]>,
  gasOutputLookup: Record<string, GasGiantOutput[]>,
  resourceLookup: Map<string, ResourceDefinition>,
  planetLookup: Map<string, Planet>,
  systemLookup: Map<string, { id: string; name: string }>,
) {
  const originEntries = getResourceOriginEntries(
    data,
    summary,
    oreMinerLookup,
    gasOutputLookup,
    resourceLookup,
    planetLookup,
  );
  const totalMetric = summary.supplyMetric;

  type AggregateRecord = {
    id: string;
    name: string;
    context: string;
    supplyMetric: number;
    supplyPerMinute: number;
    supplyPerSecond: number;
    placementIds: Set<string>;
  };

  const systemAggregates = new Map<string, AggregateRecord>();
  const planetAggregates = new Map<string, AggregateRecord>();

  for (const entry of originEntries) {
    const systemName = systemLookup.get(entry.systemId)?.name ?? "Unknown System";
    const planet = planetLookup.get(entry.planetId);
    const planetName = planet?.name ?? "Unknown Planet";
    const planetContext = planet?.planet_type === "gas_giant" ? `${systemName} | gas giant` : systemName;

    const systemAggregate = systemAggregates.get(entry.systemId) ?? {
      id: entry.systemId,
      name: systemName,
      context: "",
      supplyMetric: 0,
      supplyPerMinute: 0,
      supplyPerSecond: 0,
      placementIds: new Set<string>(),
    };
    systemAggregate.supplyMetric += entry.supplyMetric;
    systemAggregate.supplyPerMinute += entry.supplyPerMinute;
    systemAggregate.supplyPerSecond += entry.supplyPerSecond;
    systemAggregate.placementIds.add(entry.placementId);
    systemAggregates.set(entry.systemId, systemAggregate);

    const planetAggregate = planetAggregates.get(entry.planetId) ?? {
      id: entry.planetId,
      name: planetName,
      context: planetContext,
      supplyMetric: 0,
      supplyPerMinute: 0,
      supplyPerSecond: 0,
      placementIds: new Set<string>(),
    };
    planetAggregate.supplyMetric += entry.supplyMetric;
    planetAggregate.supplyPerMinute += entry.supplyPerMinute;
    planetAggregate.supplyPerSecond += entry.supplyPerSecond;
    planetAggregate.placementIds.add(entry.placementId);
    planetAggregates.set(entry.planetId, planetAggregate);
  }

  function finalizeRows(aggregates: Map<string, AggregateRecord>) {
    return Array.from(aggregates.values())
      .map<ResourceOriginBreakdownRow>((aggregate) => ({
        id: aggregate.id,
        name: aggregate.name,
        context: aggregate.context,
        supplyMetric: aggregate.supplyMetric,
        supplyPerMinute: aggregate.supplyPerMinute,
        supplyPerSecond: aggregate.supplyPerSecond,
        placementCount: aggregate.placementIds.size,
        percentOfTotal: totalMetric > 0 ? (aggregate.supplyMetric / totalMetric) * 100 : 0,
      }))
      .sort((left, right) => right.supplyMetric - left.supplyMetric || left.name.localeCompare(right.name));
  }

  return {
    systems: finalizeRows(systemAggregates),
    planets: finalizeRows(planetAggregates),
  };
}

function getResourceOriginTransportSources(
  data: BootstrapData,
  summary: ResourceSummary,
  oreMinerLookup: Record<string, OreVeinMiner[]>,
  gasOutputLookup: Record<string, GasGiantOutput[]>,
  resourceLookup: Map<string, ResourceDefinition>,
  planetLookup: Map<string, Planet>,
  systemLookup: Map<string, { id: string; name: string }>,
) {
  const originEntries = getResourceOriginEntries(
    data,
    summary,
    oreMinerLookup,
    gasOutputLookup,
    resourceLookup,
    planetLookup,
  );

  const aggregates = new Map<
    string,
    Omit<ResourceOriginTransportSource, "placementCount"> & {
      placementIds: Set<string>;
    }
  >();

  for (const entry of originEntries) {
    const planet = planetLookup.get(entry.planetId);
    if (!planet) {
      continue;
    }

    const systemName = systemLookup.get(entry.systemId)?.name ?? "Unknown System";
    const context = planet.planet_type === "gas_giant" ? `${systemName} | gas giant` : systemName;
    const aggregate = aggregates.get(entry.planetId) ?? {
      id: entry.planetId,
      name: planet.name,
      context,
      systemId: entry.systemId,
      systemName,
      supplyMetric: 0,
      supplyPerMinute: 0,
      supplyPerSecond: 0,
      placementIds: new Set<string>(),
    };

    aggregate.supplyMetric += entry.supplyMetric;
    aggregate.supplyPerMinute += entry.supplyPerMinute;
    aggregate.supplyPerSecond += entry.supplyPerSecond;
    aggregate.placementIds.add(entry.placementId);
    aggregates.set(entry.planetId, aggregate);
  }

  return Array.from(aggregates.values())
    .map<ResourceOriginTransportSource>((aggregate) => ({
      id: aggregate.id,
      name: aggregate.name,
      context: aggregate.context,
      systemId: aggregate.systemId,
      systemName: aggregate.systemName,
      supplyMetric: aggregate.supplyMetric,
      supplyPerMinute: aggregate.supplyPerMinute,
      supplyPerSecond: aggregate.supplyPerSecond,
      placementCount: aggregate.placementIds.size,
    }))
    .sort((left, right) => right.supplyPerMinute - left.supplyPerMinute || left.name.localeCompare(right.name));
}

function formatValue(value: number, digits = 1) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: value % 1 === 0 ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatFixedValue(value: number, digits = 1) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatRoundedUpInteger(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.ceil(value - 1e-9)));
}

function buildProductionTree(craftedItems: ProjectImportedItem[], projectItems: ProjectImportedItem[], summaries: ProductionItemSummary[]) {
  const summaryByKey = new Map(summaries.map((summary) => [summary.itemKey, summary]));
  const itemByKey = new Map(craftedItems.map((item) => [item.item_key, item]));
  const totalTargetByKey = new Map(projectItems.map((item) => [item.item_key, Number(item.imported_throughput_per_minute)]));
  const parentKeysByChild = new Map<string, string[]>();

  const compareKeys = (leftKey: string, rightKey: string) => {
    const left = itemByKey.get(leftKey);
    const right = itemByKey.get(rightKey);
    return (
      Number(left?.sort_order ?? Number.MAX_SAFE_INTEGER) - Number(right?.sort_order ?? Number.MAX_SAFE_INTEGER) ||
      (left?.display_name ?? leftKey).localeCompare(right?.display_name ?? rightKey)
    );
  };

  function isProliferator(value: string) {
    return value.toLowerCase().includes("proliferator");
  }

  for (const item of craftedItems) {
    parentKeysByChild.set(item.item_key, []);
  }

  for (const item of craftedItems) {
    const dependencyKeys = Array.from(new Set(
      item.dependencies
        .filter((dependency) => dependency.dependency_type === "crafted" && itemByKey.has(dependency.item_key))
        .map((dependency) => dependency.item_key),
    )).sort(compareKeys);

    for (const dependencyKey of dependencyKeys) {
      const parents = parentKeysByChild.get(dependencyKey) ?? [];
      parents.push(item.item_key);
      parentKeysByChild.set(dependencyKey, parents.sort(compareKeys));
    }
  }

  const nodesByKey = new Map<string, ProductionTreeNode>();
  const allKeys = craftedItems.map((item) => item.item_key).sort(compareKeys);
  for (const itemKey of allKeys) {
    const summary = summaryByKey.get(itemKey);
    if (!summary) {
      continue;
    }

    const item = itemByKey.get(itemKey);
    if (!item) {
      continue;
    }

    const inputs = item.dependencies
      .filter((dependency) => {
        if (dependency.dependency_type !== "crafted") {
          return true;
        }

        if (isProliferator(dependency.display_name) && !isProliferator(item.display_name)) {
          return false;
        }

        return itemByKey.has(dependency.item_key);
      })
      .map<ProductionTreeInput>((dependency) => {
        const totalTarget = totalTargetByKey.get(dependency.item_key) ?? 0;
        const parentCount = dependency.dependency_type === "crafted"
          ? (parentKeysByChild.get(dependency.item_key)?.length ?? 0)
          : 0;
        return {
          itemKey: dependency.item_key,
          displayName: dependency.display_name,
          dependencyType: dependency.dependency_type,
          demandPerMinute: dependency.imported_demand_per_minute,
          sharePercent: totalTarget > 0 ? Math.min(100, (dependency.imported_demand_per_minute / totalTarget) * 100) : 0,
          isSharedCrafted: dependency.dependency_type === "crafted" && parentCount > 1,
        };
      })
      .sort((left, right) => right.demandPerMinute - left.demandPerMinute || left.displayName.localeCompare(right.displayName));

    const usages = (parentKeysByChild.get(itemKey) ?? [])
      .map<ProductionTreeUsage | null>((parentKey) => {
        const parentItem = itemByKey.get(parentKey);
        if (!parentItem) {
          return null;
        }

        const dependency = parentItem.dependencies.find((entry) => entry.item_key === itemKey);
        if (!dependency) {
          return null;
        }

        const totalTarget = totalTargetByKey.get(itemKey) ?? 0;
        return {
          itemKey: parentKey,
          displayName: parentItem.display_name,
          demandPerMinute: dependency.imported_demand_per_minute,
          sharePercent: totalTarget > 0 ? Math.min(100, (dependency.imported_demand_per_minute / totalTarget) * 100) : 0,
        };
      })
      .filter((entry): entry is ProductionTreeUsage => entry !== null)
      .sort((left, right) => right.demandPerMinute - left.demandPerMinute || left.displayName.localeCompare(right.displayName));

    nodesByKey.set(itemKey, {
      itemKey,
      summary,
      inputs,
      usages,
    });
  }

  const rootKeys = allKeys.filter((itemKey) => {
    const parentCount = parentKeysByChild.get(itemKey)?.length ?? 0;
    return parentCount !== 1;
  });

  return {
    rootKeys: rootKeys.length > 0 ? rootKeys : allKeys,
    nodesByKey,
  };
}

function toProjectGoalMap(projectGoals: ProjectGoal[], projectId: string) {
  return projectGoals.reduce<Record<string, number>>((acc, goal) => {
    if (goal.project_id === projectId) {
      acc[goal.resource_id] = Number(goal.quantity);
    }
    return acc;
  }, {});
}

function getResourceName(resources: ResourceDefinition[], resourceId: string) {
  return resources.find((resource) => resource.id === resourceId)?.name ?? "Unknown Resource";
}

function getCurrentPlanet(data: BootstrapData | null) {
  return data?.planets.find((planet) => planet.id === data.settings.currentPlanetId) ?? null;
}

function getCurrentSystemPlanets(data: BootstrapData | null) {
  if (!data?.settings.currentSolarSystemId) {
    return [];
  }

  return data.planets.filter((planet) => planet.solar_system_id === data.settings.currentSolarSystemId);
}

function describePlanet(planet: Planet) {
  return planet.planet_type === "gas_giant" ? `${planet.name} | Gas giant` : planet.name;
}

function buildPlanetNamePrefix(systemName: string) {
  return `${systemName} `.replace(/\s{2,}/g, " ");
}

function normalizePlanetName(name: string) {
  return name.replace(/\s{2,}/g, " ").trim();
}

function getLatestPlanetActivity(data: BootstrapData) {
  const latestByPlanetId = new Map<string, number>();

  const mark = (planetId: string, createdAt: string) => {
    const timestamp = new Date(createdAt).getTime();
    const current = latestByPlanetId.get(planetId) ?? 0;
    if (timestamp > current) {
      latestByPlanetId.set(planetId, timestamp);
    }
  };

  for (const vein of data.oreVeins) {
    mark(vein.planet_id, vein.created_at);
  }

  for (const site of data.liquidSites) {
    mark(site.planet_id, site.created_at);
  }

  for (const site of data.oilExtractors) {
    mark(site.planet_id, site.created_at);
  }

  for (const site of data.gasGiantSites) {
    mark(site.planet_id, site.created_at);
  }

  return latestByPlanetId;
}

function sortResources(resources: ResourceDefinition[], type: ResourceType) {
  return resources
    .filter((resource) => resource.type === type)
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name));
}

function getProgressPercent(summary: ResourceSummary) {
  const targetPerMinute = getSummaryTargetPerMinute(summary);
  if (targetPerMinute <= 0) {
    return 0;
  }

  return Math.min(100, (summary.supplyPerMinute / targetPerMinute) * 100);
}

function getSummaryTargetPerMinute(summary: ResourceSummary) {
  if (summary.goalQuantity <= 0) {
    return 0;
  }

  return summary.type === "ore_vein" ? summary.goalQuantity * 30 : summary.goalQuantity;
}

function getDefaultGasOutputs(resources: ResourceDefinition[]) {
  const hydrogen = resources.find((resource) => resource.name === "Hydrogen");
  const deuterium = resources.find((resource) => resource.name === "Deuterium");
  const defaults = [hydrogen, deuterium].filter((resource): resource is ResourceDefinition => resource !== undefined);

  if (defaults.length >= 2) {
    return defaults.slice(0, 2).map((resource) => ({
      resourceId: resource.id,
      ratePerSecond: 1,
    }));
  }

  if (resources.length >= 2) {
    return resources.slice(0, 2).map((resource) => ({
      resourceId: resource.id,
      ratePerSecond: 1,
    }));
  }

  if (resources[0]) {
    return [
      {
        resourceId: resources[0].id,
        ratePerSecond: 1,
      },
    ];
  }

  return [
    { resourceId: "", ratePerSecond: 1 },
    { resourceId: "", ratePerSecond: 1 },
  ];
}

function getOreVeinOutputPerMinute(miners: OreVeinMiner[], miningSpeedPercent: number) {
  return miners.reduce((sum, miner) => {
    if (miner.miner_type === "advanced") {
      return (
        sum +
        getAdvancedMinerOutputPerMinute(
          Number(miner.covered_nodes),
          Number(miner.advanced_speed_percent ?? 100),
          miningSpeedPercent,
        )
      );
    }

    return sum + getRegularMinerOutputPerMinute(Number(miner.covered_nodes), miningSpeedPercent);
  }, 0);
}

function getDraftOreOutputPerMinute(miners: MinerDraft[], miningSpeedPercent: number) {
  return miners.reduce((sum, miner) => {
    if (miner.minerType === "advanced") {
      return sum + getAdvancedMinerOutputPerMinute(miner.coveredNodes, miner.advancedSpeedPercent, miningSpeedPercent);
    }

    return sum + getRegularMinerOutputPerMinute(miner.coveredNodes, miningSpeedPercent);
  }, 0);
}

function formatCurrentWithPending(current: number, pending: number) {
  if (pending <= 0) {
    return formatValue(current);
  }

  return `${formatValue(current)} + ${formatValue(pending)}`;
}

function MachinePill({ label, variant }: { label: string; variant: "advanced" | "regular" | "pump" | "gas" | "oil" }) {
  return <span className={`machine-pill machine-pill-${variant}`}>{label}</span>;
}

function AutoGrowTextarea({ onChange, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [props.value]);

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    event.currentTarget.style.height = "0px";
    event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`;
    onChange?.(event);
  }

  return <textarea {...props} ref={textareaRef} onChange={handleChange} />;
}

type FileDropInputProps = {
  accept: string;
  description: string;
  disabled?: boolean;
  label: string;
  onSelect: (file: File | undefined) => void;
};

function FileDropInput({ accept, description, disabled = false, label, onSelect }: FileDropInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  function handleFiles(fileList: FileList | null) {
    const file = fileList?.[0];
    onSelect(file);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  function handleDragOver(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!disabled) {
      setIsDragging(true);
    }
  }

  function handleDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) {
      return;
    }

    handleFiles(event.dataTransfer.files);
  }

  return (
    <div
      className={`file-drop ${isDragging ? "file-drop-active" : ""} ${disabled ? "file-drop-disabled" : ""}`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(event) => handleFiles(event.target.files)}
      />
      <button
        type="button"
        className="file-drop-surface"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
      >
        <span className="file-drop-kicker">{label}</span>
        <strong className="file-drop-title">Drop a file here</strong>
        <p className="file-drop-description">{description}</p>
        <span className="file-drop-action">Browse files</span>
      </button>
    </div>
  );
}

function App() {
  const overviewTransportDistanceSaveTimersRef = useRef<Record<string, number>>({});
  const [data, setData] = useState<BootstrapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeView, setActiveView] = useState<"log" | "overview" | "raw" | "map" | "production" | "projects" | "settings">("log");
  const [showAllLedger, setShowAllLedger] = useState(true);
  const [selectedOverviewResourceId, setSelectedOverviewResourceId] = useState("");
  const [isOverviewTransportModalOpen, setIsOverviewTransportModalOpen] = useState(false);
  const [overviewTransportTargetSystemId, setOverviewTransportTargetSystemId] = useState("");
  const [overviewTransportThroughputPerMinute, setOverviewTransportThroughputPerMinute] = useState(0);
  const [overviewTransportDistanceDrafts, setOverviewTransportDistanceDrafts] = useState<Record<string, number>>({});
  const [selectedProjectId, setSelectedProjectId] = useState(() => window.localStorage.getItem("dsp-resource-sheet:selected-project-id") ?? "");
  const [selectedProductionItemKey, setSelectedProductionItemKey] = useState("");
  const [expandedProductionItemKeys, setExpandedProductionItemKeys] = useState<Record<string, boolean>>({});
  const [selectedMapSelection, setSelectedMapSelection] = useState<MapSelection>({ scope: "system", id: "" });
  const [clusterAddressDraft, setClusterAddressDraft] = useState("");
  const [planetExtractionIlsDrafts, setPlanetExtractionIlsDrafts] = useState<Record<string, string>>({});
  const [isProductionModalOpen, setIsProductionModalOpen] = useState(false);

  const [newSystemName, setNewSystemName] = useState("");
  const [newPlanetName, setNewPlanetName] = useState("");
  const [newPlanetType, setNewPlanetType] = useState<"solid" | "gas_giant">("solid");
  const [systemNameDrafts, setSystemNameDrafts] = useState<Record<string, string>>({});
  const [planetNameDrafts, setPlanetNameDrafts] = useState<Record<string, string>>({});
  const [newResourceName, setNewResourceName] = useState("");
  const [newResourceType, setNewResourceType] = useState<ResourceType>("ore_vein");
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [projectNotesDraft, setProjectNotesDraft] = useState("");
  const [projectActiveDraft, setProjectActiveDraft] = useState(true);
  const [goalDrafts, setGoalDrafts] = useState<Record<string, number>>({});
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectNotes, setNewProjectNotes] = useState("");
  const [editingEntryKey, setEditingEntryKey] = useState("");
  const [entryLocationDraft, setEntryLocationDraft] = useState({ systemId: "", planetId: "" });
  const [lastMoveTargets, setLastMoveTargets] = useState<Record<"solid" | "gas_giant", { systemId: string; planetId: string }>>({
    solid: { systemId: "", planetId: "" },
    gas_giant: { systemId: "", planetId: "" },
  });

  const [oreResourceId, setOreResourceId] = useState("");
  const [oreMiners, setOreMiners] = useState<MinerDraft[]>([
    { minerType: "advanced", coveredNodes: 15, advancedSpeedPercent: 100 },
  ]);

  const [liquidResourceId, setLiquidResourceId] = useState("");
  const [pumpCount, setPumpCount] = useState(0);

  const [oilResourceId, setOilResourceId] = useState("");
  const [oilPerSecond, setOilPerSecond] = useState(0);

  const [collectorCount, setCollectorCount] = useState(40);
  const [gasOutputs, setGasOutputs] = useState<GasOutputDraft[]>([
    { resourceId: "", ratePerSecond: 1 },
    { resourceId: "", ratePerSecond: 1 },
  ]);
  const [quickCalcDistanceLy, setQuickCalcDistanceLy] = useState(0);
  const [quickCalcThroughputPerMinute, setQuickCalcThroughputPerMinute] = useState(0);
  const [distanceDraft, setDistanceDraft] = useState<SystemDistanceDraft>({
    systemAId: "",
    systemBId: "",
    distanceLy: 0,
  });
  const [editingDistanceId, setEditingDistanceId] = useState("");
  const [editingDistanceDraft, setEditingDistanceDraft] = useState<SystemDistanceDraft>({
    systemAId: "",
    systemBId: "",
    distanceLy: 0,
  });
  const [productionDraft, setProductionDraft] = useState({
    itemKey: "",
    throughputPerMinute: 0,
    outboundIlsCount: 0,
    isFinished: true,
    solarSystemId: "",
    planetId: "",
  });

  async function refreshBootstrap() {
    setLoading(true);

    try {
      const nextData = await getBootstrap();
      setData(nextData);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load the app.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshBootstrap();
  }, []);

  useEffect(() => {
    if (!data) {
      return;
    }

    if (!selectedProjectId || !data.projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(data.projects[0]?.id ?? "");
    }
  }, [data, selectedProjectId]);

  useEffect(() => {
    if (selectedProjectId) {
      window.localStorage.setItem("dsp-resource-sheet:selected-project-id", selectedProjectId);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (!data) {
      return;
    }

    const oreResources = sortResources(data.resources, "ore_vein");
    const liquidResources = sortResources(data.resources, "liquid_pump");
    const oilResources = sortResources(data.resources, "oil_extractor");
    const gasResources = sortResources(data.resources, "gas_giant_output");

    if (!oreResourceId && oreResources[0]) {
      setOreResourceId(oreResources[0].id);
    }

    if (!liquidResourceId && liquidResources[0]) {
      setLiquidResourceId(liquidResources[0].id);
    }

    if (!oilResourceId && oilResources[0]) {
      setOilResourceId(oilResources[0].id);
    }

    if (gasResources.length > 0 && gasOutputs.every((output) => !output.resourceId)) {
      setGasOutputs(getDefaultGasOutputs(gasResources));
    }
    if (!distanceDraft.systemAId && data.solarSystems[0]) {
      setDistanceDraft((current) => ({
        ...current,
        systemAId: data.solarSystems[0]?.id ?? "",
        systemBId: current.systemBId || data.solarSystems[1]?.id || "",
      }));
    }

  }, [data, distanceDraft.systemAId, gasOutputs, liquidResourceId, oilResourceId, oreResourceId]);

  useEffect(() => {
    if (!data || !selectedProjectId) {
      return;
    }

    const selectedProject = data.projects.find((project) => project.id === selectedProjectId);
    if (!selectedProject) {
      return;
    }

    setProjectNameDraft(selectedProject.name);
    setProjectNotesDraft(selectedProject.notes);
    setProjectActiveDraft(selectedProject.is_active === 1);
    setGoalDrafts(toProjectGoalMap(data.projectGoals, selectedProjectId));
  }, [data, selectedProjectId]);

  useEffect(() => {
    if (!data) {
      return;
    }

    setClusterAddressDraft(data.settings.clusterAddress ?? "");
    setPlanetExtractionIlsDrafts(
      data.planets.reduce<Record<string, string>>((acc, planet) => {
        acc[planet.id] = planet.extraction_outbound_ils_count === null ? "" : String(planet.extraction_outbound_ils_count);
        return acc;
      }, {}),
    );
  }, [data]);

  useEffect(() => {
    if (!data || !selectedProjectId) {
      setSelectedProductionItemKey("");
      return;
    }

    const projectItems = data.projectImportedItems.filter((item) => item.project_id === selectedProjectId);
    if (!projectItems.some((item) => item.item_key === selectedProductionItemKey)) {
      setSelectedProductionItemKey(projectItems[0]?.item_key ?? "");
    }
  }, [data, selectedProjectId, selectedProductionItemKey]);

  useEffect(() => {
    setExpandedProductionItemKeys({});
  }, [selectedProjectId]);

  useEffect(() => {
    if (!data || !selectedProjectId) {
      return;
    }

    const latestSite = data.productionSites
      .filter((site) => site.project_id === selectedProjectId)
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())[0];
    const defaultSystemId = latestSite?.solar_system_id ?? data.settings.currentSolarSystemId ?? data.solarSystems[0]?.id ?? "";
    const defaultPlanetId =
      latestSite?.planet_id ??
      data.settings.currentPlanetId ??
      data.planets.find((planet) => planet.solar_system_id === defaultSystemId && planet.planet_type === "solid")?.id ??
      "";

    setProductionDraft((current) => {
      const projectItems = data.projectImportedItems.filter((item) => item.project_id === selectedProjectId);
      const nextItemKey = current.itemKey || projectItems[0]?.item_key || "";
      const nextTemplate = projectItems.find((item) => item.item_key === nextItemKey) ?? null;
      return {
        ...current,
        itemKey: nextItemKey,
        throughputPerMinute:
          current.throughputPerMinute > 0
            ? current.throughputPerMinute
            : Number(nextTemplate?.imported_throughput_per_minute ?? 0),
        solarSystemId: current.solarSystemId || defaultSystemId,
        planetId: current.planetId || defaultPlanetId,
      };
    });
  }, [data, selectedProjectId]);

  useEffect(() => {
    if (!data || !selectedOverviewResourceId) {
      return;
    }

    const visibleResourceIds = new Set(
      data.summary.resourceSummaries
        .filter((summary) => summary.goalQuantity > 0 || summary.supplyMetric > 0)
        .map((summary) => summary.resourceId),
    );

    if (!visibleResourceIds.has(selectedOverviewResourceId)) {
      setSelectedOverviewResourceId("");
    }
  }, [data, selectedOverviewResourceId]);

  useEffect(() => {
    if (!isOverviewTransportModalOpen) {
      return;
    }

    const selectedOverviewSummary =
      data?.summary.resourceSummaries.find((summary) => summary.resourceId === selectedOverviewResourceId) ?? null;

    if (!data || !selectedOverviewSummary) {
      setIsOverviewTransportModalOpen(false);
    }
  }, [data, isOverviewTransportModalOpen, selectedOverviewResourceId]);

  useEffect(() => {
    if (!data || !isOverviewTransportModalOpen) {
      return;
    }

    const hasCurrentTarget = data.solarSystems.some((solarSystem) => solarSystem.id === overviewTransportTargetSystemId);
    if (hasCurrentTarget) {
      return;
    }

    const nextTargetSystemId =
      data.settings.currentSolarSystemId && data.solarSystems.some((solarSystem) => solarSystem.id === data.settings.currentSolarSystemId)
        ? data.settings.currentSolarSystemId
        : data.solarSystems[0]?.id ?? "";
    setOverviewTransportTargetSystemId(nextTargetSystemId);
  }, [data, isOverviewTransportModalOpen, overviewTransportTargetSystemId]);

  useEffect(() => {
    if (!data || !isOverviewTransportModalOpen) {
      return;
    }

    const selectedOverviewSummary =
      data.summary.resourceSummaries.find((summary) => summary.resourceId === selectedOverviewResourceId) ?? null;
    if (!selectedOverviewSummary) {
      return;
    }

    const resourceLookup = new Map(data.resources.map((resource) => [resource.id, resource]));
    const planetLookup = new Map(data.planets.map((planet) => [planet.id, planet]));
    const systemLookup = new Map(data.solarSystems.map((solarSystem) => [solarSystem.id, solarSystem]));
    const oreMinerLookup = data.oreVeinMiners.reduce<Record<string, OreVeinMiner[]>>((acc, miner) => {
      acc[miner.ore_vein_id] ??= [];
      acc[miner.ore_vein_id].push(miner);
      return acc;
    }, {});
    const gasOutputLookup = data.gasGiantOutputs.reduce<Record<string, GasGiantOutput[]>>((acc, output) => {
      acc[output.gas_giant_site_id] ??= [];
      acc[output.gas_giant_site_id].push(output);
      return acc;
    }, {});

    const sources = getResourceOriginTransportSources(
      data,
      selectedOverviewSummary,
      oreMinerLookup,
      gasOutputLookup,
      resourceLookup,
      planetLookup,
      systemLookup,
    );

    const uniqueSystemIds = Array.from(new Set(sources.map((source) => source.systemId)));
    const nextDrafts = uniqueSystemIds.reduce<Record<string, number>>((acc, systemId) => {
      if (systemId === overviewTransportTargetSystemId) {
        acc[systemId] = 0;
        return acc;
      }

      const existingDistance = getGeneratedSystemDistanceLy(
        data.solarSystems.find((solarSystem) => solarSystem.id === systemId),
        data.solarSystems.find((solarSystem) => solarSystem.id === overviewTransportTargetSystemId),
        data.systemDistances,
      );
      acc[systemId] = existingDistance ?? 0;
      return acc;
    }, {});

    setOverviewTransportDistanceDrafts(nextDrafts);
  }, [data, isOverviewTransportModalOpen, overviewTransportTargetSystemId, selectedOverviewResourceId]);

  useEffect(() => {
    const timers = overviewTransportDistanceSaveTimersRef.current;
    return () => {
      Object.values(timers).forEach((timerId) => {
        window.clearTimeout(timerId);
      });
    };
  }, []);

  useEffect(() => {
    if (!data || newPlanetName) {
      return;
    }

    const currentSystemName =
      data.solarSystems.find((solarSystem) => solarSystem.id === data.settings.currentSolarSystemId)?.name ?? "";
    if (currentSystemName) {
      setNewPlanetName(buildPlanetNamePrefix(currentSystemName));
    }
  }, [data, newPlanetName]);

  useEffect(() => {
    if (!data) {
      return;
    }

    setSystemNameDrafts(
      Object.fromEntries(data.solarSystems.map((solarSystem) => [solarSystem.id, solarSystem.name])),
    );
    setPlanetNameDrafts(Object.fromEntries(data.planets.map((planet) => [planet.id, planet.name])));
  }, [data]);

  useEffect(() => {
    if (!data) {
      return;
    }

    const hasSelectedSystem =
      selectedMapSelection.scope === "system" &&
      data.solarSystems.some((solarSystem) => solarSystem.id === selectedMapSelection.id);
    const hasSelectedPlanet =
      selectedMapSelection.scope === "planet" &&
      data.planets.some((planet) => planet.id === selectedMapSelection.id);

    if (hasSelectedSystem || hasSelectedPlanet) {
      return;
    }

    if (data.settings.currentPlanetId && data.planets.some((planet) => planet.id === data.settings.currentPlanetId)) {
      setSelectedMapSelection({ scope: "planet", id: data.settings.currentPlanetId });
      return;
    }

    if (
      data.settings.currentSolarSystemId &&
      data.solarSystems.some((solarSystem) => solarSystem.id === data.settings.currentSolarSystemId)
    ) {
      setSelectedMapSelection({ scope: "system", id: data.settings.currentSolarSystemId });
      return;
    }

    if (data.solarSystems[0]) {
      setSelectedMapSelection({ scope: "system", id: data.solarSystems[0].id });
    }
  }, [data, selectedMapSelection.id, selectedMapSelection.scope]);

  async function mutate<T>(request: () => Promise<T>, onSuccess?: (payload: T) => void) {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const payload = await request();
      onSuccess?.(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  function applyBootstrap(nextData: BootstrapData) {
    setData(nextData);
  }

  if (loading || !data) {
    return (
      <main className="shell loading-shell">
        <section className="panel">
          <p className="eyebrow">Dyson Sphere Program</p>
          <h1>Loading extraction ledger...</h1>
        </section>
      </main>
    );
  }

  const loadedData = data;
  const currentPlanet = getCurrentPlanet(loadedData);
  const planetsInSystem = getCurrentSystemPlanets(loadedData);
  const selectedProject = loadedData.projects.find((project) => project.id === selectedProjectId) ?? null;
  const oreResources = sortResources(loadedData.resources, "ore_vein");
  const liquidResources = sortResources(loadedData.resources, "liquid_pump");
  const oilResources = sortResources(loadedData.resources, "oil_extractor");
  const gasResources = sortResources(loadedData.resources, "gas_giant_output");

  const gasOutputLookup = loadedData.gasGiantOutputs.reduce<Record<string, GasGiantOutput[]>>((acc, output) => {
    acc[output.gas_giant_site_id] ??= [];
    acc[output.gas_giant_site_id].push(output);
    return acc;
  }, {});

  const oreMinerLookup = loadedData.oreVeinMiners.reduce<Record<string, OreVeinMiner[]>>((acc, miner) => {
    acc[miner.ore_vein_id] ??= [];
    acc[miner.ore_vein_id].push(miner);
    return acc;
  }, {});

  const resourceLookup = new Map(loadedData.resources.map((resource) => [resource.id, resource]));
  const resourceByNameLookup = new Map(loadedData.resources.map((resource) => [resource.name.toLowerCase(), resource]));
  const planetLookup = new Map(loadedData.planets.map((planet) => [planet.id, planet]));
  const systemLookup = new Map(loadedData.solarSystems.map((solarSystem) => [solarSystem.id, solarSystem]));
  const productionIconStart = "#7adbd8";
  const productionIconEnd = "#f1a04f";
  const getIconUrlForName = (name: string) => {
    const resource = resourceByNameLookup.get(name.toLowerCase());
    return resource?.icon_url ?? resolveGameIconPath(name);
  };
  const latestPlanetActivity = getLatestPlanetActivity(loadedData);
  const selectedOreSummary = loadedData.summary.resourceSummaries.find((summary) => summary.resourceId === oreResourceId) ?? null;
  const selectedLiquidSummary = loadedData.summary.resourceSummaries.find((summary) => summary.resourceId === liquidResourceId) ?? null;
  const selectedOilSummary = loadedData.summary.resourceSummaries.find((summary) => summary.resourceId === oilResourceId) ?? null;
  const pendingOreNodeEquivalents = getDraftOreOutputPerMinute(oreMiners, loadedData.settings.miningSpeedPercent) / 30;
  const pendingLiquidOutputPerMinute = getPumpOutputPerMinute(pumpCount, loadedData.settings.miningSpeedPercent);
  const pendingOilPerMinute = getOilOutputPerSecond(oilPerSecond) * 60;
  const pendingGasTrueBoost = getOrbitalCollectorTrueBoost(
    gasOutputs
      .filter((output) => output.resourceId)
      .map((output) => ({
        ratePerSecond: Number(output.ratePerSecond),
        fuelValueMj: resourceLookup.get(output.resourceId)?.fuel_value_mj ?? 0,
      })),
    loadedData.settings.miningSpeedPercent,
  );
  const pendingGasOutputPerMinuteByResourceId = gasOutputs.reduce<Record<string, number>>((acc, output) => {
    if (!output.resourceId) {
      return acc;
    }

    acc[output.resourceId] = (acc[output.resourceId] ?? 0) + Number(output.ratePerSecond) * pendingGasTrueBoost * collectorCount * 60;
    return acc;
  }, {});
  const gasPreviewRows = Object.entries(pendingGasOutputPerMinuteByResourceId)
    .map(([resourceId, pendingPerMinute]) => {
      const summary = loadedData.summary.resourceSummaries.find((item) => item.resourceId === resourceId);
      const resource = resourceLookup.get(resourceId);
      if (!summary || !resource) {
        return null;
      }

      return {
        summary,
        resource,
        pendingPerMinute,
      };
    })
    .filter((preview): preview is NonNullable<typeof preview> => preview !== null)
    .sort((left, right) => left.resource.sort_order - right.resource.sort_order || left.resource.name.localeCompare(right.resource.name));
  const gasPreviewLookup = new Map(
    gasPreviewRows.map((preview) => [preview.summary.resourceId, preview]),
  );
  const overviewResourceSummaries = loadedData.summary.resourceSummaries.filter(
    (summary) => summary.goalQuantity > 0 || summary.supplyMetric > 0,
  );
  const selectedOverviewSummary =
    overviewResourceSummaries.find((summary) => summary.resourceId === selectedOverviewResourceId) ?? null;
  const overviewTransportDefaultThroughputPerMinute = selectedOverviewSummary
    ? getSummaryTargetPerMinute(selectedOverviewSummary)
    : 0;
  const overviewTransportUsesDefault =
    selectedOverviewSummary !== null &&
    overviewTransportThroughputPerMinute === overviewTransportDefaultThroughputPerMinute;
  const selectedOverviewBreakdown = selectedOverviewSummary
    ? getResourceOriginBreakdown(
        loadedData,
        selectedOverviewSummary,
        oreMinerLookup,
        gasOutputLookup,
        resourceLookup,
        planetLookup,
        systemLookup,
      )
    : null;
  const selectedOverviewTransportSources = selectedOverviewSummary
    ? getResourceOriginTransportSources(
        loadedData,
        selectedOverviewSummary,
        oreMinerLookup,
        gasOutputLookup,
        resourceLookup,
        planetLookup,
        systemLookup,
      )
    : [];
  const overviewTransportSystemRows = Array.from(
    selectedOverviewTransportSources.reduce<Map<string, OverviewTransportSystemRow>>((acc, source) => {
      const existing = acc.get(source.systemId);
      if (existing) {
        existing.planetCount += 1;
        existing.supplyPerMinute += source.supplyPerMinute;
        return acc;
      }

      acc.set(source.systemId, {
        systemId: source.systemId,
        systemName: source.systemName,
        planetCount: 1,
        supplyPerMinute: source.supplyPerMinute,
      });
      return acc;
    }, new Map()).values(),
  ).sort((left, right) => left.systemName.localeCompare(right.systemName));
  const overviewTransportPlan = getMultiSourceTransportPlan(
    selectedOverviewTransportSources.map((source) => {
      const draftDistance = overviewTransportDistanceDrafts[source.systemId] ?? 0;
      const distanceLy =
        source.systemId === overviewTransportTargetSystemId
          ? 0
          : draftDistance > 0
            ? draftDistance
            : null;

      return {
        id: source.id,
        supplyPerMinute: source.supplyPerMinute,
        distanceLy,
      };
    }),
    overviewTransportThroughputPerMinute,
    loadedData.settings.vesselCapacityItems,
    loadedData.settings.ilsStorageItems,
    loadedData.settings.vesselSpeedLyPerSecond,
    loadedData.settings.vesselDockingSeconds,
  );
  const overviewTransportPlanRowLookup = new Map(
    overviewTransportPlan.rows.map((row) => [row.id, row]),
  );
  const overviewTransportRows = selectedOverviewTransportSources
    .map((source) => {
      const planRow = overviewTransportPlanRowLookup.get(source.id);
      return {
        ...source,
        assignedPerMinute: planRow?.assignedPerMinute ?? 0,
        utilizationPercent: planRow?.utilizationPercent ?? 0,
        distanceLy: planRow?.distanceLy ?? null,
        roundTripSeconds: planRow?.roundTripSeconds ?? null,
        sourceStationsNeeded: planRow?.sourceStationsNeeded ?? null,
        targetStationsNeeded: planRow?.targetStationsNeeded ?? null,
        isComplete: planRow?.isComplete ?? false,
      };
    })
    .sort((left, right) => {
      const leftDistance = left.distanceLy ?? Number.POSITIVE_INFINITY;
      const rightDistance = right.distanceLy ?? Number.POSITIVE_INFINITY;
      return (
        leftDistance - rightDistance ||
        right.assignedPerMinute - left.assignedPerMinute ||
        right.supplyPerMinute - left.supplyPerMinute ||
        left.name.localeCompare(right.name)
      );
    });
  const overviewTransportTotalSupplyPerMinute = selectedOverviewTransportSources.reduce(
    (sum, source) => sum + source.supplyPerMinute,
    0,
  );
  const overviewTransportCoveragePercent =
    overviewTransportPlan.requestedThroughputPerMinute > 0
      ? Math.min(100, (overviewTransportPlan.assignedThroughputPerMinute / overviewTransportPlan.requestedThroughputPerMinute) * 100)
      : 0;
  const overviewTransportIncompleteSystemCount = overviewTransportSystemRows.filter((row) => (
    row.systemId !== overviewTransportTargetSystemId &&
    (overviewTransportDistanceDrafts[row.systemId] ?? 0) <= 0
  )).length;
  const targetedResourceSummaries = loadedData.summary.resourceSummaries.filter((summary) => summary.goalQuantity > 0);
  const combinedTargetPerMinute = targetedResourceSummaries.reduce(
    (sum, summary) => sum + getSummaryTargetPerMinute(summary),
    0,
  );
  const combinedCappedSupplyPerMinute = targetedResourceSummaries.reduce(
    (sum, summary) => sum + Math.min(summary.supplyPerMinute, getSummaryTargetPerMinute(summary)),
    0,
  );
  const extractionSiteCountByPlanetId = new Map<string, number>();

  const markExtractionSite = (planetId: string) => {
    extractionSiteCountByPlanetId.set(planetId, (extractionSiteCountByPlanetId.get(planetId) ?? 0) + 1);
  };

  loadedData.oreVeins.forEach((vein) => markExtractionSite(vein.planet_id));
  loadedData.liquidSites.forEach((site) => markExtractionSite(site.planet_id));
  loadedData.oilExtractors.forEach((site) => markExtractionSite(site.planet_id));
  loadedData.gasGiantSites.forEach((site) => markExtractionSite(site.planet_id));

  const mapSystemCards = loadedData.solarSystems.map((solarSystem) => {
    const planets = loadedData.planets
      .filter((planet) => planet.solar_system_id === solarSystem.id)
      .sort((left, right) => left.name.localeCompare(right.name));
    const extractionSiteCount = planets.reduce(
      (sum, planet) => sum + (extractionSiteCountByPlanetId.get(planet.id) ?? 0),
      0,
    );
    const activePlanetCount = planets.filter((planet) => (extractionSiteCountByPlanetId.get(planet.id) ?? 0) > 0).length;

    return {
      solarSystem,
      planets,
      extractionSiteCount,
      activePlanetCount,
    };
  });

  const selectedMapSystem =
    selectedMapSelection.scope === "system"
      ? loadedData.solarSystems.find((solarSystem) => solarSystem.id === selectedMapSelection.id) ?? null
      : null;
  const selectedMapPlanet =
    selectedMapSelection.scope === "planet"
      ? loadedData.planets.find((planet) => planet.id === selectedMapSelection.id) ?? null
      : null;
  const selectedMapParentSystem = selectedMapPlanet
    ? systemLookup.get(selectedMapPlanet.solar_system_id) ?? null
    : selectedMapSystem;
  const selectedMapPlanetIds = selectedMapPlanet
    ? [selectedMapPlanet.id]
    : selectedMapSystem
      ? loadedData.planets
          .filter((planet) => planet.solar_system_id === selectedMapSystem.id)
          .map((planet) => planet.id)
      : [];
  const selectedMapPlanetIdSet = new Set(selectedMapPlanetIds);
  const selectedMapExtraction = getExtractionView(
    loadedData,
    selectedMapPlanetIds,
    oreMinerLookup,
    gasOutputLookup,
    resourceLookup,
    planetLookup,
    systemLookup,
  );
  const selectedMapExtractionSiteCount = selectedMapPlanetIds.reduce(
    (sum, planetId) => sum + (extractionSiteCountByPlanetId.get(planetId) ?? 0),
    0,
  );
  const selectedMapPowerDemandMw =
    loadedData.oreVeins
      .filter((vein) => selectedMapPlanetIdSet.has(vein.planet_id))
      .reduce((sum, vein) => {
        const miners = oreMinerLookup[vein.id] ?? [];
        return (
          sum +
          miners.reduce((minerSum, miner) => {
            if (miner.miner_type === "advanced") {
              return minerSum + getAdvancedMinerPowerMw(Number(miner.advanced_speed_percent ?? 100));
            }

            return minerSum + REGULAR_MINER_POWER_MW;
          }, 0)
        );
      }, 0) +
    loadedData.liquidSites
      .filter((site) => selectedMapPlanetIdSet.has(site.planet_id))
      .reduce((sum, site) => sum + Number(site.pump_count) * PUMP_POWER_MW, 0) +
    loadedData.oilExtractors
      .filter((site) => selectedMapPlanetIdSet.has(site.planet_id))
      .length * OIL_EXTRACTOR_POWER_MW;
  const combinedProgressPercent =
    combinedTargetPerMinute > 0 ? Math.min(100, (combinedCappedSupplyPerMinute / combinedTargetPerMinute) * 100) : 0;
  const quickCalcRoundTripSeconds = getTransportRoundTripSeconds(
    quickCalcDistanceLy,
    loadedData.settings.vesselSpeedLyPerSecond,
    loadedData.settings.vesselDockingSeconds,
  );
  const quickCalcItemsPerMinutePerVessel = getItemsPerMinutePerVessel(
    loadedData.settings.vesselCapacityItems,
    quickCalcDistanceLy,
    loadedData.settings.vesselSpeedLyPerSecond,
    loadedData.settings.vesselDockingSeconds,
  );
  const quickCalcRequiredStations = getRequiredStations(
    quickCalcThroughputPerMinute,
    loadedData.settings.vesselCapacityItems,
    quickCalcDistanceLy,
    loadedData.settings.vesselSpeedLyPerSecond,
    loadedData.settings.vesselDockingSeconds,
  );
  const quickCalcTargetStationsNeeded = getTargetStationsNeeded(
    quickCalcThroughputPerMinute,
    loadedData.settings.ilsStorageItems,
    quickCalcDistanceLy,
    loadedData.settings.vesselSpeedLyPerSecond,
    loadedData.settings.vesselDockingSeconds,
  );
  const productionPlanner = buildProductionPlanner(loadedData, selectedProjectId || null);
  const productionItemChoices = productionPlanner.itemChoices;
  const productionItemSummaries = productionPlanner.itemSummaries;
  const productionWarnings = productionPlanner.warnings;
  const productionOverview = productionPlanner.overview;
  const selectedProductionSummary =
    productionItemSummaries.find((summary) => summary.itemKey === selectedProductionItemKey) ??
    productionItemSummaries[0] ??
    null;
  const craftedProjectImportedItems = loadedData.projectImportedItems
    .filter((item) => item.project_id === selectedProjectId && item.category === "crafted")
    .sort(
      (left, right) =>
        Number(left.sort_order ?? Number.MAX_SAFE_INTEGER) - Number(right.sort_order ?? Number.MAX_SAFE_INTEGER) ||
        left.display_name.localeCompare(right.display_name),
    );
  const projectImportedItems = loadedData.projectImportedItems.filter((item) => item.project_id === selectedProjectId);
  const productionTree = buildProductionTree(craftedProjectImportedItems, projectImportedItems, productionItemSummaries);
  const selectedProductionTemplate =
    productionItemChoices.find((item) => item.item_key === selectedProductionSummary?.itemKey) ??
    productionItemChoices.find((item) => item.item_key === productionDraft.itemKey) ??
    null;
  const selectedProductionSiteViews = selectedProductionSummary
    ? productionPlanner.siteViews.filter((siteView) => siteView.site.item_key === selectedProductionSummary.itemKey)
    : productionPlanner.siteViews;
  const productionDraftPlanetOptions = loadedData.planets
    .filter((planet) => planet.solar_system_id === productionDraft.solarSystemId && planet.planet_type === "solid")
    .sort((left, right) => left.name.localeCompare(right.name));
  const productionDraftPreview = buildProductionDraftPreview(
    loadedData,
    selectedProjectId || null,
    productionDraft.itemKey,
    Number(productionDraft.throughputPerMinute),
    productionDraft.solarSystemId,
    productionDraft.planetId,
  );

  function renderProductionTreeNode(
    itemKey: string,
    depth = 0,
    options?: { referenceInput?: ProductionTreeInput },
  ) {
    const nodeValue = productionTree.nodesByKey.get(itemKey);
    if (!nodeValue) {
      return null;
    }
    const node = nodeValue;
    const isSelected = selectedProductionSummary?.itemKey === node.itemKey;
    const isExpanded = expandedProductionItemKeys[node.itemKey] ?? false;
    const canExpand = node.inputs.length > 0 || node.usages.length > 0;
    const referenceInput = options?.referenceInput ?? null;

    function toggleExpanded() {
      setSelectedProductionItemKey(node.itemKey);
      if (!canExpand) {
        return;
      }
      setExpandedProductionItemKeys((current) => ({
        ...current,
        [node.itemKey]: !isExpanded,
      }));
    }

    return (
      <div key={node.itemKey} className="production-tree-branch" style={{ "--production-depth": depth } as CSSProperties}>
        <div
          className={`production-tree-row ${isSelected ? "production-tree-row-active" : ""}`}
        >
          <div className="production-tree-indent" aria-hidden="true" />
          <button
            type="button"
            className={`production-tree-usage-toggle ${canExpand ? "production-tree-usage-toggle-visible" : ""} ${isExpanded ? "production-tree-usage-toggle-expanded" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              toggleExpanded();
            }}
            aria-label={canExpand ? `Toggle details for ${node.summary.displayName}` : undefined}
            disabled={!canExpand}
          >
            ›
          </button>
          <button type="button" className="production-tree-main" onClick={toggleExpanded}>
          <div className="production-tree-title">
            <ResourceIcon
              name={node.summary.displayName}
              iconUrl={getIconUrlForName(node.summary.displayName)}
              colorStart={productionIconStart}
              colorEnd={productionIconEnd}
              size="md"
            />
            <div className="production-tree-copy">
              <strong>{node.summary.displayName}</strong>
              {referenceInput ? (
                <div className="production-tree-reference-meta">
                  <span>{formatValue(referenceInput.demandPerMinute)} / min</span>
                  <span>{formatFixedValue(referenceInput.sharePercent, 1)}% of project supply</span>
                  {referenceInput.isSharedCrafted ? <span className="production-tree-reference-badge">shared input</span> : null}
                </div>
              ) : null}
            </div>
          </div>
          <div className="production-tree-metrics">
            <div className="production-tree-metric">
              <strong>{formatRoundedUpInteger(node.summary.totalPlannedThroughput)}</strong>
              <span className="production-tree-metric-label">/ min</span>
            </div>
            <div className="production-tree-metric">
              <strong>{node.summary.plannedLineCount}</strong>
              <span className="production-tree-metric-label">lines</span>
            </div>
            <div className="production-tree-metric">
              <strong>{formatRoundedUpInteger(node.summary.plannedMachineCount)}</strong>
              <span className="production-tree-metric-label">machines</span>
            </div>
          </div>
          </button>
          <button
            type="button"
            className="production-tree-add-button"
            onClick={(event) => {
              event.stopPropagation();
              openProductionSiteModal(node.itemKey);
            }}
            aria-label={`Add production site for ${node.summary.displayName}`}
          >
            +
          </button>
        </div>

        {isExpanded ? (
          <div className="production-tree-expanded">
            <div className="production-tree-expanded-section">
              <span className="production-tree-expanded-label">Used in</span>
              {node.usages.length > 0 ? (
                <div className="production-tree-expanded-list">
                  {node.usages.map((usage) => (
                    <button
                      key={`${node.itemKey}:${usage.itemKey}`}
                      type="button"
                      className="production-tree-expanded-row"
                      onClick={() => setSelectedProductionItemKey(usage.itemKey)}
                    >
                      <div className="production-tree-expanded-copy">
                        <ResourceIcon
                          name={usage.displayName}
                          iconUrl={getIconUrlForName(usage.displayName)}
                          colorStart={productionIconStart}
                          colorEnd={productionIconEnd}
                          size="sm"
                        />
                        <strong>{usage.displayName}</strong>
                      </div>
                      <span>{formatValue(usage.demandPerMinute)} / min</span>
                      <span>{formatFixedValue(usage.sharePercent, 1)}% of project supply</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="helper-text">No downstream recipe usage in this imported project.</p>
              )}
            </div>
          </div>
        ) : null}

        {isExpanded && node.inputs.length > 0 ? (
          <div className="production-tree-children">
            {node.inputs.map((input) => (
              input.dependencyType === "crafted" && productionTree.nodesByKey.has(input.itemKey)
                ? renderProductionTreeNode(input.itemKey, depth + 1, { referenceInput: input })
                : (
                  <div key={`${node.itemKey}:${input.itemKey}`} className="production-tree-branch" style={{ "--production-depth": depth + 1 } as CSSProperties}>
                    <div className="production-tree-row production-tree-row-leaf">
                      <div className="production-tree-indent" aria-hidden="true" />
                      <span className="production-tree-usage-toggle production-tree-usage-toggle-leaf" aria-hidden="true">
                        •
                      </span>
                      <div className="production-tree-main production-tree-main-leaf">
                        <div className="production-tree-title">
                          <ResourceIcon
                            name={input.displayName}
                            iconUrl={getIconUrlForName(input.displayName)}
                            colorStart={productionIconStart}
                            colorEnd={productionIconEnd}
                            size="md"
                          />
                          <div className="production-tree-copy">
                            <strong>{input.displayName}</strong>
                            <span className="production-tree-reference-badge">raw input</span>
                          </div>
                        </div>
                        <div className="production-tree-metrics">
                          <div className="production-tree-metric">
                            <strong>{formatValue(input.demandPerMinute)}</strong>
                            <span className="production-tree-metric-label">/ min</span>
                          </div>
                          <div className="production-tree-metric">
                            <strong>{formatFixedValue(input.sharePercent, 1)}%</strong>
                            <span className="production-tree-metric-label">of project supply</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  const selectedProjectGoalRows = selectedProject
    ? loadedData.projectGoals
        .filter((goal) => goal.project_id === selectedProject.id && Number(goal.quantity) > 0)
        .map((goal) => {
          const resource = resourceLookup.get(goal.resource_id);
          const summary = loadedData.summary.resourceSummaries.find((entry) => entry.resourceId === goal.resource_id);
          const targetPerMinute = resource ? (resource.type === "ore_vein" ? goal.quantity * 30 : goal.quantity) : 0;
          const coveragePercent = targetPerMinute > 0 && summary
            ? Math.min(100, (summary.supplyPerMinute / targetPerMinute) * 100)
            : 0;
          return {
            id: goal.id,
            resourceName: resource?.name ?? goal.resource_id,
            targetPerMinute,
            supplyPerMinute: summary?.supplyPerMinute ?? 0,
            coveragePercent,
          };
        })
        .sort((left, right) => right.targetPerMinute - left.targetPerMinute || left.resourceName.localeCompare(right.resourceName))
    : [];
  const parsedClusterAddress = (() => {
    const trimmed = clusterAddressDraft.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return parseClusterAddress(trimmed);
    } catch {
      return null;
    }
  })();
  const sortedSystemDistances = loadedData.systemDistances
    .slice()
    .sort((left, right) => {
      const leftLabel = `${systemLookup.get(left.system_a_id)?.name ?? ""} ${systemLookup.get(left.system_b_id)?.name ?? ""}`;
      const rightLabel = `${systemLookup.get(right.system_a_id)?.name ?? ""} ${systemLookup.get(right.system_b_id)?.name ?? ""}`;
      return leftLabel.localeCompare(rightLabel);
    });

  function getPreferredPlanetIdForSystem(systemId: string | null) {
    if (!systemId) {
      return null;
    }

    const candidates = loadedData.planets
      .filter((planet) => planet.solar_system_id === systemId)
      .sort((left, right) => {
        const rightTime = latestPlanetActivity.get(right.id) ?? 0;
        const leftTime = latestPlanetActivity.get(left.id) ?? 0;
        return rightTime - leftTime || left.name.localeCompare(right.name);
      });

    return candidates[0]?.id ?? null;
  }

  async function confirmAndDelete(path: string, label: string) {
    if (!window.confirm(`Delete ${label}?`)) {
      return;
    }

    await mutate(() => deleteBootstrap(path), applyBootstrap);
  }

  function startLocationEdit(entryKey: string, planetId: string, planetType: "solid" | "gas_giant") {
    const planet = planetLookup.get(planetId);
    const rememberedTarget = lastMoveTargets[planetType];
    const rememberedPlanet = planetLookup.get(rememberedTarget.planetId);
    const rememberedPlanetMatchesType =
      rememberedPlanet &&
      rememberedPlanet.planet_type === planetType &&
      rememberedPlanet.solar_system_id === rememberedTarget.systemId;

    setEditingEntryKey(entryKey);
    setEntryLocationDraft({
      systemId: rememberedPlanetMatchesType ? rememberedTarget.systemId : planet?.solar_system_id ?? "",
      planetId: rememberedPlanetMatchesType ? rememberedTarget.planetId : planetId,
    });
  }

  function cancelLocationEdit() {
    setEditingEntryKey("");
    setEntryLocationDraft({ systemId: "", planetId: "" });
  }

  async function saveLocationEdit(path: string, planetType: "solid" | "gas_giant") {
    if (!entryLocationDraft.planetId) {
      return;
    }

    await mutate(() => patchBootstrap(path, { planetId: entryLocationDraft.planetId }), (nextData) => {
      setLastMoveTargets((current) => ({
        ...current,
        [planetType]: {
          systemId: entryLocationDraft.systemId,
          planetId: entryLocationDraft.planetId,
        },
      }));
      applyBootstrap(nextData);
      cancelLocationEdit();
    });
  }

  function getAssignablePlanets(systemId: string, planetType: "solid" | "gas_giant") {
    return loadedData.planets
      .filter((planet) => planet.solar_system_id === systemId && planet.planet_type === planetType)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  function renderLocationEditor(entryKey: string, path: string, planetType: "solid" | "gas_giant") {
    if (editingEntryKey !== entryKey) {
      return null;
    }

    const assignablePlanets = getAssignablePlanets(entryLocationDraft.systemId, planetType);

    return (
      <div className="location-editor">
        <label className="field compact-field">
          <span>System</span>
          <select
            value={entryLocationDraft.systemId}
            onChange={(event) => {
              const nextSystemId = event.target.value;
              const nextPlanetId = getAssignablePlanets(nextSystemId, planetType)[0]?.id ?? "";
              setEntryLocationDraft({ systemId: nextSystemId, planetId: nextPlanetId });
            }}
          >
            <option value="">Select system</option>
            {loadedData.solarSystems.map((solarSystem) => (
              <option key={solarSystem.id} value={solarSystem.id}>
                {solarSystem.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Planet</span>
          <select
            value={entryLocationDraft.planetId}
            onChange={(event) =>
              setEntryLocationDraft((current) => ({
                ...current,
                planetId: event.target.value,
              }))
            }
            disabled={!entryLocationDraft.systemId}
          >
            <option value="">Select planet</option>
            {assignablePlanets.map((planet) => (
              <option key={planet.id} value={planet.id}>
                {describePlanet(planet)}
              </option>
            ))}
          </select>
        </label>

        <div className="location-editor-actions">
          <button type="button" className="primary-button" onClick={() => void saveLocationEdit(path, planetType)} disabled={busy || !entryLocationDraft.planetId}>
            Save move
          </button>
          <button type="button" className="ghost-button" onClick={cancelLocationEdit} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const ledgerPlanetIds = showAllLedger
    ? Array.from(
        new Set([
          ...loadedData.oreVeins.map((vein) => vein.planet_id),
          ...loadedData.liquidSites.map((site) => site.planet_id),
          ...loadedData.oilExtractors.map((site) => site.planet_id),
          ...loadedData.gasGiantSites.map((site) => site.planet_id),
        ]),
      )
    : currentPlanet
      ? [currentPlanet.id]
      : [];

  const ledgerGroups = ledgerPlanetIds
    .map((planetId) => {
      const planet = planetLookup.get(planetId);
      if (!planet) {
        return null;
      }

      const systemName = systemLookup.get(planet.solar_system_id)?.name ?? "Unknown System";
      const oreItems = loadedData.oreVeins
        .filter((vein) => vein.planet_id === planetId)
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
        .map((vein) => ({ kind: "ore" as const, createdAt: vein.created_at, data: vein }));
      const liquidItems = loadedData.liquidSites
        .filter((site) => site.planet_id === planetId)
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
        .map((site) => ({ kind: "liquid" as const, createdAt: site.created_at, data: site }));
      const oilItems = loadedData.oilExtractors
        .filter((site) => site.planet_id === planetId)
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
        .map((site) => ({ kind: "oil" as const, createdAt: site.created_at, data: site }));
      const gasItems = loadedData.gasGiantSites
        .filter((site) => site.planet_id === planetId)
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
        .map((site) => ({ kind: "gas" as const, createdAt: site.created_at, data: site }));

      const items = [...oreItems, ...liquidItems, ...oilItems, ...gasItems].sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      );
      const orePowerMw = oreItems.reduce((sum, item) => {
        const miners = oreMinerLookup[item.data.id] ?? [];
        return (
          sum +
          miners.reduce((minerSum, miner) => {
            if (miner.miner_type === "advanced") {
              return minerSum + getAdvancedMinerPowerMw(Number(miner.advanced_speed_percent ?? 100));
            }

            return minerSum + REGULAR_MINER_POWER_MW;
          }, 0)
        );
      }, 0);
      const liquidPowerMw = liquidItems.reduce((sum, item) => sum + Number(item.data.pump_count) * PUMP_POWER_MW, 0);
      const oilPowerMw = oilItems.length * OIL_EXTRACTOR_POWER_MW;

      return {
        planet,
        systemName,
        latestActivityAt: items[0]?.createdAt ?? "",
        powerDemandMw: orePowerMw + liquidPowerMw + oilPowerMw,
        items,
      };
    })
    .filter((group): group is NonNullable<typeof group> => group !== null)
    .sort((left, right) => new Date(right.latestActivityAt).getTime() - new Date(left.latestActivityAt).getTime());

  async function updateSettings(payload: Partial<BootstrapData["settings"]>) {
    await mutate(() => patchBootstrap("/api/settings", payload), applyBootstrap);
  }

  async function handleRenameSystem(systemId: string) {
    const nextName = systemNameDrafts[systemId]?.trim() ?? "";
    if (!nextName) {
      return;
    }

    await mutate(
      () => patchBootstrap(`/api/systems/${systemId}`, { name: nextName }),
      (nextData) => {
        applyBootstrap(nextData);
        if (nextData.settings.currentSolarSystemId === systemId && !newPlanetName.trim()) {
          setNewPlanetName(buildPlanetNamePrefix(nextName));
        }
      },
    );
  }

  async function handleRenamePlanet(planetId: string) {
    const nextName = normalizePlanetName(planetNameDrafts[planetId] ?? "");
    if (!nextName) {
      return;
    }

    await mutate(
      () => patchBootstrap(`/api/planets/${planetId}`, { name: nextName }),
      applyBootstrap,
    );
  }

  async function handleSavePlanetExtractionIls(planetId: string) {
    const rawValue = planetExtractionIlsDrafts[planetId] ?? "";
    const nextValue = rawValue.trim() === "" ? null : Number(rawValue);
    if (nextValue !== null && (!Number.isFinite(nextValue) || nextValue < 0)) {
      return;
    }

    await mutate(
      () => patchBootstrap(`/api/planets/${planetId}`, { extractionOutboundIlsCount: nextValue }),
      applyBootstrap,
    );
  }

  function openProductionSiteModal(itemKey: string) {
    const nextTemplate = productionItemChoices.find((item) => item.item_key === itemKey) ?? null;
    if (!nextTemplate) {
      return;
    }

    setSelectedProductionItemKey(itemKey);
    setProductionDraft((current) => ({
      ...current,
      itemKey,
      throughputPerMinute: Number(nextTemplate.imported_throughput_per_minute),
    }));
    setIsProductionModalOpen(true);
  }

  function closeProductionSiteModal() {
    setIsProductionModalOpen(false);
  }

  async function handleSaveProject() {
    if (!selectedProject) {
      return;
    }

    await mutate(async () => {
      return patchBootstrap(`/api/projects/${selectedProject.id}`, {
        name: projectNameDraft,
        notes: projectNotesDraft,
        isActive: projectActiveDraft,
        goals: loadedData.resources.map((resource) => ({
          resourceId: resource.id,
          quantity: Number(goalDrafts[resource.id] ?? 0),
        })),
      });
    }, applyBootstrap);
  }

  async function handleCreateProject() {
    if (!newProjectName.trim()) {
      return;
    }

    await mutate(
      () =>
        postBootstrap("/api/projects", {
          name: newProjectName,
          notes: newProjectNotes,
        }),
      (nextData) => {
        applyBootstrap(nextData);
        const project = nextData.projects.find((item) => item.name === newProjectName.trim());
        setSelectedProjectId(project?.id ?? nextData.projects[0]?.id ?? "");
        setNewProjectName("");
        setNewProjectNotes("");
      },
    );
  }

  async function handleCreateOreVein() {
    if (!currentPlanet || currentPlanet.planet_type !== "solid") {
      return;
    }

    await mutate(
      () =>
        postBootstrap("/api/ore-veins", {
          planetId: currentPlanet.id,
          resourceId: oreResourceId,
          label: "",
          miners: oreMiners.map((miner) => ({
            minerType: miner.minerType,
            coveredNodes: Number(miner.coveredNodes),
            advancedSpeedPercent: miner.minerType === "advanced" ? Number(miner.advancedSpeedPercent) : undefined,
          })),
        }),
      (nextData) => {
        applyBootstrap(nextData);
        const nextAdvancedSpeed = oreMiners.find((miner) => miner.minerType === "advanced")?.advancedSpeedPercent ?? 100;
        setOreMiners([{ minerType: "advanced", coveredNodes: 15, advancedSpeedPercent: nextAdvancedSpeed }]);
      },
    );
  }

  async function handleCreateLiquidSite() {
    if (!currentPlanet || currentPlanet.planet_type !== "solid") {
      return;
    }

    await mutate(
      () =>
        postBootstrap("/api/liquids", {
          planetId: currentPlanet.id,
          resourceId: liquidResourceId,
          label: "",
          pumpCount: Number(pumpCount),
        }),
      (nextData) => {
        applyBootstrap(nextData);
        setPumpCount(0);
      },
    );
  }

  async function handleCreateOilExtractor() {
    if (!currentPlanet || currentPlanet.planet_type !== "solid") {
      return;
    }

    await mutate(
      () =>
        postBootstrap("/api/oil-extractors", {
          planetId: currentPlanet.id,
          resourceId: oilResourceId,
          label: "",
          oilPerSecond: Number(oilPerSecond),
        }),
      (nextData) => {
        applyBootstrap(nextData);
        setOilPerSecond(0);
      },
    );
  }

  async function handleCreateGasGiant() {
    if (!currentPlanet || currentPlanet.planet_type !== "gas_giant") {
      return;
    }

    await mutate(
      () =>
        postBootstrap("/api/gas-giants", {
          planetId: currentPlanet.id,
          label: "",
          collectorCount: Number(collectorCount),
          outputs: gasOutputs.map((output) => ({
            resourceId: output.resourceId,
            ratePerSecond: Number(output.ratePerSecond),
          })),
        }),
      (nextData) => {
        applyBootstrap(nextData);
        setCollectorCount(40);
        setGasOutputs(getDefaultGasOutputs(gasResources));
      },
    );
  }

  function startDistanceEdit(distance: SystemDistance) {
    setEditingDistanceId(distance.id);
    setEditingDistanceDraft({
      systemAId: distance.system_a_id,
      systemBId: distance.system_b_id,
      distanceLy: Number(distance.distance_ly),
    });
  }

  function cancelDistanceEdit() {
    setEditingDistanceId("");
    setEditingDistanceDraft({ systemAId: "", systemBId: "", distanceLy: 0 });
  }

  function openOverviewTransportModal() {
    if (!selectedOverviewSummary) {
      return;
    }

    setOverviewTransportTargetSystemId(
      loadedData.settings.currentSolarSystemId && loadedData.solarSystems.some((solarSystem) => solarSystem.id === loadedData.settings.currentSolarSystemId)
        ? loadedData.settings.currentSolarSystemId
        : loadedData.solarSystems[0]?.id ?? "",
    );
    setOverviewTransportThroughputPerMinute(overviewTransportDefaultThroughputPerMinute);
    setOverviewTransportDistanceDrafts({});
    setIsOverviewTransportModalOpen(true);
  }

  function closeOverviewTransportModal() {
    setIsOverviewTransportModalOpen(false);
  }

  function queueOverviewTransportDistanceSave(sourceSystemId: string, distanceLy: number) {
    const existingTimerId = overviewTransportDistanceSaveTimersRef.current[sourceSystemId];
    if (existingTimerId) {
      window.clearTimeout(existingTimerId);
    }

    if (!overviewTransportTargetSystemId || sourceSystemId === overviewTransportTargetSystemId || distanceLy <= 0) {
      delete overviewTransportDistanceSaveTimersRef.current[sourceSystemId];
      return;
    }

    overviewTransportDistanceSaveTimersRef.current[sourceSystemId] = window.setTimeout(() => {
      delete overviewTransportDistanceSaveTimersRef.current[sourceSystemId];
      void mutate(
        () =>
          postBootstrap("/api/system-distances", {
            systemAId: sourceSystemId,
            systemBId: overviewTransportTargetSystemId,
            distanceLy,
          }),
        applyBootstrap,
      );
    }, 350);
  }

  async function handleCreateSystemDistance() {
    if (!distanceDraft.systemAId || !distanceDraft.systemBId || distanceDraft.distanceLy <= 0) {
      return;
    }

    await mutate(
      () =>
        postBootstrap("/api/system-distances", {
          systemAId: distanceDraft.systemAId,
          systemBId: distanceDraft.systemBId,
          distanceLy: Number(distanceDraft.distanceLy),
        }),
      (nextData) => {
        applyBootstrap(nextData);
      },
    );
  }

  async function handleSaveDistanceEdit() {
    if (!editingDistanceId || !editingDistanceDraft.systemAId || !editingDistanceDraft.systemBId || editingDistanceDraft.distanceLy <= 0) {
      return;
    }

    await mutate(
      () =>
        patchBootstrap(`/api/system-distances/${editingDistanceId}`, {
          systemAId: editingDistanceDraft.systemAId,
          systemBId: editingDistanceDraft.systemBId,
          distanceLy: Number(editingDistanceDraft.distanceLy),
        }),
      (nextData) => {
        applyBootstrap(nextData);
        cancelDistanceEdit();
      },
    );
  }

  async function handleExport() {
    await mutate(async () => {
      const payload = await exportSnapshot();
      const blob = new Blob([JSON.stringify(payload.snapshot, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "dsp-resource-sheet-export.json";
      anchor.click();
      URL.revokeObjectURL(url);
      return payload;
    }, (payload) => {
      setNotice(`Exported snapshot and downloaded JSON. Source: ${payload.exportPath}`);
    });
  }

  async function handleImport(file: File | undefined) {
    if (!file) {
      return;
    }

    await mutate(async () => {
      const text = await file.text();
      const snapshot = JSON.parse(text) as unknown;
      return importSnapshot(snapshot);
    }, (nextData) => {
      applyBootstrap(nextData);
      setNotice("Imported snapshot successfully.");
    });
  }

  async function handleProjectCsvImport(file: File | undefined) {
    if (!file) {
      return;
    }

    await mutate(async () => {
      const text = await file.text();
      const importedProject = parseFactorioLabProjectCsv(file.name, text, loadedData.resources);
      return {
        bootstrap: await postBootstrap("/api/projects", {
          name: importedProject.projectName,
          notes: importedProject.projectNotes,
          goals: importedProject.goals,
          importedItems: importedProject.importedItems,
        }),
        importedProject,
      };
    }, ({ bootstrap, importedProject }) => {
      applyBootstrap(bootstrap);

      const project = bootstrap.projects
        .filter((item) => item.name === importedProject.projectName && item.notes === importedProject.projectNotes)
        .sort((left, right) => right.sort_order - left.sort_order)[0];

      setSelectedProjectId(project?.id ?? bootstrap.projects[0]?.id ?? "");
      setActiveView("projects");

      const skippedLabel = importedProject.skippedRawResources.length > 0
        ? ` Skipped unsupported raw entries: ${importedProject.skippedRawResources.join(", ")}.`
        : "";
      setNotice(`Imported project from CSV with ${importedProject.importedItems.length} crafted items.${skippedLabel}`);
    });
  }

  async function handleExistingProjectCsvImport(file: File | undefined) {
    if (!file || !selectedProject) {
      return;
    }

    await mutate(async () => {
      const text = await file.text();
      const importedProject = parseFactorioLabProjectCsv(file.name, text, loadedData.resources);
      return {
        bootstrap: await patchBootstrap(`/api/projects/${selectedProject.id}`, {
          name: selectedProject.name,
          notes: selectedProject.notes,
          isActive: selectedProject.is_active === 1,
          goals: importedProject.goals,
          importedItems: importedProject.importedItems,
        }),
        importedProject,
      };
    }, ({ bootstrap, importedProject }) => {
      applyBootstrap(bootstrap);
      setSelectedProjectId(selectedProject.id);
      setActiveView("projects");

      const skippedLabel = importedProject.skippedRawResources.length > 0
        ? ` Skipped unsupported raw entries: ${importedProject.skippedRawResources.join(", ")}.`
        : "";
      setNotice(`Updated ${selectedProject.name} from CSV with ${importedProject.importedItems.length} crafted items.${skippedLabel}`);
    });
  }

  async function handleCreateProductionSite() {
    if (!selectedProjectId || !productionDraft.itemKey || !productionDraft.solarSystemId || !productionDraft.planetId) {
      return;
    }

    await mutate(
      () =>
        postBootstrap("/api/production-sites", {
          projectId: selectedProjectId,
          itemKey: productionDraft.itemKey,
          throughputPerMinute: Number(productionDraft.throughputPerMinute),
          outboundIlsCount: Number(productionDraft.outboundIlsCount),
          isFinished: productionDraft.isFinished,
          solarSystemId: productionDraft.solarSystemId,
          planetId: productionDraft.planetId,
        }),
      (nextData) => {
        applyBootstrap(nextData);
        const importedItem = nextData.projectImportedItems.find(
          (item) => item.project_id === selectedProjectId && item.item_key === productionDraft.itemKey,
        );
        setSelectedProductionItemKey(productionDraft.itemKey);
        setIsProductionModalOpen(false);
        setProductionDraft((current) => ({
          ...current,
          throughputPerMinute: Number(importedItem?.imported_throughput_per_minute ?? current.throughputPerMinute),
          outboundIlsCount: 0,
          isFinished: true,
        }));
      },
    );
  }

  async function handleImportClusterAddress() {
    if (!parsedClusterAddress) {
      return;
    }

    await mutate(
      () => postBootstrap("/api/cluster/import", { clusterAddress: parsedClusterAddress.clusterAddress }),
      (nextData) => {
        applyBootstrap(nextData);
        setNotice(`Imported ${parsedClusterAddress.clusterStarCount} generated systems from cluster address.`);
      },
    );
  }

  return (
    <main className="shell">
      {(error || notice) && (
        <section className="message-row">
          {error && <div className="message error-message">{error}</div>}
          {notice && <div className="message notice-message">{notice}</div>}
        </section>
      )}

      <nav className="view-tabs">
        {[
          ["log", "Logging"],
          ["overview", "Overview"],
          ["raw", "Raw"],
          ["map", "Map"],
          ["production", "Production"],
          ["projects", "Projects"],
          ["settings", "Settings"],
        ].map(([viewKey, label]) => (
          <button
            key={viewKey}
            type="button"
            className={`view-tab ${activeView === viewKey ? "view-tab-active" : ""}`}
            onClick={() => setActiveView(viewKey as "log" | "overview" | "raw" | "map" | "production" | "projects" | "settings")}
          >
            {label}
          </button>
        ))}
      </nav>

      <section className={`grid-layout grid-layout-${activeView}`}>
        <div className="main-column">
          {activeView === "log" && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Control Room</p>
                <h2>Current context</h2>
              </div>
            </div>

            <div className="two-column">
              <label className="field">
                <span>Current solar system</span>
                <select
                  value={data.settings.currentSolarSystemId ?? ""}
                  onChange={(event) => {
                    const nextSystemId = event.target.value || null;
                    const nextSystemName =
                      data.solarSystems.find((solarSystem) => solarSystem.id === nextSystemId)?.name ?? "";
                    setNewPlanetName(nextSystemName ? buildPlanetNamePrefix(nextSystemName) : "");
                    void updateSettings({
                      currentSolarSystemId: nextSystemId,
                      currentPlanetId: getPreferredPlanetIdForSystem(nextSystemId),
                    });
                  }}
                  disabled={busy}
                >
                  <option value="">Select a system</option>
                  {data.solarSystems.map((solarSystem) => (
                    <option key={solarSystem.id} value={solarSystem.id}>
                      {solarSystem.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Current planet</span>
                <select
                  value={data.settings.currentPlanetId ?? ""}
                  onChange={(event) => {
                    void updateSettings({ currentPlanetId: event.target.value || null });
                  }}
                  disabled={busy || !data.settings.currentSolarSystemId}
                >
                  <option value="">Select a planet</option>
                  {planetsInSystem.map((planet) => (
                    <option key={planet.id} value={planet.id}>
                      {describePlanet(planet)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="two-column">
              <form
                className="inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!newSystemName.trim()) {
                    return;
                  }

                  void mutate(
                    () => postBootstrap("/api/systems", { name: newSystemName }),
                    (nextData) => {
                      applyBootstrap(nextData);
                      setNewPlanetName(buildPlanetNamePrefix(newSystemName.trim()));
                      setNewSystemName("");
                    },
                  );
                }}
              >
                <label className="field">
                  <span>Add solar system</span>
                  <input value={newSystemName} onChange={(event) => setNewSystemName(event.target.value)} placeholder="Alpha Velorum" />
                </label>
                <button type="submit" className="primary-button" disabled={busy}>
                  Add system
                </button>
              </form>

              <form
                className="inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!data.settings.currentSolarSystemId || !newPlanetName.trim()) {
                    return;
                  }

                  void mutate(
                    () =>
                      postBootstrap("/api/planets", {
                        solarSystemId: data.settings.currentSolarSystemId,
                        name: normalizePlanetName(newPlanetName),
                        planetType: newPlanetType,
                      }),
                    (nextData) => {
                      applyBootstrap(nextData);
                      const currentSystemName =
                        nextData.solarSystems.find((solarSystem) => solarSystem.id === nextData.settings.currentSolarSystemId)?.name ?? "";
                      setNewPlanetName(currentSystemName ? buildPlanetNamePrefix(currentSystemName) : "");
                    },
                  );
                }}
              >
                <label className="field">
                  <span>Add planet</span>
                  <input value={newPlanetName} onChange={(event) => setNewPlanetName(event.target.value.replace(/\s{2,}/g, " "))} placeholder="Arden II" />
                </label>
                <label className="field compact-field">
                  <span>Type</span>
                  <div className="segmented-control">
                    <button
                      type="button"
                      className={`segmented-button ${newPlanetType === "solid" ? "segmented-button-active" : ""}`}
                      onClick={() => setNewPlanetType("solid")}
                    >
                      Solid
                    </button>
                    <button
                      type="button"
                      className={`segmented-button ${newPlanetType === "gas_giant" ? "segmented-button-active" : ""}`}
                      onClick={() => setNewPlanetType("gas_giant")}
                    >
                      Gas giant
                    </button>
                  </div>
                </label>
                <button type="submit" className="primary-button" disabled={busy || !data.settings.currentSolarSystemId}>
                  Add planet
                </button>
              </form>
            </div>
          </section>
          )}

          {activeView === "log" && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Fast Entry</p>
                <h2>Planet extraction log</h2>
              </div>
              <div className="context-chip">
                {currentPlanet ? describePlanet(currentPlanet) : "No planet selected"}
              </div>
            </div>

            {!currentPlanet && <p className="empty-state">Select or create a planet above before logging extraction sites.</p>}

            {currentPlanet?.planet_type === "solid" && (
              <div className="entry-grid">
                <form
                  className="entry-card"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleCreateOreVein();
                  }}
                >
                  <div className="entry-card-header">
                    <MachinePill label="MINER" variant="advanced" />
                    <h3>Ore vein</h3>
                  </div>
                  <label className="field field-spaced">
                    <span>Resource</span>
                    <ResourceSelect resources={oreResources} value={oreResourceId} onChange={setOreResourceId} disabled={busy} />
                  </label>
                  {selectedOreSummary && (
                    <div className="entry-stat-strip">
                      <div className="entry-stat">
                        <span>Current</span>
                        <strong>{formatCurrentWithPending(selectedOreSummary.supplyMetric, pendingOreNodeEquivalents)}</strong>
                      </div>
                      <div className="entry-stat">
                        <span>Target</span>
                        <strong>{formatValue(selectedOreSummary.goalQuantity)}</strong>
                      </div>
                    </div>
                  )}
                  <div className="miner-stack">
                    {oreMiners.map((miner, index) => {
                      const chips = miner.minerType === "advanced" ? Array.from({ length: 16 }, (_, offset) => 15 + offset) : Array.from({ length: 10 }, (_, offset) => 1 + offset);
                      return (
                        <div key={`${miner.minerType}-${index}`} className="miner-card">
                          <div className="miner-header">
                            <label className="field compact-field">
                              <span>Miner</span>
                              <select
                                value={miner.minerType}
                                onChange={(event) => {
                                  const nextType = event.target.value as MinerType;
                                  setOreMiners((current) =>
                                    current.map((entry, currentIndex) =>
                                      currentIndex === index
                                        ? {
                                            minerType: nextType,
                                            coveredNodes: nextType === "advanced" ? 15 : 1,
                                            advancedSpeedPercent: entry.advancedSpeedPercent,
                                          }
                                        : entry,
                                    ),
                                  );
                                }}
                              >
                                <option value="advanced">Advanced miner</option>
                                <option value="regular">Regular miner</option>
                              </select>
                            </label>

                            {oreMiners.length > 1 ? (
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={() => setOreMiners((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                              >
                                Remove
                              </button>
                            ) : (
                              <span className="helper-text">Base row</span>
                            )}
                          </div>

                          <div className="quick-chip-row">
                            {chips.map((chip) => (
                              <button
                                key={chip}
                                type="button"
                                className={`quick-chip ${miner.coveredNodes === chip ? "selected-chip" : ""}`}
                                onClick={() =>
                                  setOreMiners((current) =>
                                    current.map((entry, currentIndex) =>
                                      currentIndex === index ? { ...entry, coveredNodes: chip } : entry,
                                    ),
                                  )
                                }
                              >
                                {chip}
                              </button>
                            ))}
                          </div>

                          <label className="field">
                            <span>Covered nodes</span>
                            <input
                              type="number"
                              min={1}
                              value={miner.coveredNodes}
                              onChange={(event) =>
                                setOreMiners((current) =>
                                  current.map((entry, currentIndex) =>
                                    currentIndex === index
                                      ? { ...entry, coveredNodes: Number(event.target.value) }
                                      : entry,
                                  ),
                                )
                              }
                            />
                          </label>

                          {miner.minerType === "advanced" && (
                            <div className="slider-group">
                              <label className="field">
                                <span>Advanced speed</span>
                                <input
                                  type="range"
                                  min={100}
                                  max={300}
                                  step={5}
                                  value={miner.advancedSpeedPercent}
                                  onChange={(event) =>
                                    setOreMiners((current) =>
                                      current.map((entry, currentIndex) =>
                                        currentIndex === index
                                          ? { ...entry, advancedSpeedPercent: Number(event.target.value) }
                                          : entry,
                                      ),
                                    )
                                  }
                                />
                              </label>
                              <label className="field compact-field">
                                <span>Manual %</span>
                                <input
                                  type="number"
                                  min={100}
                                  max={300}
                                  step={1}
                                  value={miner.advancedSpeedPercent}
                                  onChange={(event) =>
                                    setOreMiners((current) =>
                                      current.map((entry, currentIndex) =>
                                        currentIndex === index
                                          ? { ...entry, advancedSpeedPercent: Number(event.target.value) }
                                          : entry,
                                      ),
                                    )
                                  }
                                />
                              </label>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="action-row entry-actions">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setOreMiners((current) => [...current, { minerType: "regular", coveredNodes: 1, advancedSpeedPercent: 100 }])}
                    >
                      Add miner row
                    </button>
                    <button type="submit" className="primary-button" disabled={busy}>
                      Save vein
                    </button>
                  </div>
                </form>

                <form
                  className="entry-card"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleCreateLiquidSite();
                  }}
                >
                  <div className="entry-card-header">
                    <MachinePill label="PUMP" variant="pump" />
                    <h3>Liquid pump</h3>
                  </div>
                  <label className="field">
                    <span>Resource</span>
                    <ResourceSelect resources={liquidResources} value={liquidResourceId} onChange={setLiquidResourceId} disabled={busy} />
                  </label>
                  {selectedLiquidSummary && (
                    <div className="entry-stat-strip">
                      <div className="entry-stat">
                        <span>Current</span>
                        <strong>{formatCurrentWithPending(selectedLiquidSummary.supplyMetric, pendingLiquidOutputPerMinute)}</strong>
                      </div>
                      <div className="entry-stat">
                        <span>Target</span>
                        <strong>{formatValue(selectedLiquidSummary.goalQuantity)}</strong>
                      </div>
                    </div>
                  )}
                  <label className="field">
                    <span>Pumps</span>
                    <input type="number" min={0} value={pumpCount} onChange={(event) => setPumpCount(Number(event.target.value))} />
                  </label>
                  <button type="submit" className="primary-button" disabled={busy}>
                    Save pump site
                  </button>
                </form>

                <form
                  className="entry-card"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleCreateOilExtractor();
                  }}
                >
                  <div className="entry-card-header">
                    <MachinePill label="OIL" variant="oil" />
                    <h3>Oil extractor</h3>
                  </div>
                  <label className="field">
                    <span>Resource</span>
                    <ResourceSelect resources={oilResources} value={oilResourceId} onChange={setOilResourceId} disabled={busy} />
                  </label>
                  {selectedOilSummary && (
                    <div className="entry-stat-strip">
                      <div className="entry-stat">
                        <span>Current</span>
                        <strong>{formatCurrentWithPending(selectedOilSummary.supplyMetric, pendingOilPerMinute)}</strong>
                      </div>
                      <div className="entry-stat">
                        <span>Target</span>
                        <strong>{formatValue(selectedOilSummary.goalQuantity)}</strong>
                      </div>
                    </div>
                  )}
                  <label className="field">
                    <span>Oil per second</span>
                    <input
                      type="number"
                      min={0.1}
                      max={30}
                      step={0.1}
                      value={oilPerSecond}
                      onChange={(event) => setOilPerSecond(Number(event.target.value))}
                    />
                  </label>
                  <button type="submit" className="primary-button" disabled={busy}>
                    Save extractor
                  </button>
                </form>
              </div>
            )}

            {currentPlanet?.planet_type === "gas_giant" && (
              <form
                className="entry-card gas-entry-card"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleCreateGasGiant();
                }}
              >
                <div className="entry-card-header">
                  <MachinePill label="COL" variant="gas" />
                  <h3>Gas giant site</h3>
                </div>
                <div className="two-column">
                  <label className="field">
                    <span>Orbital collectors</span>
                    <input type="number" min={0} max={40} value={collectorCount} onChange={(event) => setCollectorCount(Number(event.target.value))} />
                  </label>
                </div>

                <p className="helper-text">Net output uses the collector true boost formula, including the 30 MW internal fuel burn and your mining speed.</p>

                <div className="gas-output-stack">
                  {gasOutputs.map((output, index) => (
                    <div key={`${output.resourceId}-${index}`} className="gas-output-row">
                      <label className="field">
                        <span>Output resource</span>
                        <ResourceSelect
                          resources={gasResources}
                          value={output.resourceId}
                          onChange={(value) =>
                            setGasOutputs((current) =>
                              current.map((entry, currentIndex) =>
                                currentIndex === index ? { ...entry, resourceId: value } : entry,
                              ),
                            )
                          }
                          disabled={busy}
                        />
                      </label>
                      {(() => {
                        const preview = output.resourceId ? gasPreviewLookup.get(output.resourceId) : null;
                        const goalReached = preview ? preview.summary.supplyMetric + preview.pendingPerMinute >= preview.summary.goalQuantity : false;

                        return (
                          <div className="gas-output-preview">
                            <div className={`gas-output-preview-stat ${goalReached ? "gas-output-preview-stat-done" : ""}`}>
                              <span>Current</span>
                              <strong>{preview ? formatCurrentWithPending(preview.summary.supplyMetric, preview.pendingPerMinute) : "Incomplete"}</strong>
                            </div>
                            <div className={`gas-output-preview-stat ${goalReached ? "gas-output-preview-stat-done" : ""}`}>
                              <span>Target</span>
                              <strong>{preview ? formatValue(preview.summary.goalQuantity) : "Incomplete"}</strong>
                            </div>
                          </div>
                        );
                      })()}
                      <label className="field">
                        <span>Configured rate / sec</span>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={output.ratePerSecond}
                          onChange={(event) =>
                            setGasOutputs((current) =>
                              current.map((entry, currentIndex) =>
                                currentIndex === index ? { ...entry, ratePerSecond: Number(event.target.value) } : entry,
                              ),
                            )
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => setGasOutputs((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                        disabled={gasOutputs.length === 1}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>

                <div className="action-row entry-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() =>
                      setGasOutputs((current) => [
                        ...current,
                        { resourceId: gasResources.find((resource) => !current.some((entry) => entry.resourceId === resource.id))?.id ?? gasResources[0]?.id ?? "", ratePerSecond: 1 },
                      ])
                    }
                  >
                    Add output
                  </button>
                  <button type="submit" className="primary-button" disabled={busy}>
                    Save gas giant
                  </button>
                </div>
              </form>
            )}
          </section>
          )}

          {activeView === "overview" && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Overview</p>
                <h2>{selectedProject ? `${selectedProject.name} progress` : "Project progress"}</h2>
              </div>
              <span className="helper-text">Selected project is shared with the Production and Projects tabs.</span>
            </div>

            <div className="project-pills">
              {loadedData.projects.map((project: Project) => (
                <button
                  key={project.id}
                  type="button"
                  className={`project-pill ${project.id === selectedProjectId ? "project-pill-active" : ""}`}
                  onClick={() => setSelectedProjectId(project.id)}
                >
                  {project.name}
                  <span>{project.is_active === 1 ? "Active" : "Archived"}</span>
                </button>
              ))}
            </div>

            {selectedProject ? (
              <>
                <div className="transport-metric-grid">
                  <article className="entry-stat">
                    <span>Crafted targets</span>
                    <strong>{productionOverview.importedCraftedCount}</strong>
                    <span>{formatValue(productionOverview.plannedCraftedThroughput)} / min total</span>
                  </article>
                  <article className="entry-stat">
                    <span>Planned lines</span>
                    <strong>{productionOverview.plannedLineCount}</strong>
                    <span>Imported factory footprint</span>
                  </article>
                  <article className="entry-stat">
                    <span>Placed sites</span>
                    <strong>{productionOverview.placedSiteCount}</strong>
                    <span>{productionOverview.finishedSiteCount} count as finished</span>
                  </article>
                  <article className="entry-stat">
                    <span>Raw goals covered</span>
                    <strong>{productionOverview.totalRawGoals === 0 ? "None" : `${productionOverview.coveredRawGoals}/${productionOverview.totalRawGoals}`}</strong>
                    <span>{formatFixedValue(productionOverview.rawCoveragePercent, 1)}% coverage</span>
                  </article>
                </div>

                <div className="overview-breakdown-grid">
                  <section className="overview-breakdown-panel">
                    <div className="overview-breakdown-heading">
                      <h4>Top raw goals</h4>
                      <span>{selectedProjectGoalRows.length} tracked</span>
                    </div>
                    {selectedProjectGoalRows.length > 0 ? (
                      <div className="overview-breakdown-list">
                        {selectedProjectGoalRows.slice(0, 8).map((row) => (
                          <article key={row.id} className="overview-breakdown-row">
                            <div className="overview-breakdown-row-top">
                              <div>
                                <strong>{row.resourceName}</strong>
                                <span>{formatValue(row.supplyPerMinute)} / {formatValue(row.targetPerMinute)} / min</span>
                              </div>
                              <div className="overview-breakdown-values">
                                <strong>{formatFixedValue(row.coveragePercent, 1)}%</strong>
                              </div>
                            </div>
                            <div className="progress-rail overview-breakdown-bar">
                              <span style={{ width: `${Math.min(100, row.coveragePercent)}%` }} />
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="empty-state">This project has no raw requirements yet.</p>
                    )}
                  </section>

                  <section className="overview-breakdown-panel">
                    <div className="overview-breakdown-heading">
                      <h4>Warnings</h4>
                      <span>{productionWarnings.length}</span>
                    </div>
                    {productionWarnings.length > 0 ? (
                      <div className="overview-breakdown-list">
                        {productionWarnings.map((warning) => (
                          <article key={warning.id} className={`overview-breakdown-row ${warning.severity === "danger" ? "warning-card-danger" : "warning-card-warning"}`}>
                            <div className="overview-breakdown-row-top">
                              <div>
                                <strong>{warning.title}</strong>
                                <span>{warning.detail}</span>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="empty-state">No planner warnings for this project right now.</p>
                    )}
                  </section>
                </div>
              </>
            ) : (
              <p className="empty-state">Create or select a project to see project-level progress.</p>
            )}
          </section>
          )}

          {activeView === "raw" && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Live Totals</p>
                <h2>Combined resource progress</h2>
              </div>
              <span className="helper-text">Click any resource to inspect which systems and planets supply it.</span>
            </div>
            <article className="overview-total-card">
              <div className="overview-total-header">
                <div>
                  <h3>Total throughput</h3>
                  <p>All targeted resources combined, normalized to per-minute output.</p>
                </div>
                <div className={`metric-line metric-line-inline ${combinedCappedSupplyPerMinute >= combinedTargetPerMinute && combinedTargetPerMinute > 0 ? "metric-line-done" : ""}`}>
                  <strong>{formatValue(combinedCappedSupplyPerMinute)}</strong>
                  <span>/ {formatValue(combinedTargetPerMinute)} / min</span>
                </div>
              </div>
              <div className="progress-rail progress-rail-large">
                <span style={{ width: `${combinedProgressPercent}%` }} />
              </div>
            </article>
            <div className="resource-grid">
              {overviewResourceSummaries.map((summary) => (
                <button
                  key={summary.resourceId}
                  type="button"
                  className={`resource-card resource-card-button ${selectedOverviewResourceId === summary.resourceId ? "resource-card-active" : ""}`}
                  onClick={() => setSelectedOverviewResourceId(summary.resourceId)}
                >
                  <div className="resource-card-top">
                    <div className="resource-title">
                      <ResourceIcon
                        name={summary.name}
                        iconUrl={summary.iconUrl}
                        colorStart={summary.colorStart}
                        colorEnd={summary.colorEnd}
                      />
                      <div>
                        <h3>{summary.name}</h3>
                        <p>Per minute</p>
                      </div>
                    </div>
                  </div>

                  <div className={`metric-line metric-line-inline ${summary.supplyPerMinute >= getSummaryTargetPerMinute(summary) && getSummaryTargetPerMinute(summary) > 0 ? "metric-line-done" : ""}`}>
                    <strong>{formatValue(summary.supplyPerMinute)}</strong>
                    <span>/ {formatValue(getSummaryTargetPerMinute(summary))} / min</span>
                  </div>
                  <div className="progress-rail">
                    <span style={{ width: `${getProgressPercent(summary)}%` }} />
                  </div>
                  <div className="resource-meta">
                    <span>{summary.placementCount} setups</span>
                    {summary.type !== "liquid_pump" && (
                      <span>
                        {formatValue(summary.supplyPerSecond)} / sec | {formatValue(summary.supplyPerMinute)} / min
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>

            {selectedOverviewSummary ? (
              <article className="overview-detail-card">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Resource origins</p>
                    <h3>{selectedOverviewSummary.name}</h3>
                  </div>
                  <div className="overview-detail-actions">
                    <button
                      type="button"
                      className="primary-button"
                      onClick={openOverviewTransportModal}
                      disabled={selectedOverviewTransportSources.length === 0 || loadedData.solarSystems.length === 0}
                    >
                      Open transport calc
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setSelectedOverviewResourceId("")}
                    >
                      Close
                    </button>
                  </div>
                </div>

                <div className="overview-detail-summary">
                  <div className="entry-stat">
                    <span>Project target</span>
                    <strong>{formatValue(getSummaryTargetPerMinute(selectedOverviewSummary))}</strong>
                    <span>/ min</span>
                  </div>
                  <div className="entry-stat">
                    <span>Active setups</span>
                    <strong>{selectedOverviewSummary.placementCount}</strong>
                    <span>Logged locations</span>
                  </div>
                  <div className="entry-stat">
                    <span>Tracked output</span>
                    <strong>{formatValue(selectedOverviewSummary.supplyPerMinute)}</strong>
                    <span>/ min</span>
                  </div>
                </div>

                {selectedOverviewBreakdown && (selectedOverviewBreakdown.systems.length > 0 || selectedOverviewBreakdown.planets.length > 0) ? (
                  <div className="overview-breakdown-grid">
                    <section className="overview-breakdown-panel">
                      <div className="overview-breakdown-heading">
                        <h4>By system</h4>
                        <span>{selectedOverviewBreakdown.systems.length} systems</span>
                      </div>
                      <div className="overview-breakdown-list">
                        {selectedOverviewBreakdown.systems.map((row) => (
                          <article key={row.id} className="overview-breakdown-row">
                            <div className="overview-breakdown-row-top">
                              <div>
                                <strong>{row.name}</strong>
                              </div>
                              <div className="overview-breakdown-values">
                                <strong>{formatFixedValue(row.percentOfTotal, 1)}%</strong>
                                <span>{formatValue(row.supplyPerMinute)} / min</span>
                              </div>
                            </div>
                            <div className="progress-rail overview-breakdown-bar">
                              <span style={{ width: `${row.percentOfTotal}%` }} />
                            </div>
                            <div className="resource-meta">
                              <span>{getBreakdownSecondaryText(selectedOverviewSummary, row)}</span>
                              <span>{row.placementCount} setups</span>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>

                    <section className="overview-breakdown-panel">
                      <div className="overview-breakdown-heading">
                        <h4>By planet</h4>
                        <span>{selectedOverviewBreakdown.planets.length} planets</span>
                      </div>
                      <div className="overview-breakdown-list">
                        {selectedOverviewBreakdown.planets.map((row) => (
                          <article key={row.id} className="overview-breakdown-row">
                            <div className="overview-breakdown-row-top">
                              <div>
                                <strong>{row.name}</strong>
                                <span>{row.context}</span>
                              </div>
                              <div className="overview-breakdown-values">
                                <strong>{formatFixedValue(row.percentOfTotal, 1)}%</strong>
                                <span>{formatValue(row.supplyPerMinute)} / min</span>
                              </div>
                            </div>
                            <div className="progress-rail overview-breakdown-bar">
                              <span style={{ width: `${row.percentOfTotal}%` }} />
                            </div>
                            <div className="resource-meta">
                              <span>{getBreakdownSecondaryText(selectedOverviewSummary, row)}</span>
                              <span>{row.placementCount} setups</span>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  </div>
                ) : (
                  <p className="empty-state">No supply sources are logged for this resource yet.</p>
                )}
              </article>
            ) : (
              <p className="empty-state">Select a resource card to open its planet and system breakdown.</p>
            )}
          </section>
          )}

          {isOverviewTransportModalOpen && selectedOverviewSummary && (
            <div className="modal-backdrop" onClick={closeOverviewTransportModal}>
              <section
                className="modal-card overview-transport-modal"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Resource transport</p>
                    <h2>{selectedOverviewSummary.name}</h2>
                  </div>
                  <button type="button" className="ghost-button" onClick={closeOverviewTransportModal}>
                    Close
                  </button>
                </div>

                <p className="helper-text">
                  Closest systems fill first. Sources at the same distance split the remaining demand proportionally to their tracked output.
                </p>

                <div className="overview-transport-controls">
                  <label className="field">
                    <span>Target system</span>
                    <select
                      value={overviewTransportTargetSystemId}
                      onChange={(event) => setOverviewTransportTargetSystemId(event.target.value)}
                    >
                      <option value="">Select system</option>
                      {loadedData.solarSystems.map((solarSystem) => (
                        <option key={solarSystem.id} value={solarSystem.id}>
                          {solarSystem.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Throughput needed / min</span>
                    <div className="input-with-hint">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={overviewTransportThroughputPerMinute}
                        onChange={(event) => setOverviewTransportThroughputPerMinute(Number(event.target.value))}
                        className={overviewTransportUsesDefault ? "input-with-inline-tag" : ""}
                      />
                      {overviewTransportUsesDefault && <span className="input-inline-hint">(default)</span>}
                    </div>
                  </label>
                </div>

                <div className="overview-transport-stat-grid">
                  <div className="entry-stat">
                    <span>Requested</span>
                    <strong>{formatValue(overviewTransportPlan.requestedThroughputPerMinute)}</strong>
                    <span>/ min</span>
                  </div>
                  <div className="entry-stat">
                    <span>Assigned</span>
                    <strong>{formatValue(overviewTransportPlan.assignedThroughputPerMinute)}</strong>
                    <span>{formatFixedValue(overviewTransportCoveragePercent, 1)}% coverage</span>
                  </div>
                  <div className="entry-stat">
                    <span>Target ILS needed</span>
                    <strong>{formatFixedValue(overviewTransportPlan.totalTargetStationsNeeded, 1)}</strong>
                    <span>Raw requirement</span>
                  </div>
                  <div className="entry-stat">
                    <span>Total tracked supply</span>
                    <strong>{formatValue(overviewTransportTotalSupplyPerMinute)}</strong>
                    <span>{overviewTransportIncompleteSystemCount} systems need distances</span>
                  </div>
                </div>

                {(overviewTransportIncompleteSystemCount > 0 || overviewTransportPlan.remainingThroughputPerMinute > 0) && (
                  <div className="overview-transport-alerts">
                    {overviewTransportIncompleteSystemCount > 0 && (
                      <div className="overview-transport-alert">
                        <strong>Missing distances</strong>
                        <span>Enter the missing source-system distances below to include every planet in the calculation.</span>
                      </div>
                    )}
                    {overviewTransportPlan.remainingThroughputPerMinute > 0 && (
                      <div className="overview-transport-alert">
                        <strong>Uncovered demand</strong>
                        <span>{formatValue(overviewTransportPlan.remainingThroughputPerMinute)} / min is still uncovered after the current closest-first allocation.</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="overview-transport-grid">
                  <section className="overview-breakdown-panel">
                    <div className="overview-breakdown-heading">
                      <h4>System distances</h4>
                      <span>{overviewTransportSystemRows.length} source systems</span>
                    </div>

                    {overviewTransportSystemRows.length > 0 ? (
                      <div className="overview-transport-system-list">
                        {overviewTransportSystemRows.map((row) => {
                          const isTargetSystem = row.systemId === overviewTransportTargetSystemId;
                          const distanceLy = isTargetSystem ? 0 : Number(overviewTransportDistanceDrafts[row.systemId] ?? 0);

                          return (
                            <article key={row.systemId} className="overview-transport-system-row">
                              <div className="overview-transport-system-copy">
                                <strong>{row.systemName}</strong>
                                <span>{row.planetCount} planets | {formatValue(row.supplyPerMinute)} / min tracked</span>
                              </div>

                              {isTargetSystem ? (
                                <span className="context-chip">Local route (0 ly)</span>
                              ) : (
                                <div className="overview-transport-system-actions">
                                  <label className="field compact-field">
                                    <span>Distance (ly)</span>
                                    <input
                                      type="number"
                                      min={0}
                                      step="any"
                                      value={distanceLy}
                                      onChange={(event) => {
                                        const nextDistanceLy = Number(event.target.value);
                                        setOverviewTransportDistanceDrafts((current) => ({
                                          ...current,
                                          [row.systemId]: nextDistanceLy,
                                        }));
                                        queueOverviewTransportDistanceSave(row.systemId, nextDistanceLy);
                                      }}
                                    />
                                  </label>
                                </div>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="empty-state">No supply planets are logged for this resource yet.</p>
                    )}
                  </section>

                  <section className="overview-breakdown-panel">
                    <div className="overview-breakdown-heading">
                      <h4>Source planets</h4>
                      <span>{overviewTransportRows.length} planets</span>
                    </div>

                    {overviewTransportRows.length > 0 ? (
                      <div className="overview-breakdown-list">
                        {overviewTransportRows.map((row) => (
                          <article
                            key={row.id}
                            className={`overview-breakdown-row ${row.isComplete ? "" : "overview-transport-row-incomplete"}`}
                          >
                            <div className="overview-breakdown-row-top">
                              <div>
                                <strong>{row.name}</strong>
                                <span>{row.context}</span>
                              </div>
                              <div className="overview-breakdown-values">
                                <strong>{formatFixedValue(row.utilizationPercent, 1)}%</strong>
                                <span>{formatValue(row.assignedPerMinute)} / {formatValue(row.supplyPerMinute)} / min</span>
                              </div>
                            </div>

                            <div className="progress-rail overview-breakdown-bar">
                              <span style={{ width: `${Math.min(100, row.utilizationPercent)}%` }} />
                            </div>

                            {row.isComplete ? (
                              <div className="resource-meta overview-transport-row-meta">
                                <span>
                                  {row.distanceLy === 0
                                    ? "Local route"
                                    : `${formatFixedValue(row.distanceLy ?? 0, 1)} ly | ${formatFixedValue(row.roundTripSeconds ?? 0, 1)} s round trip`}
                                </span>
                                <span>Source ILS {row.sourceStationsNeeded === null ? "Incomplete" : formatFixedValue(row.sourceStationsNeeded, 1)}</span>
                              </div>
                            ) : (
                              <div className="resource-meta overview-transport-row-meta">
                                <span className="transport-warning">Enter the {row.systemName} distance to include this planet.</span>
                                <span>{formatValue(row.supplyPerMinute)} / min tracked</span>
                              </div>
                            )}
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="empty-state">No source planets are available for this transport calculation.</p>
                    )}
                  </section>
                </div>
              </section>
            </div>
          )}

                    {activeView === "production" && (
          <>
            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Production</p>
                  <h2>{selectedProject ? `${selectedProject.name} factory plan` : "Factory plan"}</h2>
                </div>
                <span className="helper-text">Pick an imported crafted item first, then place one planet build at a time.</span>
              </div>

              <div className="project-pills">
                {loadedData.projects.map((project: Project) => (
                  <button
                    key={project.id}
                    type="button"
                    className={`project-pill ${project.id === selectedProjectId ? "project-pill-active" : ""}`}
                    onClick={() => setSelectedProjectId(project.id)}
                  >
                    {project.name}
                    <span>{project.is_active === 1 ? "Active" : "Archived"}</span>
                  </button>
                ))}
              </div>

              {selectedProject ? (
                <div className="transport-metric-grid">
                  <article className="entry-stat">
                    <span>Imported crafted items</span>
                    <strong>{productionOverview.importedCraftedCount}</strong>
                    <span>{formatValue(productionOverview.plannedCraftedThroughput)} / min planned</span>
                  </article>
                  <article className="entry-stat">
                    <span>Total lines</span>
                    <strong>{productionOverview.plannedLineCount}</strong>
                    <span>Imported line count</span>
                  </article>
                  <article className="entry-stat">
                    <span>Placed sites</span>
                    <strong>{productionOverview.placedSiteCount}</strong>
                    <span>{productionOverview.finishedSiteCount} finished</span>
                  </article>
                  <article className="entry-stat">
                    <span>Warnings</span>
                    <strong>{productionOverview.warningCount}</strong>
                    <span>Review Overview for global warnings</span>
                  </article>
                </div>
              ) : (
                <p className="empty-state">Select a project to plan crafted production.</p>
              )}
            </section>

            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Summary</p>
                  <h2>Production tree</h2>
                </div>
                <span className="helper-text">Imported crafted items arranged by dependency, similar to your FactorioLab plan.</span>
              </div>
              {productionItemSummaries.length > 0 ? (
                <div className="production-tree-root-list">
                  {productionTree.rootKeys.map((itemKey) => renderProductionTreeNode(itemKey))}
                </div>
              ) : (
                <p className="empty-state">Import a FactorioLab CSV onto this project to populate produced items.</p>
              )}
            </section>

            <section className="panel">
              <div className="section-heading">
                <div className="production-detail-heading">
                  {selectedProductionSummary ? (
                    <ResourceIcon
                      name={selectedProductionSummary.displayName}
                      iconUrl={getIconUrlForName(selectedProductionSummary.displayName)}
                      colorStart={productionIconStart}
                      colorEnd={productionIconEnd}
                      size="lg"
                    />
                  ) : null}
                  <div>
                    <p className="eyebrow">Selected item</p>
                    <h2>{selectedProductionSummary?.displayName ?? "Production detail"}</h2>
                  </div>
                </div>
                <div className="overview-detail-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!selectedProductionSummary}
                    onClick={() => selectedProductionSummary && openProductionSiteModal(selectedProductionSummary.itemKey)}
                  >
                    New production site
                  </button>
                </div>
              </div>

              {selectedProductionSummary && selectedProductionTemplate ? (
                <>
                  <div className="overview-detail-summary">
                    <div className="entry-stat">
                      <span>Imported target</span>
                      <strong>{formatValue(selectedProductionSummary.totalPlannedThroughput)}</strong>
                      <span>/ min</span>
                    </div>
                    <div className="entry-stat">
                      <span>Lines needed</span>
                      <strong>{selectedProductionSummary.plannedLineCount}</strong>
                      <span>{formatFixedValue(selectedProductionSummary.plannedMachineCount, 1)} machines total</span>
                    </div>
                    <div className="entry-stat">
                      <span>Placed sites</span>
                      <strong>{selectedProductionSummary.siteCount}</strong>
                      <span>{formatValue(selectedProductionSummary.finishedThroughput)} / min finished</span>
                    </div>
                  </div>

                  <div className="overview-breakdown-list">
                    {selectedProductionTemplate.dependencies.map((dependency) => (
                          <article key={dependency.item_key} className="overview-breakdown-row production-breakdown-row">
                            <div className="overview-breakdown-row-top">
                              <div className="production-ingredient-heading">
                                <ResourceIcon
                                  name={dependency.display_name}
                                  iconUrl={getIconUrlForName(dependency.display_name)}
                                  colorStart={productionIconStart}
                                  colorEnd={productionIconEnd}
                                  size="sm"
                                />
                                <div>
                                  <strong>{dependency.display_name}</strong>
                                  <span>{formatValue(dependency.imported_demand_per_minute)} / min total</span>
                                </div>
                              </div>
                              <div className="overview-breakdown-values">
                                <strong>{
                                  selectedProductionSummary.plannedLineCount > 0 && selectedProductionTemplate.belt_speed_per_minute
                                    ? `${formatFixedValue(
                                        Math.ceil(((dependency.imported_demand_per_minute / selectedProductionTemplate.belt_speed_per_minute) / Math.max(selectedProductionSummary.plannedLineCount, 1)) * 100) / 100,
                                        2,
                                      )} belts/line`
                                    : "Belt speed n/a"
                                }</strong>
                                <span>{dependency.dependency_type === "raw" ? "Raw input" : "Crafted input"}</span>
                              </div>
                            </div>
                          </article>
                    ))}
                  </div>

                  {selectedProductionSiteViews.length > 0 ? (
                <div className="transport-ledger">
                  {selectedProductionSiteViews.map((siteView) => (
                    <article key={siteView.site.id} className="transport-row-card production-site-card">
                      <div className="transport-row-main">
                        <div className="production-site-heading">
                          <ResourceIcon
                            name={siteView.importedItem.display_name}
                            iconUrl={getIconUrlForName(siteView.importedItem.display_name)}
                            colorStart={productionIconStart}
                            colorEnd={productionIconEnd}
                            size="md"
                          />
                          <div className="production-site-copy">
                            <h3>{siteView.importedItem.display_name}</h3>
                            <p>{siteView.solarSystemName} | {siteView.planetName}</p>
                          </div>
                          <span className="production-machine-pill">
                            <ResourceIcon
                              name={siteView.importedItem.machine_label || "Factory"}
                              iconUrl={getIconUrlForName(siteView.importedItem.machine_label || "Factory")}
                              colorStart="#99c9ff"
                              colorEnd="#5578b5"
                              size="sm"
                            />
                            {siteView.importedItem.machine_label || "Imported machine"}
                          </span>
                        </div>
                        <div className="ledger-item-actions">
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => void confirmAndDelete(`/api/production-sites/${siteView.site.id}`, `${siteView.importedItem.display_name} site`)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      <div className="transport-route-stats">
                        <span><strong>{formatValue(siteView.site.throughput_per_minute)}</strong> / min</span>
                        <span>{formatFixedValue(siteView.machineCount, 1)} machines</span>
                        <span>{formatFixedValue(siteView.outputBeltsPerLine * siteView.lineCount, 2)} output belts</span>
                        <span>{formatFixedValue(siteView.outboundIlsRequired, 2)} / {formatValue(siteView.site.outbound_ils_count)} outbound ILS</span>
                      </div>

                      <p className="helper-text">
                        {siteView.lineCount} lines · {formatFixedValue(siteView.assemblersPerLine, 1)} machines/line · {formatFixedValue(siteView.outputBeltsPerLine, 2)} output belts/line
                      </p>

                      <div className="overview-breakdown-list">
                        {siteView.dependencies.map((ingredient) => (
                          <article key={ingredient.dependency.item_key} className="overview-breakdown-row production-breakdown-row">
                            <div className="overview-breakdown-row-top">
                              <div className="production-ingredient-heading">
                                <ResourceIcon
                                  name={ingredient.dependency.display_name}
                                  iconUrl={getIconUrlForName(ingredient.dependency.display_name)}
                                  colorStart={productionIconStart}
                                  colorEnd={productionIconEnd}
                                  size="sm"
                                />
                                <div>
                                  <strong>{ingredient.dependency.display_name}</strong>
                                  <p>{formatValue(ingredient.requiredPerMinute)} / min required · {formatValue(ingredient.coveragePerMinute)} covered</p>
                                </div>
                              </div>
                              <div className="overview-breakdown-values">
                                <strong>{formatFixedValue(ingredient.beltsPerLine, 2)} belts/line</strong>
                                <span>{ingredient.targetIlsFraction === null ? "ILS n/a" : `${formatFixedValue(ingredient.targetIlsFraction, 2)} target ILS`}</span>
                              </div>
                            </div>
                            <p className="helper-text">
                              {ingredient.sourcesLabel}
                              {ingredient.shortagePerMinute > 0 ? ` · Missing ${formatValue(ingredient.shortagePerMinute)} / min.` : ""}
                              {ingredient.hasOutboundIlsWarning ? " Source outbound ILS is overbooked." : ""}
                            </p>
                          </article>
                        ))}
                      </div>

                      <p className="helper-text">
                        Mixed target ILS {siteView.mixedIlsFullStationCount + siteView.mixedIlsBins.length}
                        {siteView.mixedIlsBins.length > 0
                          ? ` · shared bins: ${siteView.mixedIlsBins.map((bin) => `[${bin.entries.map((item) => `${item.itemName} ${formatFixedValue(item.fraction, 2)}`).join(", ")}]`).join(" | ")}`
                          : ""}
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                    <p className="empty-state">No production sites placed for this item yet. Use the button above to place one.</p>
                  )}
                </>
              ) : (
                <p className="empty-state">Select a produced item card to review its lines, inputs, and placed sites.</p>
              )}
            </section>
          </>
          )}

          {isProductionModalOpen && selectedProductionTemplate && (
            <div className="modal-backdrop" onClick={closeProductionSiteModal}>
              <section className="modal-card production-modal" onClick={(event) => event.stopPropagation()}>
                <div className="section-heading">
                  <div className="production-detail-heading">
                    <ResourceIcon
                      name={selectedProductionTemplate.display_name}
                      iconUrl={getIconUrlForName(selectedProductionTemplate.display_name)}
                      colorStart={productionIconStart}
                      colorEnd={productionIconEnd}
                      size="lg"
                    />
                    <div>
                      <p className="eyebrow">New production site</p>
                      <h2>{selectedProductionTemplate.display_name}</h2>
                      <p className="helper-text">Preview line count, inbound belts, and source coverage before placing this build.</p>
                    </div>
                  </div>
                  <button type="button" className="ghost-button" onClick={closeProductionSiteModal}>
                    Close
                  </button>
                </div>

                <form
                  className="production-modal-layout"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleCreateProductionSite();
                  }}
                >
                  <div className="production-modal-main">
                    <div className="transport-form-grid">
                      <label className="field">
                        <span>Throughput / min</span>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={productionDraft.throughputPerMinute}
                          onChange={(event) => setProductionDraft((current) => ({ ...current, throughputPerMinute: Number(event.target.value) }))}
                        />
                      </label>
                      <label className="field">
                        <span>Outbound ILS</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={productionDraft.outboundIlsCount}
                          onChange={(event) => setProductionDraft((current) => ({ ...current, outboundIlsCount: Number(event.target.value) }))}
                        />
                      </label>
                      <label className="field">
                        <span>System</span>
                        <select
                          value={productionDraft.solarSystemId}
                          onChange={(event) =>
                            setProductionDraft((current) => ({
                              ...current,
                              solarSystemId: event.target.value,
                              planetId:
                                loadedData.planets.find((planet) => planet.solar_system_id === event.target.value && planet.planet_type === "solid")?.id ?? "",
                            }))
                          }
                        >
                          <option value="">Select system</option>
                          {loadedData.solarSystems.map((solarSystem) => (
                            <option key={solarSystem.id} value={solarSystem.id}>
                              {solarSystem.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Planet</span>
                        <select
                          value={productionDraft.planetId}
                          onChange={(event) => setProductionDraft((current) => ({ ...current, planetId: event.target.value }))}
                        >
                          <option value="">Select planet</option>
                          {productionDraftPlanetOptions.map((planet) => (
                            <option key={planet.id} value={planet.id}>
                              {planet.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label className="toggle-field">
                      <input
                        type="checkbox"
                        checked={productionDraft.isFinished}
                        onChange={(event) => setProductionDraft((current) => ({ ...current, isFinished: event.target.checked }))}
                      />
                      <span>Active</span>
                    </label>

                    {productionDraftPreview ? (
                      <>
                        <div className="overview-detail-summary">
                          <div className="entry-stat">
                            <span>Lines needed</span>
                            <strong>{productionDraftPreview.lineCount}</strong>
                            <span>{formatFixedValue(productionDraftPreview.assemblersPerLine, 1)} machines/line</span>
                          </div>
                          <div className="entry-stat">
                            <span>Output belts</span>
                            <strong>{formatFixedValue(productionDraftPreview.outputBelts, 2)}</strong>
                            <span>{formatFixedValue(productionDraftPreview.outputBeltsPerLine, 2)} belts/line</span>
                          </div>
                          <div className="entry-stat">
                            <span>Location</span>
                            <strong>{productionDraftPreview.planetName || "Select planet"}</strong>
                            <span>{productionDraftPreview.solarSystemName || "Select system"}</span>
                          </div>
                        </div>

                        <div className="overview-breakdown-list">
                          {productionDraftPreview.dependencies.map((dependency) => (
                            <details key={dependency.dependency.item_key} className="production-ingredient-detail">
                              <summary className="production-ingredient-summary">
                                <div className="production-ingredient-heading">
                                  <ResourceIcon
                                    name={dependency.dependency.display_name}
                                    iconUrl={getIconUrlForName(dependency.dependency.display_name)}
                                    colorStart={productionIconStart}
                                    colorEnd={productionIconEnd}
                                    size="sm"
                                  />
                                  <div>
                                    <strong>{dependency.dependency.display_name}</strong>
                                    <span>{formatValue(dependency.requiredPerMinute)} / min | {formatFixedValue(dependency.beltsPerLine, 2)} belts/line</span>
                                  </div>
                                </div>
                                <div className="overview-breakdown-values">
                                  <strong>{formatFixedValue(dependency.coveragePercent, 1)}%</strong>
                                  <span>{dependency.targetIlsFraction === null ? "ILS n/a" : `${formatFixedValue(dependency.targetIlsFraction, 2)} target ILS`}</span>
                                </div>
                              </summary>
                              <div className="production-ingredient-body">
                                <p className="helper-text">
                                  {dependency.sourcesLabel}
                                  {dependency.shortagePerMinute > 0 ? ` | Missing ${formatValue(dependency.shortagePerMinute)} / min.` : ""}
                                  {dependency.hasOutboundIlsWarning ? " Source outbound ILS is overbooked." : ""}
                                </p>
                                {dependency.sources.length > 0 && (
                                  <div className="overview-breakdown-list">
                                    {dependency.sources.map((source) => (
                                      <article key={`${dependency.dependency.item_key}:${source.producerId}`} className="overview-breakdown-row production-breakdown-row">
                                        <div className="overview-breakdown-row-top">
                                          <div className="production-ingredient-heading">
                                            <ResourceIcon
                                              name={dependency.dependency.display_name}
                                              iconUrl={getIconUrlForName(dependency.dependency.display_name)}
                                              colorStart={productionIconStart}
                                              colorEnd={productionIconEnd}
                                              size="sm"
                                            />
                                            <div>
                                              <strong>{source.planetName}</strong>
                                              <span>{source.solarSystemName} | {source.producerName}</span>
                                            </div>
                                          </div>
                                          <div className="overview-breakdown-values">
                                            <strong>{formatValue(source.throughputPerMinute)} / min</strong>
                                            <span>
                                              {source.isLocalPlanet
                                                ? "Local planet"
                                                : source.isLocalSystem
                                                  ? "Local system"
                                                  : `Source ILS ${source.sourceStationsNeeded === null ? "n/a" : formatFixedValue(source.sourceStationsNeeded, 2)}`}
                                            </span>
                                          </div>
                                        </div>
                                      </article>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </details>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="empty-state">Pick a valid system and planet to preview this site.</p>
                    )}
                  </div>

                  <div className="production-modal-side">
                    <div className="overview-breakdown-panel">
                      <div className="overview-breakdown-heading">
                        <h4>Recipe</h4>
                        <span>{selectedProductionTemplate.recipe || "Imported"}</span>
                      </div>
                      <div className="production-machine-pill production-machine-pill-static">
                        <ResourceIcon
                          name={selectedProductionTemplate.machine_label || "Factory"}
                          iconUrl={getIconUrlForName(selectedProductionTemplate.machine_label || "Factory")}
                          colorStart="#99c9ff"
                          colorEnd="#5578b5"
                          size="sm"
                        />
                        {selectedProductionTemplate.machine_label || "Imported machine"}
                      </div>
                      <p className="helper-text">{selectedProductionTemplate.outputs || "Single-output imported recipe."}</p>
                    </div>

                    <button type="submit" className="primary-button full-width" disabled={busy || !productionDraft.itemKey || !productionDraft.planetId}>
                      Add production site
                    </button>
                  </div>
                </form>
              </section>
            </div>
          )}

          {activeView === "map" && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Star Map</p>
                <h2>Systems and planets</h2>
              </div>
              <span className="helper-text">Select a system or planet to inspect extraction and manage its name.</span>
            </div>

            {mapSystemCards.length > 0 ? (
              <div className="map-system-grid">
                {mapSystemCards.map(({ solarSystem, planets, extractionSiteCount, activePlanetCount }) => {
                  const isSystemSelected =
                    selectedMapSelection.scope === "system" && selectedMapSelection.id === solarSystem.id;

                  return (
                    <section
                      key={solarSystem.id}
                      className={`map-system-card ${isSystemSelected ? "map-system-card-active" : ""}`}
                    >
                      <button
                        type="button"
                        className="map-system-button"
                        onClick={() => setSelectedMapSelection({ scope: "system", id: solarSystem.id })}
                      >
                        <div>
                          <p className="ledger-system-name">Solar system</p>
                          <h3>{solarSystem.name}</h3>
                        </div>
                        <div className="map-system-meta">
                          <span>{planets.length} planets</span>
                          <span>{extractionSiteCount} sites</span>
                          <span>{activePlanetCount} active</span>
                        </div>
                      </button>

                      <div className="map-planet-list">
                        {planets.length > 0 ? (
                          planets.map((planet) => {
                            const isPlanetSelected =
                              selectedMapSelection.scope === "planet" && selectedMapSelection.id === planet.id;
                            const siteCount = extractionSiteCountByPlanetId.get(planet.id) ?? 0;

                            return (
                              <button
                                key={planet.id}
                                type="button"
                                className={`map-planet-button ${isPlanetSelected ? "map-planet-button-active" : ""}`}
                                onClick={() => setSelectedMapSelection({ scope: "planet", id: planet.id })}
                              >
                                <div className="map-planet-copy">
                                  <strong>{planet.name}</strong>
                                  <span>
                                    {planet.planet_type === "gas_giant" ? "Gas giant" : "Solid planet"} | {siteCount} sites
                                  </span>
                                </div>
                                {planet.id === data.settings.currentPlanetId && <span className="resource-badge">Current</span>}
                              </button>
                            );
                          })
                        ) : (
                          <p className="helper-text">No planets in this system yet.</p>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : (
              <p className="empty-state">Add a solar system from the logging tab to start building your map.</p>
            )}
          </section>
          )}

{activeView === "log" && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Planet Ledger</p>
                <h2>Extraction log</h2>
              </div>
              <label className="toggle-field">
                <input type="checkbox" checked={showAllLedger} onChange={(event) => setShowAllLedger(event.target.checked)} />
                <span>Show all planets</span>
              </label>
            </div>

            {!currentPlanet && !showAllLedger && <p className="empty-state">Pick a planet or enable all-planets view.</p>}

            {ledgerGroups.length > 0 && (
              <div className="ledger-stack">
                {ledgerGroups.map((group) => (
                  <section key={group.planet.id} className="ledger-group">
                    <div className="ledger-group-header">
                      <div className="ledger-group-context">
                        <p className="ledger-system-name">{group.systemName}</p>
                        <h3>{group.planet.name}</h3>
                        <p className="ledger-power-line">Extraction power demand {formatValue(group.powerDemandMw, 2)} MW</p>
                        {group.planet.planet_type === "gas_giant" && <span className="resource-badge">Gas giant</span>}
                      </div>
                    </div>

                    <div className="ledger-stack">
                      {group.items.map((item) => {
                        if (item.kind === "ore") {
                          const vein = item.data;
                          const miners = oreMinerLookup[vein.id] ?? [];
                          const throughputPerMinute = getOreVeinOutputPerMinute(miners, data.settings.miningSpeedPercent);

                          return (
                            <article key={vein.id} className="ledger-item">
                              <div>
                                <h3>{getResourceName(data.resources, vein.resource_id)}</h3>
                                <p>{miners.length} {miners.length === 1 ? "miner" : "miners"} | {formatValue(throughputPerMinute)} ore/min | {formatValue(throughputPerMinute / 30)} node equivalents</p>
                                {renderLocationEditor(`ore:${vein.id}`, `/api/ore-veins/${vein.id}/location`, "solid")}
                              </div>
                              <div className="ledger-item-actions">
                                <button type="button" className="ghost-button" onClick={() => startLocationEdit(`ore:${vein.id}`, vein.planet_id, "solid")}>
                                  Move
                                </button>
                                <button type="button" className="ghost-button" onClick={() => void confirmAndDelete(`/api/ore-veins/${vein.id}`, `${getResourceName(data.resources, vein.resource_id)} vein`)}>
                                  Delete
                                </button>
                              </div>
                            </article>
                          );
                        }

                        if (item.kind === "liquid") {
                          const site = item.data;
                          return (
                            <article key={site.id} className="ledger-item">
                              <div>
                                <h3>{getResourceName(data.resources, site.resource_id)}</h3>
                                <p>{site.pump_count} pumps</p>
                                {renderLocationEditor(`liquid:${site.id}`, `/api/liquids/${site.id}/location`, "solid")}
                              </div>
                              <div className="ledger-item-actions">
                                <button type="button" className="ghost-button" onClick={() => startLocationEdit(`liquid:${site.id}`, site.planet_id, "solid")}>
                                  Move
                                </button>
                                <button type="button" className="ghost-button" onClick={() => void confirmAndDelete(`/api/liquids/${site.id}`, `${getResourceName(data.resources, site.resource_id)} pump site`)}>
                                  Delete
                                </button>
                              </div>
                            </article>
                          );
                        }

                        if (item.kind === "oil") {
                          const site = item.data as OilExtractor;
                          const oilPerSecondActual = getOilOutputPerSecond(site.oil_per_second);
                          return (
                            <article key={site.id} className="ledger-item">
                              <div>
                                <h3>{getResourceName(data.resources, site.resource_id)}</h3>
                                <p>{formatValue(oilPerSecondActual)} / sec | {formatValue(oilPerSecondActual * 60)} / min</p>
                                {renderLocationEditor(`oil:${site.id}`, `/api/oil-extractors/${site.id}/location`, "solid")}
                              </div>
                              <div className="ledger-item-actions">
                                <button type="button" className="ghost-button" onClick={() => startLocationEdit(`oil:${site.id}`, site.planet_id, "solid")}>
                                  Move
                                </button>
                                <button type="button" className="ghost-button" onClick={() => void confirmAndDelete(`/api/oil-extractors/${site.id}`, `${getResourceName(data.resources, site.resource_id)} extractor`)}>
                                  Delete
                                </button>
                              </div>
                            </article>
                          );
                        }

                        const site = item.data as GasGiantSite;
                        const outputs = gasOutputLookup[site.id] ?? [];
                        const trueBoost = getOrbitalCollectorTrueBoost(
                          outputs.map((output) => ({
                            ratePerSecond: Number(output.rate_per_second),
                            fuelValueMj: Number(resourceLookup.get(output.resource_id)?.fuel_value_mj ?? 0),
                          })),
                          data.settings.miningSpeedPercent,
                        );
                        const detail = outputs
                          .map((output) => `${getResourceName(data.resources, output.resource_id)} ${formatValue(output.rate_per_second * trueBoost * site.collector_count * 60)}/min`)
                          .join(" | ");

                        return (
                          <article key={site.id} className="ledger-item">
                            <div>
                              <h3>Collector ring</h3>
                              <p>{site.collector_count} collectors | {detail}</p>
                              {renderLocationEditor(`gas:${site.id}`, `/api/gas-giants/${site.id}/location`, "gas_giant")}
                            </div>
                            <div className="ledger-item-actions">
                              <button type="button" className="ghost-button" onClick={() => startLocationEdit(`gas:${site.id}`, site.planet_id, "gas_giant")}>
                                Move
                              </button>
                              <button type="button" className="ghost-button" onClick={() => void confirmAndDelete(`/api/gas-giants/${site.id}`, "gas giant site")}>
                                Delete
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}

            {ledgerGroups.length === 0 && <p className="empty-state">No extraction sites logged yet for the selected ledger view.</p>}
          </section>
          )}
        </div>

        {(activeView === "map" || activeView === "projects" || activeView === "settings") && (
        <aside className="sidebar-column">
          {activeView === "map" && (
          <>
            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Selection</p>
                  <h2>{selectedMapSelection.scope === "planet" ? "Planet details" : "System details"}</h2>
                </div>
              </div>

              {selectedMapPlanet || selectedMapSystem ? (
                <>
                  <div className="map-detail-header">
                    <div>
                      <p className="eyebrow">{selectedMapPlanet ? "Planet" : "Solar System"}</p>
                      <h3>{selectedMapPlanet?.name ?? selectedMapSystem?.name}</h3>
                      <p className="helper-text">
                        {selectedMapPlanet
                          ? `${selectedMapParentSystem?.name ?? "Unknown System"} | ${
                              selectedMapPlanet.planet_type === "gas_giant" ? "Gas giant" : "Solid planet"
                            }`
                          : `${selectedMapPlanetIds.length} planets in this system`}
                      </p>
                    </div>
                    {selectedMapSystem?.id === data.settings.currentSolarSystemId && (
                      <span className="resource-badge">Current system</span>
                    )}
                  </div>

                  <div className="map-stat-grid">
                    <article className="map-stat-card">
                      <span>{selectedMapPlanet ? "Planet type" : "Planets"}</span>
                      <strong>{selectedMapPlanet ? (selectedMapPlanet.planet_type === "gas_giant" ? "Gas giant" : "Solid") : selectedMapPlanetIds.length}</strong>
                    </article>
                    <article className="map-stat-card">
                      <span>Extraction sites</span>
                      <strong>{selectedMapExtractionSiteCount}</strong>
                    </article>
                    <article className="map-stat-card">
                      <span>Tracked resources</span>
                      <strong>{selectedMapExtraction.resourceRows.length}</strong>
                    </article>
                    <article className="map-stat-card">
                      <span>Extraction power demand</span>
                      <strong>{formatValue(selectedMapPowerDemandMw, 2)} MW</strong>
                    </article>
                  </div>

                  <div className="divider" />

                  {selectedMapSystem && (
                    <>
                      <label className="field">
                        <span>System name</span>
                        <input
                          value={systemNameDrafts[selectedMapSystem.id] ?? selectedMapSystem.name}
                          onChange={(event) =>
                            setSystemNameDrafts((current) => ({
                              ...current,
                              [selectedMapSystem.id]: event.target.value,
                            }))
                          }
                          disabled={busy || selectedMapSystem.generated_name_locked === 1}
                        />
                      </label>
                      {selectedMapSystem.generated_name_locked === 1 && (
                        <p className="helper-text">Cluster-imported system names are locked to the generated star catalog.</p>
                      )}
                      <div className="admin-actions">
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => void handleRenameSystem(selectedMapSystem.id)}
                          disabled={busy || selectedMapSystem.generated_name_locked === 1 || !(systemNameDrafts[selectedMapSystem.id] ?? selectedMapSystem.name).trim()}
                        >
                          Save system name
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => void confirmAndDelete(`/api/systems/${selectedMapSystem.id}`, `solar system ${selectedMapSystem.name}`)}
                        >
                          Delete system
                        </button>
                      </div>
                    </>
                  )}

                  {selectedMapPlanet && (
                    <>
                      <label className="field">
                        <span>Planet name</span>
                        <input
                          value={planetNameDrafts[selectedMapPlanet.id] ?? selectedMapPlanet.name}
                          onChange={(event) =>
                            setPlanetNameDrafts((current) => ({
                              ...current,
                              [selectedMapPlanet.id]: event.target.value.replace(/\s{2,}/g, " "),
                            }))
                          }
                          disabled={busy}
                        />
                      </label>
                      <div className="admin-actions">
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => void handleRenamePlanet(selectedMapPlanet.id)}
                          disabled={busy || !normalizePlanetName(planetNameDrafts[selectedMapPlanet.id] ?? selectedMapPlanet.name)}
                        >
                          Save planet name
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => void confirmAndDelete(`/api/planets/${selectedMapPlanet.id}`, `planet ${selectedMapPlanet.name}`)}
                        >
                          Delete planet
                        </button>
                      </div>

                      <div className="divider" />

                      <label className="field">
                        <span>Outbound raw ILS on this planet</span>
                        <input
                          type="number"
                          min={0}
                          step="1"
                          value={planetExtractionIlsDrafts[selectedMapPlanet.id] ?? ""}
                          onChange={(event) =>
                            setPlanetExtractionIlsDrafts((current) => ({
                              ...current,
                              [selectedMapPlanet.id]: event.target.value,
                            }))
                          }
                          placeholder="Leave blank if unknown"
                        />
                      </label>
                      <div className="action-row">
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => void handleSavePlanetExtractionIls(selectedMapPlanet.id)}
                          disabled={busy}
                        >
                          Save raw ILS count
                        </button>
                        <span className="helper-text">Used by project warnings when this extraction planet feeds remote production.</span>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p className="empty-state">Choose a system or planet from the map to inspect it here.</p>
              )}
            </section>

            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Extraction</p>
                  <h2>Resource rollup</h2>
                </div>
              </div>

              {selectedMapExtraction.resourceRows.length > 0 ? (
                <div className="map-resource-list">
                  {selectedMapExtraction.resourceRows.map((row) => (
                    <article key={row.resourceId} className="map-resource-row">
                      <div className="map-resource-title">
                        <ResourceIcon
                          name={row.name}
                          iconUrl={row.iconUrl}
                          colorStart={row.colorStart}
                          colorEnd={row.colorEnd}
                          size="sm"
                        />
                        <div>
                          <strong>{row.name}</strong>
                          <span>{row.placementCount} setups</span>
                        </div>
                      </div>
                      <div className="map-resource-values">
                        <strong>{describeExtractionRollup(row)}</strong>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty-state">No extraction is logged for this selection yet.</p>
              )}
            </section>

            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Activity</p>
                  <h2>Logged extraction sites</h2>
                </div>
              </div>

              {selectedMapExtraction.activityRows.length > 0 ? (
                <div className="map-activity-list">
                  {selectedMapExtraction.activityRows.map((row) => (
                    <article key={`${row.kind}:${row.id}`} className="map-activity-row">
                      <div className="map-activity-copy">
                        <div className="map-activity-top">
                          <strong>{row.title}</strong>
                          <span>{row.kind === "gas" ? "Gas giant" : row.kind === "oil" ? "Oil" : row.kind === "liquid" ? "Liquid" : "Ore"}</span>
                        </div>
                        <p>{row.detail}</p>
                        <span className="helper-text">
                          {selectedMapPlanet ? row.systemName : `${row.systemName} | ${row.planetName}`}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty-state">No extraction sites are attached to this system or planet yet.</p>
              )}
            </section>
          </>
          )}

          {false && activeView === "settings" && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Configuration</p>
                <h2>Mining speed</h2>
              </div>
            </div>
            <label className="field">
              <span>Mining speed %</span>
              <input
                type="number"
                min={1}
                max={500}
                value={loadedData.settings.miningSpeedPercent}
                onChange={(event) =>
                  void updateSettings({
                    miningSpeedPercent: Number(event.target.value),
                  })
                }
              />
            </label>
            <div className="action-row">
              <button
                type="button"
                className="ghost-button"
                onClick={() =>
                  void updateSettings({
                    miningSpeedPercent: loadedData.settings.miningSpeedPercent + 10,
                  })
                }
              >
                +10%
              </button>
              <span className="helper-text">100% is base speed. Applied to ore miners, pumps, and orbital collectors.</span>
            </div>
          </section>
          )}

          {activeView === "settings" && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Transportation</p>
                <h2>Vessel settings</h2>
              </div>
            </div>
            <label className="field">
              <span>Vessel capacity</span>
              <input
                type="number"
                min={1}
                max={100000}
                value={data.settings.vesselCapacityItems}
                onChange={(event) =>
                  void updateSettings({
                    vesselCapacityItems: Number(event.target.value),
                  })
                }
              />
            </label>
            <div className="action-row">
              <button
                type="button"
                className="ghost-button"
                onClick={() =>
                  void updateSettings({
                    vesselCapacityItems: data.settings.vesselCapacityItems + 200,
                  })
                }
              >
                +200
              </button>
              <span className="helper-text">Each interstellar station can house 10 vessels.</span>
            </div>
            <label className="field">
              <span>ILS storage</span>
              <input
                type="number"
                min={1}
                max={1000000}
                value={data.settings.ilsStorageItems}
                onChange={(event) =>
                  void updateSettings({
                    ilsStorageItems: Number(event.target.value),
                  })
                }
              />
            </label>
            <div className="action-row">
              <button
                type="button"
                className="ghost-button"
                onClick={() =>
                  void updateSettings({
                    ilsStorageItems: data.settings.ilsStorageItems + 2000,
                  })
                }
              >
                +2000
              </button>
              <span className="helper-text">Used for the target ILS storage estimate in quick calc.</span>
            </div>
            <label className="field">
              <span>Vessel speed (ly / sec)</span>
              <input
                type="number"
                min={0.001}
                step="any"
                value={data.settings.vesselSpeedLyPerSecond}
                onChange={(event) =>
                  void updateSettings({
                    vesselSpeedLyPerSecond: Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="field">
              <span>Dock / undock seconds per leg</span>
              <input
                type="number"
                min={0}
                step="any"
                value={data.settings.vesselDockingSeconds}
                onChange={(event) =>
                  void updateSettings({
                    vesselDockingSeconds: Number(event.target.value),
                  })
                }
              />
            </label>
          </section>
          )}

          {activeView === "settings" && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Fallback tools</p>
                <h2>Manual distances and quick calc</h2>
              </div>
            </div>
            <div className="transport-form-grid transport-form-grid-compact">
              <label className="field">
                <span>Distance (ly)</span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={quickCalcDistanceLy}
                  onChange={(event) => setQuickCalcDistanceLy(Number(event.target.value))}
                />
              </label>

              <label className="field">
                <span>Throughput / min</span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={quickCalcThroughputPerMinute}
                  onChange={(event) => setQuickCalcThroughputPerMinute(Number(event.target.value))}
                />
              </label>
            </div>
            <div className="transport-metric-grid">
              <div className="entry-stat">
                <span>Round trip</span>
                <strong>{quickCalcRoundTripSeconds === null ? "Incomplete" : `${formatFixedValue(quickCalcRoundTripSeconds, 1)} s`}</strong>
              </div>
              <div className="entry-stat">
                <span>Per vessel</span>
                <strong>{quickCalcItemsPerMinutePerVessel === null ? "Incomplete" : `${formatFixedValue(quickCalcItemsPerMinutePerVessel, 1)} / min`}</strong>
              </div>
              <div className="entry-stat">
                <span>Required ILS</span>
                <strong>{quickCalcRequiredStations === null ? "Incomplete" : formatFixedValue(quickCalcRequiredStations, 1)}</strong>
              </div>
              <div className="entry-stat">
                <span>Target ILS</span>
                <strong>{quickCalcTargetStationsNeeded === null ? "Incomplete" : formatFixedValue(quickCalcTargetStationsNeeded, 1)}</strong>
              </div>
            </div>

            <div className="divider" />

            <form
              className="transport-form-grid"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateSystemDistance();
              }}
            >
              <label className="field">
                <span>System A</span>
                <select
                  value={distanceDraft.systemAId}
                  onChange={(event) => setDistanceDraft((current) => ({ ...current, systemAId: event.target.value }))}
                >
                  <option value="">Select system</option>
                  {data.solarSystems.map((solarSystem) => (
                    <option key={solarSystem.id} value={solarSystem.id}>
                      {solarSystem.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>System B</span>
                <select
                  value={distanceDraft.systemBId}
                  onChange={(event) => setDistanceDraft((current) => ({ ...current, systemBId: event.target.value }))}
                >
                  <option value="">Select system</option>
                  {data.solarSystems.map((solarSystem) => (
                    <option key={solarSystem.id} value={solarSystem.id}>
                      {solarSystem.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Distance (ly)</span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={distanceDraft.distanceLy}
                  onChange={(event) => setDistanceDraft((current) => ({ ...current, distanceLy: Number(event.target.value) }))}
                />
              </label>

              <div className="transport-form-actions">
                <button type="submit" className="primary-button" disabled={busy || data.solarSystems.length < 2}>
                  Save distance
                </button>
              </div>
            </form>

            {sortedSystemDistances.length > 0 ? (
              <div className="transport-ledger">
                {sortedSystemDistances.map((distance) => {
                  const systemALabel = systemLookup.get(distance.system_a_id)?.name ?? "Unknown System";
                  const systemBLabel = systemLookup.get(distance.system_b_id)?.name ?? "Unknown System";

                  return (
                    <article key={distance.id} className="transport-row-card">
                      <div className="transport-row-main">
                        <div>
                          <h3>{systemALabel} {"->"} {systemBLabel}</h3>
                          <p>{formatFixedValue(Number(distance.distance_ly), 1)} ly</p>
                        </div>
                        <div className="ledger-item-actions">
                          <button type="button" className="ghost-button" onClick={() => startDistanceEdit(distance)}>
                            Edit
                          </button>
                          <button type="button" className="ghost-button" onClick={() => void confirmAndDelete(`/api/system-distances/${distance.id}`, `distance ${systemALabel} to ${systemBLabel}`)}>
                            Delete
                          </button>
                        </div>
                      </div>

                      {editingDistanceId === distance.id && (
                        <div className="transport-inline-editor">
                          <label className="field">
                            <span>System A</span>
                            <select
                              value={editingDistanceDraft.systemAId}
                              onChange={(event) => setEditingDistanceDraft((current) => ({ ...current, systemAId: event.target.value }))}
                            >
                              <option value="">Select system</option>
                              {data.solarSystems.map((solarSystem) => (
                                <option key={solarSystem.id} value={solarSystem.id}>
                                  {solarSystem.name}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="field">
                            <span>System B</span>
                            <select
                              value={editingDistanceDraft.systemBId}
                              onChange={(event) => setEditingDistanceDraft((current) => ({ ...current, systemBId: event.target.value }))}
                            >
                              <option value="">Select system</option>
                              {data.solarSystems.map((solarSystem) => (
                                <option key={solarSystem.id} value={solarSystem.id}>
                                  {solarSystem.name}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="field">
                            <span>Distance (ly)</span>
                            <input
                              type="number"
                              min={0}
                              step="any"
                              value={editingDistanceDraft.distanceLy}
                              onChange={(event) => setEditingDistanceDraft((current) => ({ ...current, distanceLy: Number(event.target.value) }))}
                            />
                          </label>

                          <div className="transport-form-actions">
                            <button type="button" className="primary-button" onClick={() => void handleSaveDistanceEdit()} disabled={busy}>
                              Save
                            </button>
                            <button type="button" className="ghost-button" onClick={cancelDistanceEdit} disabled={busy}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="empty-state">No manual distance fallbacks saved.</p>
            )}
          </section>
          )}

          {activeView === "projects" && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Projects</p>
                <h2>Demand editor</h2>
              </div>
            </div>

            <div className="project-pills">
              {data.projects.map((project: Project) => (
                <button
                  key={project.id}
                  type="button"
                  className={`project-pill ${project.id === selectedProjectId ? "project-pill-active" : ""}`}
                  onClick={() => setSelectedProjectId(project.id)}
                >
                  {project.name}
                  <span>{project.is_active === 1 ? "Active" : "Archived"}</span>
                </button>
              ))}
            </div>

            {selectedProject && (
              <>
                <label className="field">
                  <span>Name</span>
                  <input value={projectNameDraft} onChange={(event) => setProjectNameDraft(event.target.value)} />
                </label>
                <label className="field">
                  <span>Notes</span>
                  <AutoGrowTextarea value={projectNotesDraft} onChange={(event) => setProjectNotesDraft(event.target.value)} rows={3} />
                </label>
                <label className="toggle-field">
                  <input type="checkbox" checked={projectActiveDraft} onChange={(event) => setProjectActiveDraft(event.target.checked)} />
                  <span>Counts toward combined demand</span>
                </label>
                <div className="goal-list">
                  {data.resources.map((resource) => {
                    const summary = data.summary.resourceSummaries.find((item) => item.resourceId === resource.id);
                    return (
                      <label key={resource.id} className="goal-row">
                        <div className="goal-row-title">
                          <ResourceIcon
                            name={resource.name}
                            iconUrl={resource.icon_url}
                            colorStart={resource.color_start}
                            colorEnd={resource.color_end}
                            size="sm"
                          />
                          <div>
                            <strong>{resource.name}</strong>
                            <span>{summary?.goalUnitLabel}</span>
                          </div>
                        </div>
                        <input
                          type="number"
                          min={0}
                          step={resource.type === "oil_extractor" || resource.type === "gas_giant_output" ? 0.1 : 1}
                          value={goalDrafts[resource.id] ?? 0}
                          onChange={(event) =>
                            setGoalDrafts((current) => ({
                              ...current,
                              [resource.id]: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                    );
                  })}
                </div>
                <button type="button" className="primary-button full-width" onClick={() => void handleSaveProject()} disabled={busy}>
                  Save project
                </button>

                <div className="divider" />

                <div className="section-heading compact-section-heading">
                  <div>
                    <p className="eyebrow">Import</p>
                    <h3>Replace from CSV</h3>
                  </div>
                </div>
                <FileDropInput
                  accept=".csv,text/csv"
                  description="Drop a FactorioLab CSV here to replace this project's raw goals and crafted-item production catalog."
                  disabled={busy}
                  label="Existing project CSV"
                  onSelect={(file) => void handleExistingProjectCsvImport(file)}
                />
              </>
            )}

            <div className="divider" />

            <label className="field">
              <span>New project name</span>
              <input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="Mall expansion" />
            </label>
            <label className="field">
              <span>Notes</span>
              <AutoGrowTextarea value={newProjectNotes} onChange={(event) => setNewProjectNotes(event.target.value)} rows={2} />
            </label>
            <button type="button" className="ghost-button full-width" onClick={() => void handleCreateProject()} disabled={busy}>
              Create project
            </button>

            <div className="divider" />

            <div className="section-heading compact-section-heading">
              <div>
                <p className="eyebrow">Import</p>
                <h3>New project from CSV</h3>
              </div>
            </div>
            <FileDropInput
              accept=".csv,text/csv"
              description="Drop a FactorioLab CSV here to create a project with raw goals and a crafted-item production catalog."
              disabled={busy}
              label="Project CSV"
              onSelect={(file) => void handleProjectCsvImport(file)}
            />
          </section>
          )}

          {activeView === "settings" && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Cluster</p>
                <h2>Cluster address</h2>
              </div>
            </div>
            <label className="field">
              <span>Cluster address</span>
              <input
                value={clusterAddressDraft}
                onChange={(event) => setClusterAddressDraft(event.target.value)}
                placeholder="07198444-64-799-10"
              />
            </label>
            <p className="helper-text">
              {parsedClusterAddress
                ? `Seed ${parsedClusterAddress.clusterSeed} · ${parsedClusterAddress.clusterStarCount} stars · ${loadedData.summary.generatedSystemCount} generated systems currently stored.`
                : clusterAddressDraft.trim()
                  ? "Cluster address format not recognized yet."
                  : "Import a DSP cluster address to generate exact system coordinates and automatic inter-system distances."}
            </p>
            <button type="button" className="primary-button full-width" onClick={() => void handleImportClusterAddress()} disabled={busy || !parsedClusterAddress}>
              Import cluster systems
            </button>
          </section>
          )}

          {activeView === "settings" && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Catalog</p>
                <h2>Custom resources</h2>
              </div>
            </div>
            <label className="field">
              <span>Resource name</span>
              <input value={newResourceName} onChange={(event) => setNewResourceName(event.target.value)} placeholder="Optical ore" />
            </label>
            <label className="field">
              <span>Type</span>
              <select value={newResourceType} onChange={(event) => setNewResourceType(event.target.value as ResourceType)}>
                <option value="ore_vein">Ore vein</option>
                <option value="liquid_pump">Liquid pump</option>
                <option value="oil_extractor">Oil extractor</option>
                <option value="gas_giant_output">Gas giant output</option>
              </select>
            </label>
            <button
              type="button"
              className="ghost-button full-width"
              onClick={() =>
                void mutate(
                  () =>
                    postBootstrap("/api/resources", {
                      name: newResourceName,
                      type: newResourceType,
                    }),
                  (nextData) => {
                    applyBootstrap(nextData);
                    setNewResourceName("");
                  },
                )
              }
              disabled={busy || !newResourceName.trim()}
            >
              Add resource
            </button>
          </section>
          )}

          {activeView === "settings" && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Backups</p>
                <h2>Import / export</h2>
              </div>
            </div>
            <button type="button" className="primary-button full-width" onClick={() => void handleExport()} disabled={busy}>
              Export JSON snapshot
            </button>
            <FileDropInput
              accept=".json,application/json"
              description="Drop a snapshot backup here to replace the current local dataset."
              disabled={busy}
              label="Snapshot JSON"
              onSelect={(file) => void handleImport(file)}
            />
          </section>
          )}
        </aside>
        )}
      </section>
    </main>
  );
}

export default App;

