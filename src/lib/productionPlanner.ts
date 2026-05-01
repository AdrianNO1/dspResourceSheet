import {
  METERS_PER_AU,
  getAdvancedMinerOutputPerMinute,
  getOilOutputPerSecond,
  getOrbitalCollectorTrueBoost,
  getPumpOutputPerMinute,
  getRegularMinerOutputPerMinute,
  getRequiredStations,
  getRequiredStationsForRoundTripSeconds,
  getTargetStationsNeeded,
  getTargetStationsNeededForRoundTripSeconds,
  getTransportRoundTripSeconds,
  getTransportRoundTripSecondsMeters,
} from "./dspMath";
import { getPlanetExtractionOutboundIlsCount } from "../domain/planetLogistics";
import { getAdjustedLineCount, getRoundedMachinePlan } from "../domain/productionMath";
import { getSystemDistanceLy } from "./dspCluster";
import type {
  BootstrapData,
  GasGiantOutput,
  Planet,
  ProductionSite,
  ProjectImportedDependency,
  ProjectImportedItem,
  ResourceDefinition,
} from "./types";

type ProducerKind = "raw" | "crafted";
type SameSystemTransportMode = "cruise" | "warp";
const SAME_SYSTEM_DISTANCE_AU = 5;

type ProducerNode = {
  id: string;
  kind: ProducerKind;
  key: string;
  resourceId: string | null;
  displayName: string;
  solarSystemId: string;
  solarSystemName: string;
  planetId: string;
  planetName: string;
  availablePerMinute: number;
  createdAt: string;
  productionSiteId: string | null;
  extractionOutboundIlsCount: number | null;
};

type ConsumerNode = {
  id: string;
  key: string;
  siteId: string;
  solarSystemId: string;
  planetId: string;
  requiredPerMinute: number;
  displayName: string;
  sameSystemTransportMode: SameSystemTransportMode;
};

type Allocation = {
  producerId: string;
  consumerId: string;
  throughputPerMinute: number;
  distanceLy: number | null;
  targetStationsNeeded: number | null;
  sourceStationsNeeded: number | null;
  isLocalPlanet: boolean;
  isLocalSystem: boolean;
  sameSystemTransportMode: SameSystemTransportMode | null;
};

export type ProductionIngredientSource = {
  producerId: string;
  producerName: string;
  planetName: string;
  solarSystemName: string;
  distanceLy: number | null;
  throughputPerMinute: number;
  isLocalPlanet: boolean;
  isLocalSystem: boolean;
  sameSystemTransportMode: SameSystemTransportMode | null;
  sourceStationsNeeded: number | null;
  targetStationsNeeded: number | null;
  hasSourceIlsWarning: boolean;
};

export type ProductionSiteDependencyView = {
  dependency: ProjectImportedDependency;
  requiredPerMinute: number;
  requiredBelts: number;
  beltsPerLine: number;
  coveragePerMinute: number;
  coveragePercent: number;
  shortagePerMinute: number;
  targetIlsFraction: number | null;
  sourcesLabel: string;
  hasSourceIlsWarning: boolean;
  sources: ProductionIngredientSource[];
};

export type MixedIlsBin = {
  id: string;
  fill: number;
  entries: Array<{ itemName: string; fraction: number }>;
};

export type ProductionSiteView = {
  site: ProductionSite;
  importedItem: ProjectImportedItem;
  solarSystemName: string;
  planetName: string;
  machineCount: number;
  lineCount: number;
  assemblersPerLine: number;
  outputBeltsPerLine: number;
  outboundIlsRequired: number;
  dependencies: ProductionSiteDependencyView[];
  mixedIlsFullStationCount: number;
  mixedIlsBins: MixedIlsBin[];
};

export type ProductionItemSummary = {
  itemKey: string;
  displayName: string;
  totalPlannedThroughput: number;
  activeSiteCount: number;
  siteCount: number;
  coveragePercent: number;
  hasShortage: boolean;
  plannedLineCount: number;
  plannedMachineCount: number;
};

export type ProductionWarning = {
  id: string;
  kind: "missing-extraction-ils" | "overbooked-extraction-ils" | "overbooked-outbound-ils" | "unfinished-required-site" | "shortage";
  title: string;
  detail: string;
  severity: "warning" | "danger";
};

export type ProductionOverviewStats = {
  importedCraftedCount: number;
  importedRawCount: number;
  placedSiteCount: number;
  activeSiteCount: number;
  plannedCraftedThroughput: number;
  activeCraftedThroughput: number;
  plannedLineCount: number;
  coveredRawGoals: number;
  totalRawGoals: number;
  rawCoveragePercent: number;
  warningCount: number;
};

export type ProductionDraftPreview = {
  itemKey: string;
  displayName: string;
  throughputPerMinute: number;
  machineCount: number;
  machineLabel: string;
  lineCount: number;
  assemblersPerLine: number;
  outputBelts: number;
  outputBeltsPerLine: number;
  recipe: string;
  outputs: string;
  dependencies: ProductionSiteDependencyView[];
  mixedIlsFullStationCount: number;
  mixedIlsBins: MixedIlsBin[];
  solarSystemName: string;
  planetName: string;
};

export type ProductionPlannerResult = {
  itemChoices: ProjectImportedItem[];
  itemSummaries: ProductionItemSummary[];
  siteViews: ProductionSiteView[];
  warnings: ProductionWarning[];
  overview: ProductionOverviewStats;
};

type ProjectContext = {
  importedItems: ProjectImportedItem[];
  importedItemLookup: Map<string, ProjectImportedItem>;
  producers: ProducerNode[];
  consumers: ConsumerNode[];
  allocations: Allocation[];
  allocationsByConsumer: Record<string, Allocation[]>;
  outboundIlsRequiredBySiteId: Record<string, number>;
  warnedSourceProducerIds: Set<string>;
};

function roundUp(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.ceil(value * factor - 1e-9) / factor;
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function getPlanetLookup(data: BootstrapData) {
  return new Map(data.planets.map((planet) => [planet.id, planet]));
}

function getSystemLookup(data: BootstrapData) {
  return new Map(data.solarSystems.map((system) => [system.id, system]));
}

function getProjectImportedItems(data: BootstrapData, projectId: string) {
  return data.projectImportedItems
    .filter((item) => item.project_id === projectId)
    .sort((left, right) => left.display_name.localeCompare(right.display_name));
}

function buildRawProducers(data: BootstrapData) {
  const producers = new Map<string, ProducerNode>();
  const planetLookup = getPlanetLookup(data);
  const systemLookup = getSystemLookup(data);
  const resourceLookup = new Map(data.resources.map((resource) => [resource.id, resource]));
  const oreMinerLookup = data.oreVeinMiners.reduce<Record<string, typeof data.oreVeinMiners>>((acc, miner) => {
    acc[miner.ore_vein_id] ??= [];
    acc[miner.ore_vein_id].push(miner);
    return acc;
  }, {});
  const gasOutputLookup = data.gasGiantOutputs.reduce<Record<string, GasGiantOutput[]>>((acc, output) => {
    acc[output.gas_giant_site_id] ??= [];
    acc[output.gas_giant_site_id].push(output);
    return acc;
  }, {});

  function addProducer(resource: ResourceDefinition | undefined, planet: Planet | undefined, amountPerMinute: number, createdAt: string) {
    if (!resource || !planet || amountPerMinute <= 0) {
      return;
    }

    const solarSystem = systemLookup.get(planet.solar_system_id);
    if (!solarSystem) {
      return;
    }

    const key = `raw:${resource.id}:${planet.id}`;
    const existing = producers.get(key);
    if (existing) {
      existing.availablePerMinute += amountPerMinute;
      return;
    }

    producers.set(key, {
      id: key,
      kind: "raw",
      key: normalizeKey(resource.name),
      resourceId: resource.id,
      displayName: resource.name,
      solarSystemId: solarSystem.id,
      solarSystemName: solarSystem.name,
      planetId: planet.id,
      planetName: planet.name,
      availablePerMinute: amountPerMinute,
      createdAt,
      productionSiteId: null,
      extractionOutboundIlsCount: getPlanetExtractionOutboundIlsCount(planet, resource.id),
    });
  }

  for (const vein of data.oreVeins) {
    const amountPerMinute = (oreMinerLookup[vein.id] ?? []).reduce((sum, miner) => (
      sum + (
        miner.miner_type === "advanced"
          ? getAdvancedMinerOutputPerMinute(
              Number(miner.covered_nodes),
              Number(miner.advanced_speed_percent ?? 100),
              data.settings.miningSpeedPercent,
            )
          : getRegularMinerOutputPerMinute(Number(miner.covered_nodes), data.settings.miningSpeedPercent)
      )
    ), 0);
    addProducer(resourceLookup.get(vein.resource_id), planetLookup.get(vein.planet_id), amountPerMinute, vein.created_at);
  }

  for (const site of data.liquidSites) {
    addProducer(
      resourceLookup.get(site.resource_id),
      planetLookup.get(site.planet_id),
      getPumpOutputPerMinute(Number(site.pump_count), data.settings.miningSpeedPercent),
      site.created_at,
    );
  }

  for (const site of data.oilExtractors) {
    addProducer(
      resourceLookup.get(site.resource_id),
      planetLookup.get(site.planet_id),
      getOilOutputPerSecond(Number(site.oil_per_second), data.settings.miningSpeedPercent) * 60,
      site.created_at,
    );
  }

  for (const site of data.gasGiantSites) {
    const outputs = gasOutputLookup[site.id] ?? [];
    const boost = getOrbitalCollectorTrueBoost(
      outputs.map((output) => ({
        ratePerSecond: Number(output.rate_per_second),
        fuelValueMj: resourceLookup.get(output.resource_id)?.fuel_value_mj ?? 0,
      })),
      data.settings.miningSpeedPercent,
    );

    for (const output of outputs) {
      addProducer(
        resourceLookup.get(output.resource_id),
        planetLookup.get(site.planet_id),
        Number(output.rate_per_second) * boost * Number(site.collector_count) * 60,
        site.created_at,
      );
    }
  }

  return Array.from(producers.values());
}

function buildCraftedProducers(data: BootstrapData, importedItems: Map<string, ProjectImportedItem>, projectId: string) {
  const planetLookup = getPlanetLookup(data);
  const systemLookup = getSystemLookup(data);

  return data.productionSites
    .filter((site) => site.project_id === projectId)
    .flatMap<ProducerNode>((site) => {
      const importedItem = importedItems.get(site.item_key);
      const planet = planetLookup.get(site.planet_id);
      const solarSystem = systemLookup.get(site.solar_system_id);
      if (!importedItem || !planet || !solarSystem) {
        return [];
      }

      return [{
        id: `site:${site.id}`,
        kind: "crafted",
        key: site.item_key,
        resourceId: null,
        displayName: importedItem.display_name,
        solarSystemId: solarSystem.id,
        solarSystemName: solarSystem.name,
        planetId: planet.id,
        planetName: planet.name,
        availablePerMinute: Number(site.throughput_per_minute),
        createdAt: site.created_at,
        productionSiteId: site.id,
        extractionOutboundIlsCount: null,
      }];
    });
}

function buildConsumersFromSites(data: BootstrapData, importedItems: Map<string, ProjectImportedItem>, projectId: string) {
  const planetLookup = getPlanetLookup(data);
  const systemLookup = getSystemLookup(data);

  return data.productionSites
    .filter((site) => site.project_id === projectId)
    .flatMap<ConsumerNode>((site) => {
      const importedItem = importedItems.get(site.item_key);
      const planet = planetLookup.get(site.planet_id);
      const solarSystem = systemLookup.get(site.solar_system_id);
      if (!importedItem || !planet || !solarSystem || importedItem.imported_throughput_per_minute <= 0) {
        return [];
      }

      const scale = Number(site.throughput_per_minute) / importedItem.imported_throughput_per_minute;
      return importedItem.dependencies.map((dependency, dependencyIndex) => ({
        id: `${site.id}:${dependencyIndex}`,
        key: dependency.item_key,
        siteId: site.id,
        solarSystemId: solarSystem.id,
        planetId: planet.id,
        requiredPerMinute: dependency.imported_demand_per_minute * scale,
        displayName: dependency.display_name,
        sameSystemTransportMode: site.same_system_warp_item_keys.includes(dependency.item_key) ? "warp" : "cruise",
      }));
    });
}

function sortEdges(data: BootstrapData, producers: ProducerNode[], consumers: ConsumerNode[]) {
  return producers.flatMap((producer) => consumers.map((consumer) => ({
    producer,
    consumer,
    distanceLy: getSystemDistanceLy(
      data.solarSystems.find((system) => system.id === producer.solarSystemId),
      data.solarSystems.find((system) => system.id === consumer.solarSystemId),
    ),
  }))).sort((left, right) => {
    const leftClass = left.producer.planetId === left.consumer.planetId ? 0 : left.producer.solarSystemId === left.consumer.solarSystemId ? 1 : 2;
    const rightClass = right.producer.planetId === right.consumer.planetId ? 0 : right.producer.solarSystemId === right.consumer.solarSystemId ? 1 : 2;
    return (
      leftClass - rightClass ||
      (left.distanceLy ?? Number.POSITIVE_INFINITY) - (right.distanceLy ?? Number.POSITIVE_INFINITY) ||
      left.producer.createdAt.localeCompare(right.producer.createdAt) ||
      left.producer.id.localeCompare(right.producer.id)
    );
  });
}

function getSameSystemTransportMetrics(
  data: BootstrapData,
  throughputPerMinute: number,
  mode: SameSystemTransportMode,
) {
  if (mode === "warp") {
    const roundTripSeconds = getTransportRoundTripSeconds(
      0,
      data.settings.vesselSpeedLyPerSecond,
      data.settings.vesselDockingSeconds,
    );
    if (roundTripSeconds === null) {
      return { sourceStationsNeeded: null, targetStationsNeeded: null };
    }

    return {
      sourceStationsNeeded: getRequiredStationsForRoundTripSeconds(
        throughputPerMinute,
        data.settings.vesselCapacityItems,
        roundTripSeconds,
      ),
      targetStationsNeeded: getTargetStationsNeededForRoundTripSeconds(
        throughputPerMinute,
        data.settings.ilsStorageItems,
        roundTripSeconds,
      ),
    };
  }

  const roundTripSeconds = getTransportRoundTripSecondsMeters(
    SAME_SYSTEM_DISTANCE_AU * METERS_PER_AU,
    data.settings.vesselCruisingSpeedMetersPerSecond,
    data.settings.vesselDockingSeconds,
  );
  if (roundTripSeconds === null) {
    return { sourceStationsNeeded: null, targetStationsNeeded: null };
  }

  return {
    sourceStationsNeeded: getRequiredStationsForRoundTripSeconds(
      throughputPerMinute,
      data.settings.vesselCapacityItems,
      roundTripSeconds,
    ),
    targetStationsNeeded: getTargetStationsNeededForRoundTripSeconds(
      throughputPerMinute,
      data.settings.ilsStorageItems,
      roundTripSeconds,
    ),
  };
}

function buildAllocations(data: BootstrapData, producers: ProducerNode[], consumers: ConsumerNode[]) {
  const allocations: Allocation[] = [];
  const groupedConsumers = new Map<string, ConsumerNode[]>();
  const groupedProducers = new Map<string, ProducerNode[]>();

  for (const producer of producers) {
    groupedProducers.set(producer.key, [...(groupedProducers.get(producer.key) ?? []), { ...producer }]);
  }

  for (const consumer of consumers) {
    groupedConsumers.set(consumer.key, [...(groupedConsumers.get(consumer.key) ?? []), { ...consumer }]);
  }

  for (const [key, keyConsumers] of groupedConsumers.entries()) {
    const keyProducers = groupedProducers.get(key) ?? [];
    const remainingSupply = new Map(keyProducers.map((producer) => [producer.id, producer.availablePerMinute]));
    const remainingDemand = new Map(keyConsumers.map((consumer) => [consumer.id, consumer.requiredPerMinute]));
    const edges = sortEdges(data, keyProducers, keyConsumers);

    for (const edge of edges) {
      const available = remainingSupply.get(edge.producer.id) ?? 0;
      const needed = remainingDemand.get(edge.consumer.id) ?? 0;
      const allocation = Math.min(available, needed);
      if (allocation <= 0) {
        continue;
      }

      remainingSupply.set(edge.producer.id, available - allocation);
      remainingDemand.set(edge.consumer.id, needed - allocation);
      const isLocalPlanet = edge.producer.planetId === edge.consumer.planetId;
      const isLocalSystem = !isLocalPlanet && edge.producer.solarSystemId === edge.consumer.solarSystemId;
      const sameSystemTransportMode = isLocalSystem ? edge.consumer.sameSystemTransportMode : null;
      const remoteDistance = isLocalPlanet || isLocalSystem ? null : edge.distanceLy;
      const sameSystemMetrics =
        isLocalSystem && sameSystemTransportMode
          ? getSameSystemTransportMetrics(data, allocation, sameSystemTransportMode)
          : null;

      allocations.push({
        producerId: edge.producer.id,
        consumerId: edge.consumer.id,
        throughputPerMinute: allocation,
        distanceLy: edge.distanceLy,
        isLocalPlanet,
        isLocalSystem,
        sameSystemTransportMode,
        targetStationsNeeded:
          isLocalPlanet
            ? 0
            : isLocalSystem
              ? sameSystemMetrics?.targetStationsNeeded ?? null
              : remoteDistance === null || remoteDistance < 0
                ? null
            : getTargetStationsNeeded(
                allocation,
                data.settings.ilsStorageItems,
                remoteDistance,
                data.settings.vesselSpeedLyPerSecond,
                data.settings.vesselDockingSeconds,
              ),
        sourceStationsNeeded:
          isLocalPlanet
            ? 0
            : isLocalSystem
              ? sameSystemMetrics?.sourceStationsNeeded ?? null
              : remoteDistance === null || remoteDistance < 0
                ? null
            : getRequiredStations(
                allocation,
                data.settings.vesselCapacityItems,
                remoteDistance,
                data.settings.vesselSpeedLyPerSecond,
                data.settings.vesselDockingSeconds,
              ),
      });
    }
  }

  return allocations;
}

function groupAllocationsByConsumer(allocations: Allocation[]) {
  return allocations.reduce<Record<string, Allocation[]>>((acc, allocation) => {
    acc[allocation.consumerId] ??= [];
    acc[allocation.consumerId].push(allocation);
    return acc;
  }, {});
}

function getOutboundIlsRequiredBySiteId(allocations: Allocation[], producers: ProducerNode[]) {
  return allocations.reduce<Record<string, number>>((acc, allocation) => {
    const producer = producers.find((entry) => entry.id === allocation.producerId);
    if (!producer?.productionSiteId || allocation.isLocalPlanet) {
      return acc;
    }
    acc[producer.productionSiteId] = (acc[producer.productionSiteId] ?? 0) + (allocation.sourceStationsNeeded ?? 0);
    return acc;
  }, {});
}

function packMixedIls(dependencies: ProductionSiteDependencyView[]) {
  let fullStations = 0;
  const bins: MixedIlsBin[] = [];
  const remainders = dependencies
    .flatMap((dependency) => {
      if (dependency.targetIlsFraction === null || dependency.targetIlsFraction <= 0) {
        return [];
      }

      const full = Math.floor(dependency.targetIlsFraction);
      fullStations += full;
      const remainder = dependency.targetIlsFraction - full;
      return remainder > 0 ? [{ itemName: dependency.dependency.display_name, fraction: remainder }] : [];
    })
    .sort((left, right) => right.fraction - left.fraction);

  for (const remainder of remainders) {
    const bin = bins.find((entry) => entry.entries.length < 4 && entry.fill + remainder.fraction <= 1 + 1e-9);
    if (bin) {
      bin.entries.push({ itemName: remainder.itemName, fraction: roundUp(remainder.fraction, 2) });
      bin.fill = roundUp(bin.fill + remainder.fraction, 2);
      continue;
    }

    bins.push({
      id: `${remainder.itemName}-${bins.length}`,
      fill: roundUp(remainder.fraction, 2),
      entries: [{ itemName: remainder.itemName, fraction: roundUp(remainder.fraction, 2) }],
    });
  }

  return { fullStations, bins };
}

function getWarnedSourceProducerIds(
  data: BootstrapData,
  producers: ProducerNode[],
  allocations: Allocation[],
  outboundIlsRequiredBySiteId: Record<string, number>,
) {
  const warnedSourceProducerIds = new Set<string>();
  const rawRemoteIlsByProducerId = allocations.reduce<Record<string, number>>((acc, allocation) => {
    const producer = producers.find((entry) => entry.id === allocation.producerId);
    if (!producer || producer.kind !== "raw" || allocation.isLocalPlanet) {
      return acc;
    }

    acc[producer.id] = (acc[producer.id] ?? 0) + (allocation.sourceStationsNeeded ?? 0);
    return acc;
  }, {});

  for (const producer of producers) {
    if (producer.kind === "raw") {
      const remoteIlsNeeded = rawRemoteIlsByProducerId[producer.id] ?? 0;
      if (
        remoteIlsNeeded > 0 &&
        (producer.extractionOutboundIlsCount === null || remoteIlsNeeded - producer.extractionOutboundIlsCount > 1e-9)
      ) {
        warnedSourceProducerIds.add(producer.id);
      }
      continue;
    }

    if (!producer.productionSiteId) {
      continue;
    }

    const site = data.productionSites.find((entry) => entry.id === producer.productionSiteId);
    if (!site) {
      continue;
    }

    if ((outboundIlsRequiredBySiteId[site.id] ?? 0) - Number(site.outbound_ils_count) > 1e-9) {
      warnedSourceProducerIds.add(producer.id);
    }
  }

  return warnedSourceProducerIds;
}

function buildDependencyViews(
  importedItem: ProjectImportedItem,
  throughputPerMinute: number,
  consumerIdPrefix: string,
  allocationsByConsumer: Record<string, Allocation[]>,
  producers: ProducerNode[],
  warnedSourceProducerIds: Set<string>,
  lineDivisibleBy: number | null = null,
) {
  const scale = importedItem.imported_throughput_per_minute > 0
    ? throughputPerMinute / importedItem.imported_throughput_per_minute
    : 0;

  const dependencyViews = importedItem.dependencies.map<ProductionSiteDependencyView>((dependency, dependencyIndex) => {
    const rows = allocationsByConsumer[`${consumerIdPrefix}:${dependencyIndex}`] ?? [];
    const coveragePerMinute = rows.reduce((sum, row) => sum + row.throughputPerMinute, 0);
    const requiredPerMinute = dependency.imported_demand_per_minute * scale;
    const hasUnknownTargetIls = rows.some((row) => row.targetStationsNeeded === null);
    const sources = rows.flatMap<ProductionIngredientSource>((row) => {
      const producer = producers.find((entry) => entry.id === row.producerId);
      if (!producer) {
        return [];
      }

      return [{
        producerId: producer.id,
        producerName: producer.displayName,
        planetName: producer.planetName,
        solarSystemName: producer.solarSystemName,
        distanceLy: row.distanceLy,
        throughputPerMinute: row.throughputPerMinute,
        isLocalPlanet: row.isLocalPlanet,
        isLocalSystem: row.isLocalSystem,
        sameSystemTransportMode: row.sameSystemTransportMode,
        sourceStationsNeeded: row.sourceStationsNeeded,
        targetStationsNeeded: row.targetStationsNeeded,
        hasSourceIlsWarning: warnedSourceProducerIds.has(producer.id),
      }];
    });

    return {
      dependency,
      requiredPerMinute,
      requiredBelts: importedItem.belt_speed_per_minute ? requiredPerMinute / importedItem.belt_speed_per_minute : 0,
      beltsPerLine: 0,
      coveragePerMinute,
      coveragePercent: requiredPerMinute > 0 ? Math.min(100, coveragePerMinute / requiredPerMinute * 100) : 100,
      shortagePerMinute: Math.max(0, requiredPerMinute - coveragePerMinute),
      targetIlsFraction: hasUnknownTargetIls ? null : rows.reduce((sum, row) => sum + (row.targetStationsNeeded ?? 0), 0),
      sourcesLabel: sources.length > 0
        ? sources.map((source) => `${source.planetName} (${roundUp(source.throughputPerMinute, 2)}/min)`).join(", ")
        : "No source assigned",
      hasSourceIlsWarning: sources.some((source) => source.hasSourceIlsWarning),
      sources,
    };
  });

  const outputBelts = importedItem.output_belts * scale;
  const exactLineDemand = Math.max(outputBelts, ...dependencyViews.map((dependency) => dependency.requiredBelts), 0);
  const lineCount = getAdjustedLineCount(exactLineDemand, lineDivisibleBy);
  const assemblersPerLine = importedItem.machine_count * scale / lineCount;
  for (const dependency of dependencyViews) {
    dependency.beltsPerLine = roundUp(dependency.requiredBelts / lineCount, 2);
  }

  return {
    dependencyViews,
    outputBelts,
    lineCount,
    machineCount: getRoundedMachinePlan(importedItem.machine_count * scale, lineCount).totalMachineCount,
    assemblersPerLine,
    outputBeltsPerLine: roundUp(outputBelts / lineCount, 2),
    packedIls: packMixedIls(dependencyViews),
  };
}

function buildProjectContext(data: BootstrapData, projectId: string): ProjectContext {
  const importedItems = getProjectImportedItems(data, projectId);
  const importedItemLookup = new Map(importedItems.map((item) => [item.item_key, item]));
  const producers = [...buildRawProducers(data), ...buildCraftedProducers(data, importedItemLookup, projectId)];
  const consumers = buildConsumersFromSites(data, importedItemLookup, projectId);
  const allocations = buildAllocations(data, producers, consumers);
  const allocationsByConsumer = groupAllocationsByConsumer(allocations);
  const outboundIlsRequiredBySiteId = getOutboundIlsRequiredBySiteId(allocations, producers);
  const warnedSourceProducerIds = getWarnedSourceProducerIds(data, producers, allocations, outboundIlsRequiredBySiteId);

  return {
    importedItems,
    importedItemLookup,
    producers,
    consumers,
    allocations,
    allocationsByConsumer,
    outboundIlsRequiredBySiteId,
    warnedSourceProducerIds,
  };
}

function getRawGoalTargetPerMinute(data: BootstrapData, projectId: string, resourceId: string) {
  const goal = data.projectGoals.find((entry) => entry.project_id === projectId && entry.resource_id === resourceId);
  if (!goal) {
    return 0;
  }
  const resource = data.resources.find((entry) => entry.id === resourceId);
  if (!resource) {
    return 0;
  }
  return resource.type === "ore_vein" ? goal.quantity * 30 : goal.quantity;
}

function buildWarnings(
  data: BootstrapData,
  projectId: string,
  context: ProjectContext,
  itemSummaries: ProductionItemSummary[],
) {
  const warnings: ProductionWarning[] = [];
  const planetLookup = getPlanetLookup(data);
  const rawProducers = context.producers.filter((producer) => producer.kind === "raw");
  const rawRemoteIlsByProducerId = context.allocations.reduce<Record<string, number>>((acc, allocation) => {
    const producer = context.producers.find((entry) => entry.id === allocation.producerId);
    if (!producer || producer.kind !== "raw" || allocation.isLocalPlanet) {
      return acc;
    }
    acc[producer.id] = (acc[producer.id] ?? 0) + (allocation.sourceStationsNeeded ?? 0);
    return acc;
  }, {});
  const extractedRawResourceIdsByPlanetId = rawProducers.reduce<Record<string, Set<string>>>((acc, producer) => {
    if (!producer.resourceId) {
      return acc;
    }

    acc[producer.planetId] ??= new Set<string>();
    acc[producer.planetId].add(producer.resourceId);
    return acc;
  }, {});

  for (const producer of rawProducers) {
    const producerPlanet = planetLookup.get(producer.planetId);
    if (producerPlanet?.planet_type === "gas_giant") {
      continue;
    }

    const remoteIlsNeeded = rawRemoteIlsByProducerId[producer.id] ?? 0;

    if (producer.extractionOutboundIlsCount === null && remoteIlsNeeded > 0) {
      warnings.push({
        id: `missing-extraction-ils:${producer.id}`,
        kind: "missing-extraction-ils",
        severity: "warning",
        title: `${producer.planetName} is missing ${producer.displayName} export ILS capacity`,
        detail: "This raw resource is already serving off-planet demand, but its source ILS capacity is unset. Set a planet default or add a resource override.",
      });
    }

    if (
      producer.extractionOutboundIlsCount !== null &&
      remoteIlsNeeded - producer.extractionOutboundIlsCount > 1e-9
    ) {
      warnings.push({
        id: `overbooked-extraction-ils:${producer.id}`,
        kind: "overbooked-extraction-ils",
        severity: "danger",
        title: `${producer.planetName} is overbooked on ${producer.displayName} export ILS`,
        detail: `${roundUp(remoteIlsNeeded, 2)} source ILS are required, but only ${producer.extractionOutboundIlsCount} are configured for this resource.`,
      });
    }
  }

  for (const planet of planetLookup.values()) {
    if (planet.planet_type === "gas_giant") {
      continue;
    }

    if (planet.extraction_outbound_ils_count !== null) {
      continue;
    }

    const extractedResourceIds = Array.from(extractedRawResourceIdsByPlanetId[planet.id] ?? []);
    if (extractedResourceIds.length === 0) {
      continue;
    }

    const hasOverrideForEveryExtractedResource = extractedResourceIds.every((resourceId) =>
      planet.extraction_outbound_ils_overrides.some((override) => override.resource_id === resourceId),
    );
    if (hasOverrideForEveryExtractedResource) {
      continue;
    }

    const hasRemoteDemand = rawProducers.some(
      (producer) => producer.planetId === planet.id && (rawRemoteIlsByProducerId[producer.id] ?? 0) > 0,
    );
    if (hasRemoteDemand) {
      continue;
    }

    warnings.push({
      id: `missing-extraction-ils:default:${planet.id}`,
      kind: "missing-extraction-ils",
      severity: "warning",
      title: `${planet.name} is missing a default raw export ILS count`,
      detail: "Set a planet-wide default or add resource-specific overrides before trusting future logistics warnings.",
    });
  }

  for (const site of data.productionSites.filter((entry) => entry.project_id === projectId)) {
    const required = context.outboundIlsRequiredBySiteId[site.id] ?? 0;
    if (required - Number(site.outbound_ils_count) > 1e-9) {
      const importedItem = context.importedItemLookup.get(site.item_key);
      const planet = planetLookup.get(site.planet_id);
      warnings.push({
        id: `overbooked-outbound-ils:${site.id}`,
        kind: "overbooked-outbound-ils",
        severity: "danger",
        title: `${importedItem?.display_name ?? site.item_key} is overbooked on outbound ILS`,
        detail: `${planet?.name ?? "Unknown planet"} needs ${roundUp(required, 2)} outbound ILS for its exports, but only ${site.outbound_ils_count} are configured.`,
      });
    }
  }

  for (const site of data.productionSites.filter((entry) => entry.project_id === projectId && Number(entry.is_finished) !== 1)) {
    const suppliedAllocations = context.allocations.filter((allocation) => {
      const producer = context.producers.find((entry) => entry.id === allocation.producerId);
      return producer?.productionSiteId === site.id && allocation.throughputPerMinute > 0;
    });
    if (suppliedAllocations.length === 0) {
      continue;
    }

    const importedItem = context.importedItemLookup.get(site.item_key);
    const consumerNames = new Set(
      suppliedAllocations.flatMap((allocation) => {
        const consumer = context.consumers.find((entry) => entry.id === allocation.consumerId);
        const consumerSite = consumer ? data.productionSites.find((entry) => entry.id === consumer.siteId) : null;
        const consumerItem = consumerSite ? context.importedItemLookup.get(consumerSite.item_key) : null;
        return consumerItem ? [consumerItem.display_name] : [];
      }),
    );
    const requiredBy = Array.from(consumerNames).slice(0, 3).join(", ");

    warnings.push({
      id: `unfinished-required-site:${site.id}`,
      kind: "unfinished-required-site",
      severity: "warning",
      title: `${importedItem?.display_name ?? site.item_key} is planned but required`,
      detail: requiredBy
        ? `This production site is not marked finished, but its output is being counted for ${requiredBy}.`
        : "This production site is not marked finished, but its output is being counted by another placed production site.",
    });
  }

  for (const item of itemSummaries.filter((entry) => entry.hasShortage)) {
    warnings.push({
      id: `shortage:${item.itemKey}`,
      kind: "shortage",
      severity: "warning",
      title: `${item.displayName} has uncovered inputs`,
      detail: `Input coverage is ${roundUp(item.coveragePercent, 1)}% for the currently placed production sites.`,
    });
  }

  return warnings;
}

export function buildProductionDraftPreview(
  data: BootstrapData,
  projectId: string | null,
  itemKey: string,
  throughputPerMinute: number,
  solarSystemId: string,
  planetId: string,
  lineDivisibleBy: number | null = null,
  sameSystemWarpByItemKey: Record<string, boolean> = {},
): ProductionDraftPreview | null {
  if (!projectId || !itemKey || throughputPerMinute <= 0 || !solarSystemId || !planetId) {
    return null;
  }

  const context = buildProjectContext(data, projectId);
  const importedItem = context.importedItemLookup.get(itemKey);
  const planet = data.planets.find((entry) => entry.id === planetId);
  const solarSystem = data.solarSystems.find((entry) => entry.id === solarSystemId);
  if (!importedItem || !planet || !solarSystem) {
    return null;
  }

  const consumerPrefix = `draft:${itemKey}:${planetId}:${solarSystemId}`;
  const syntheticConsumers = importedItem.dependencies.map<ConsumerNode>((dependency, dependencyIndex) => ({
    id: `${consumerPrefix}:${dependencyIndex}`,
    key: dependency.item_key,
    siteId: consumerPrefix,
    solarSystemId,
    planetId,
    requiredPerMinute:
      importedItem.imported_throughput_per_minute > 0
        ? dependency.imported_demand_per_minute * (throughputPerMinute / importedItem.imported_throughput_per_minute)
        : 0,
    displayName: dependency.display_name,
    sameSystemTransportMode: sameSystemWarpByItemKey[dependency.item_key] ? "warp" : "cruise",
  }));
  const allocationLookup = groupAllocationsByConsumer(buildAllocations(data, context.producers, syntheticConsumers));
  const metrics = buildDependencyViews(
    importedItem,
    throughputPerMinute,
    consumerPrefix,
    allocationLookup,
    context.producers,
    context.warnedSourceProducerIds,
    lineDivisibleBy,
  );

  return {
    itemKey,
    displayName: importedItem.display_name,
    throughputPerMinute,
    machineCount: metrics.machineCount,
    machineLabel: importedItem.machine_label,
    lineCount: metrics.lineCount,
    assemblersPerLine: metrics.assemblersPerLine,
    outputBelts: metrics.outputBelts,
    outputBeltsPerLine: metrics.outputBeltsPerLine,
    recipe: importedItem.recipe ?? "",
    outputs: importedItem.outputs ?? "",
    dependencies: metrics.dependencyViews,
    mixedIlsFullStationCount: metrics.packedIls.fullStations,
    mixedIlsBins: metrics.packedIls.bins,
    solarSystemName: solarSystem.name,
    planetName: planet.name,
  };
}

export function buildProductionPlanner(data: BootstrapData, projectId: string | null): ProductionPlannerResult {
  if (!projectId) {
    return {
      itemChoices: [],
      itemSummaries: [],
      siteViews: [],
      warnings: [],
      overview: {
        importedCraftedCount: 0,
        importedRawCount: 0,
        placedSiteCount: 0,
        activeSiteCount: 0,
        plannedCraftedThroughput: 0,
        activeCraftedThroughput: 0,
        plannedLineCount: 0,
        coveredRawGoals: 0,
        totalRawGoals: 0,
        rawCoveragePercent: 0,
        warningCount: 0,
      },
    };
  }

  const context = buildProjectContext(data, projectId);
  const planetLookup = getPlanetLookup(data);
  const systemLookup = getSystemLookup(data);

  const siteViews = data.productionSites
    .filter((site) => site.project_id === projectId)
    .flatMap<ProductionSiteView>((site) => {
      const importedItem = context.importedItemLookup.get(site.item_key);
      const planet = planetLookup.get(site.planet_id);
      const solarSystem = systemLookup.get(site.solar_system_id);
      if (!importedItem || !planet || !solarSystem || importedItem.imported_throughput_per_minute <= 0) {
        return [];
      }

      const metrics = buildDependencyViews(
        importedItem,
        Number(site.throughput_per_minute),
        site.id,
        context.allocationsByConsumer,
        context.producers,
        context.warnedSourceProducerIds,
        site.line_divisible_by,
      );

      return [{
        site,
        importedItem,
        solarSystemName: solarSystem.name,
        planetName: planet.name,
        machineCount: metrics.machineCount,
        lineCount: metrics.lineCount,
        assemblersPerLine: metrics.assemblersPerLine,
        outputBeltsPerLine: metrics.outputBeltsPerLine,
        outboundIlsRequired: context.outboundIlsRequiredBySiteId[site.id] ?? 0,
        dependencies: metrics.dependencyViews,
        mixedIlsFullStationCount: metrics.packedIls.fullStations,
        mixedIlsBins: metrics.packedIls.bins,
      }];
    })
    .sort((left, right) => right.site.created_at.localeCompare(left.site.created_at));

  const itemSummaries = context.importedItems.map<ProductionItemSummary>((item) => {
    const relatedSites = siteViews.filter((siteView) => siteView.site.item_key === item.item_key);
    const dependencies = relatedSites.flatMap((siteView) => siteView.dependencies);
    const metrics = buildDependencyViews(
      item,
      Number(item.imported_throughput_per_minute),
      "__summary__",
      {},
      context.producers,
      context.warnedSourceProducerIds,
    );
    const totalRequired = dependencies.reduce((sum, dependency) => sum + dependency.requiredPerMinute, 0);
    const totalCovered = dependencies.reduce((sum, dependency) => sum + dependency.coveragePerMinute, 0);
    return {
      itemKey: item.item_key,
      displayName: item.display_name,
      totalPlannedThroughput: Number(item.imported_throughput_per_minute),
      activeSiteCount: relatedSites.filter((siteView) => Number(siteView.site.is_finished) === 1).length,
      siteCount: relatedSites.length,
      coveragePercent: totalRequired > 0 ? Math.min(100, totalCovered / totalRequired * 100) : 100,
      hasShortage: dependencies.some((dependency) => dependency.shortagePerMinute > 1e-9),
      plannedLineCount: metrics.lineCount,
      plannedMachineCount: metrics.machineCount,
    };
  });

  const craftedSummaries = itemSummaries.filter((item) => context.importedItemLookup.get(item.itemKey)?.category === "crafted");
  const warnings = buildWarnings(data, projectId, context, craftedSummaries);
  const rawGoals = data.projectGoals.filter((goal) => goal.project_id === projectId && Number(goal.quantity) > 0);
  const coveredRawGoals = rawGoals.filter((goal) => {
    const summary = data.summary.resourceSummaries.find((entry) => entry.resourceId === goal.resource_id);
    return summary ? summary.supplyPerMinute >= getRawGoalTargetPerMinute(data, projectId, goal.resource_id) : false;
  }).length;

  return {
    itemChoices: context.importedItems.filter((item) => item.category === "crafted"),
    itemSummaries: craftedSummaries,
    siteViews,
    warnings,
    overview: {
      importedCraftedCount: context.importedItems.filter((item) => item.category === "crafted").length,
      importedRawCount: context.importedItems.filter((item) => item.category === "raw").length,
      placedSiteCount: data.productionSites.filter((site) => site.project_id === projectId).length,
      activeSiteCount: data.productionSites.filter((site) => site.project_id === projectId && Number(site.is_finished) === 1).length,
      plannedCraftedThroughput: craftedSummaries.reduce((sum, item) => sum + item.totalPlannedThroughput, 0),
      activeCraftedThroughput: data.productionSites
        .filter((site) => site.project_id === projectId && Number(site.is_finished) === 1)
        .reduce((sum, site) => sum + Number(site.throughput_per_minute), 0),
      plannedLineCount: craftedSummaries.reduce((sum, item) => sum + item.plannedLineCount, 0),
      coveredRawGoals,
      totalRawGoals: rawGoals.length,
      rawCoveragePercent: rawGoals.length > 0 ? (coveredRawGoals / rawGoals.length) * 100 : 100,
      warningCount: warnings.length,
    },
  };
}
