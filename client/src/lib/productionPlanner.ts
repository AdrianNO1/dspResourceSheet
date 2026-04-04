import {
  getAdvancedMinerOutputPerMinute,
  getOilOutputPerSecond,
  getOrbitalCollectorTrueBoost,
  getPumpOutputPerMinute,
  getRegularMinerOutputPerMinute,
  getRequiredStations,
  getTargetStationsNeeded,
} from "./dspMath";
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

type ProducerNode = {
  id: string;
  key: string;
  displayName: string;
  solarSystemId: string;
  solarSystemName: string;
  planetId: string;
  planetName: string;
  availablePerMinute: number;
  createdAt: string;
  productionSiteId: string | null;
};

type ConsumerNode = {
  id: string;
  key: string;
  siteId: string;
  solarSystemId: string;
  planetId: string;
  requiredPerMinute: number;
  displayName: string;
};

type Allocation = {
  producerId: string;
  consumerId: string;
  throughputPerMinute: number;
  targetStationsNeeded: number | null;
  sourceStationsNeeded: number | null;
  isLocalPlanet: boolean;
  isLocalSystem: boolean;
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
  hasOutboundIlsWarning: boolean;
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
  finishedThroughput: number;
  siteCount: number;
  coveragePercent: number;
  hasShortage: boolean;
};

export type ProductionPlannerResult = {
  itemChoices: ProjectImportedItem[];
  itemSummaries: ProductionItemSummary[];
  siteViews: ProductionSiteView[];
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
      key: normalizeKey(resource.name),
      displayName: resource.name,
      solarSystemId: solarSystem.id,
      solarSystemName: solarSystem.name,
      planetId: planet.id,
      planetName: planet.name,
      availablePerMinute: amountPerMinute,
      createdAt,
      productionSiteId: null,
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
      getOilOutputPerSecond(Number(site.oil_per_second)) * 60,
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
    .filter((site) => site.project_id === projectId && Number(site.is_finished) === 1)
    .flatMap<ProducerNode>((site) => {
      const importedItem = importedItems.get(site.item_key);
      const planet = planetLookup.get(site.planet_id);
      const solarSystem = systemLookup.get(site.solar_system_id);
      if (!importedItem || !planet || !solarSystem) {
        return [];
      }

      return [{
        id: `site:${site.id}`,
        key: site.item_key,
        displayName: importedItem.display_name,
        solarSystemId: solarSystem.id,
        solarSystemName: solarSystem.name,
        planetId: planet.id,
        planetName: planet.name,
        availablePerMinute: Number(site.throughput_per_minute),
        createdAt: site.created_at,
        productionSiteId: site.id,
      }];
    });
}

function buildConsumers(data: BootstrapData, importedItems: Map<string, ProjectImportedItem>, projectId: string) {
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
      }));
    });
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
    const edges = keyProducers.flatMap((producer) => keyConsumers.map((consumer) => ({
      producer,
      consumer,
      distanceLy: getSystemDistanceLy(
        data.solarSystems.find((system) => system.id === producer.solarSystemId),
        data.solarSystems.find((system) => system.id === consumer.solarSystemId),
        data.systemDistances,
      ),
    })));

    edges.sort((left, right) => {
      const leftClass = left.producer.planetId === left.consumer.planetId ? 0 : left.producer.solarSystemId === left.consumer.solarSystemId ? 1 : 2;
      const rightClass = right.producer.planetId === right.consumer.planetId ? 0 : right.producer.solarSystemId === right.consumer.solarSystemId ? 1 : 2;
      return (
        leftClass - rightClass ||
        (left.distanceLy ?? Number.POSITIVE_INFINITY) - (right.distanceLy ?? Number.POSITIVE_INFINITY) ||
        left.producer.createdAt.localeCompare(right.producer.createdAt) ||
        left.producer.id.localeCompare(right.producer.id)
      );
    });

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
      const remoteDistance = isLocalPlanet || isLocalSystem ? 0 : edge.distanceLy;

      allocations.push({
        producerId: edge.producer.id,
        consumerId: edge.consumer.id,
        throughputPerMinute: allocation,
        isLocalPlanet,
        isLocalSystem,
        targetStationsNeeded:
          remoteDistance === null || remoteDistance <= 0
            ? remoteDistance === 0 ? 0 : null
            : getTargetStationsNeeded(
                allocation,
                data.settings.ilsStorageItems,
                remoteDistance,
                data.settings.vesselSpeedLyPerSecond,
                data.settings.vesselDockingSeconds,
              ),
        sourceStationsNeeded:
          remoteDistance === null || remoteDistance <= 0
            ? remoteDistance === 0 ? 0 : null
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

export function buildProductionPlanner(data: BootstrapData, projectId: string | null): ProductionPlannerResult {
  if (!projectId) {
    return { itemChoices: [], itemSummaries: [], siteViews: [] };
  }

  const importedItems = data.projectImportedItems
    .filter((item) => item.project_id === projectId)
    .sort((left, right) => left.display_name.localeCompare(right.display_name));
  const importedItemLookup = new Map(importedItems.map((item) => [item.item_key, item]));
  const producers = [...buildRawProducers(data), ...buildCraftedProducers(data, importedItemLookup, projectId)];
  const consumers = buildConsumers(data, importedItemLookup, projectId);
  const allocations = buildAllocations(data, producers, consumers);
  const allocationsByConsumer = allocations.reduce<Record<string, Allocation[]>>((acc, allocation) => {
    acc[allocation.consumerId] ??= [];
    acc[allocation.consumerId].push(allocation);
    return acc;
  }, {});
  const outboundIlsRequired = allocations.reduce<Record<string, number>>((acc, allocation) => {
    const producer = producers.find((entry) => entry.id === allocation.producerId);
    if (!producer?.productionSiteId || allocation.isLocalPlanet || allocation.isLocalSystem) {
      return acc;
    }
    acc[producer.productionSiteId] = (acc[producer.productionSiteId] ?? 0) + (allocation.sourceStationsNeeded ?? 0);
    return acc;
  }, {});
  const warnedProducerIds = new Set(
    data.productionSites
      .filter((site) => (outboundIlsRequired[site.id] ?? 0) - Number(site.outbound_ils_count) > 1e-9)
      .map((site) => site.id),
  );
  const planetLookup = getPlanetLookup(data);
  const systemLookup = getSystemLookup(data);

  const siteViews = data.productionSites
    .filter((site) => site.project_id === projectId)
    .flatMap<ProductionSiteView>((site) => {
      const importedItem = importedItemLookup.get(site.item_key);
      const planet = planetLookup.get(site.planet_id);
      const solarSystem = systemLookup.get(site.solar_system_id);
      if (!importedItem || !planet || !solarSystem || importedItem.imported_throughput_per_minute <= 0) {
        return [];
      }

      const scale = Number(site.throughput_per_minute) / importedItem.imported_throughput_per_minute;
      const dependencyViews = importedItem.dependencies.map<ProductionSiteDependencyView>((dependency, dependencyIndex) => {
        const rows = allocationsByConsumer[`${site.id}:${dependencyIndex}`] ?? [];
        const coveragePerMinute = rows.reduce((sum, row) => sum + row.throughputPerMinute, 0);
        const requiredPerMinute = dependency.imported_demand_per_minute * scale;
        return {
          dependency,
          requiredPerMinute,
          requiredBelts: importedItem.belt_speed_per_minute ? requiredPerMinute / importedItem.belt_speed_per_minute : 0,
          beltsPerLine: 0,
          coveragePerMinute,
          coveragePercent: requiredPerMinute > 0 ? Math.min(100, coveragePerMinute / requiredPerMinute * 100) : 100,
          shortagePerMinute: Math.max(0, requiredPerMinute - coveragePerMinute),
          targetIlsFraction: rows.reduce((sum, row) => sum + (row.targetStationsNeeded ?? 0), 0),
          sourcesLabel: rows.map((row) => {
            const producer = producers.find((entry) => entry.id === row.producerId);
            return producer ? `${producer.planetName} (${roundUp(row.throughputPerMinute, 2)}/min)` : null;
          }).filter((value): value is string => value !== null).join(", ") || "No source assigned",
          hasOutboundIlsWarning: rows.some((row) => {
            const producer = producers.find((entry) => entry.id === row.producerId);
            return producer?.productionSiteId ? warnedProducerIds.has(producer.productionSiteId) : false;
          }),
        };
      });

      const outputBelts = importedItem.output_belts * scale;
      const lineCount = Math.max(1, Math.ceil(Math.max(outputBelts, ...dependencyViews.map((dependency) => dependency.requiredBelts))));
      for (const dependency of dependencyViews) {
        dependency.beltsPerLine = roundUp(dependency.requiredBelts / lineCount, 2);
      }
      const packedIls = packMixedIls(dependencyViews);

      return [{
        site,
        importedItem,
        solarSystemName: solarSystem.name,
        planetName: planet.name,
        machineCount: importedItem.machine_count * scale,
        lineCount,
        assemblersPerLine: importedItem.machine_count * scale / lineCount,
        outputBeltsPerLine: roundUp(outputBelts / lineCount, 2),
        outboundIlsRequired: outboundIlsRequired[site.id] ?? 0,
        dependencies: dependencyViews,
        mixedIlsFullStationCount: packedIls.fullStations,
        mixedIlsBins: packedIls.bins,
      }];
    })
    .sort((left, right) => right.site.created_at.localeCompare(left.site.created_at));

  const itemSummaries = importedItems.map<ProductionItemSummary>((item) => {
    const relatedSites = siteViews.filter((siteView) => siteView.site.item_key === item.item_key);
    const dependencies = relatedSites.flatMap((siteView) => siteView.dependencies);
    const totalRequired = dependencies.reduce((sum, dependency) => sum + dependency.requiredPerMinute, 0);
    const totalCovered = dependencies.reduce((sum, dependency) => sum + dependency.coveragePerMinute, 0);
    return {
      itemKey: item.item_key,
      displayName: item.display_name,
      totalPlannedThroughput: relatedSites.reduce((sum, siteView) => sum + Number(siteView.site.throughput_per_minute), 0),
      finishedThroughput: relatedSites
        .filter((siteView) => Number(siteView.site.is_finished) === 1)
        .reduce((sum, siteView) => sum + Number(siteView.site.throughput_per_minute), 0),
      siteCount: relatedSites.length,
      coveragePercent: totalRequired > 0 ? Math.min(100, totalCovered / totalRequired * 100) : 100,
      hasShortage: dependencies.some((dependency) => dependency.shortagePerMinute > 1e-9),
    };
  });

  return {
    itemChoices: importedItems.filter((item) => item.category === "crafted"),
    itemSummaries: itemSummaries.filter((item) => importedItemLookup.get(item.itemKey)?.category === "crafted"),
    siteViews,
  };
}
