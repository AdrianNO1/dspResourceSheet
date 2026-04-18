import { getPlanetExtractionOutboundIlsCount } from "../domain/planetLogistics";
import {
  getFactorioLabReference,
  inferImportedItemProliferatorUsage,
} from "../lib/factoriolabCatalog";
import { getSystemDistanceLy as getGeneratedSystemDistanceLy } from "../lib/dspCluster";
import {
  buildProductionPlanner,
  type ProductionItemSummary,
} from "../lib/productionPlanner";
import {
  getAdvancedMinerOutputPerMinute,
  getAdvancedMinerPowerMw,
  getMultiSourceTransportPlan,
  getOilOutputPerSecond,
  getOrbitalCollectorTrueBoost,
  getPumpOutputPerMinute,
  getRegularMinerOutputPerMinute,
  OIL_EXTRACTOR_POWER_MW,
  PUMP_POWER_MW,
  REGULAR_MINER_POWER_MW,
} from "../lib/dspMath";
import type {
  BootstrapData,
  GasGiantOutput,
  GasGiantSite,
  LiquidSite,
  OilExtractor,
  OreVeinMiner,
  OreVein,
  Planet,
  Project,
  ProjectGoal,
  ProjectImportedItem,
  ResourceDefinition,
  ResourceSummary,
  ResourceType,
  SolarSystem,
} from "../lib/types";
import type { MapSelection } from "./appTypes";

export type ExtractionRollupRow = {
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

export type PlanetExtractionIlsResourceRow = {
  resourceId: string;
  name: string;
  iconUrl: string | null;
  colorStart: string;
  colorEnd: string;
};

export type ExtractionActivityRow = {
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

type ResourceOriginEntry = {
  planetId: string;
  systemId: string;
  supplyMetric: number;
  supplyPerMinute: number;
  supplyPerSecond: number;
  placementId: string;
};

export type ResourceOriginBreakdownRow = {
  id: string;
  name: string;
  context: string;
  supplyMetric: number;
  supplyPerMinute: number;
  supplyPerSecond: number;
  placementCount: number;
  percentOfTotal: number;
};

export type ResourceOriginTransportSource = {
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

export type OverviewTransportSystemRow = {
  systemId: string;
  systemName: string;
  planetCount: number;
  supplyPerMinute: number;
  distanceLy: number | null;
};

export type ProductionTreeInput = {
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

type ProductionTreeNode = {
  itemKey: string;
  summary: ProductionItemSummary;
  inputs: ProductionTreeInput[];
  usages: ProductionTreeUsage[];
};

type OreMinerLookup = Record<string, OreVeinMiner[]>;
type GasOutputLookup = Record<string, GasGiantOutput[]>;

type ExtractionView = {
  resourceRows: ExtractionRollupRow[];
  activityRows: ExtractionActivityRow[];
};

type LookupCollections = {
  currentPlanet: Planet | null;
  planetsInSystem: Planet[];
  selectedProject: Project | null;
  oreResources: ResourceDefinition[];
  liquidResources: ResourceDefinition[];
  oilResources: ResourceDefinition[];
  gasResources: ResourceDefinition[];
  gasOutputLookup: GasOutputLookup;
  oreMinerLookup: OreMinerLookup;
  resourceLookup: Map<string, ResourceDefinition>;
  resourceByNameLookup: Map<string, ResourceDefinition>;
  planetLookup: Map<string, Planet>;
  systemLookup: Map<string, SolarSystem>;
  latestPlanetActivity: Map<string, number>;
  extractionSiteCountByPlanetId: Map<string, number>;
  currentPlanetExtraction: ExtractionView;
};

export type WorkspaceLookups = LookupCollections;

export type OverviewViewModel = {
  overviewResourceSummaries: ResourceSummary[];
  selectedOverviewSummary: ResourceSummary | null;
  overviewTransportDefaultThroughputPerMinute: number;
  overviewTransportUsesDefault: boolean;
  selectedOverviewBreakdown: {
    systems: ResourceOriginBreakdownRow[];
    planets: ResourceOriginBreakdownRow[];
  } | null;
  selectedOverviewTransportSources: ResourceOriginTransportSource[];
  overviewTransportSystemRows: OverviewTransportSystemRow[];
  overviewTransportPlan: ReturnType<typeof getMultiSourceTransportPlan>;
  overviewTransportRows: Array<
    ResourceOriginTransportSource & {
      assignedPerMinute: number;
      utilizationPercent: number;
      distanceLy: number | null;
      roundTripSeconds: number | null;
      sourceStationsNeeded: number | null;
      targetStationsNeeded: number | null;
      isComplete: boolean;
    }
  >;
  overviewTransportTotalSupplyPerMinute: number;
  overviewTransportCoveragePercent: number;
  overviewTransportIncompleteSystemCount: number;
  combinedTargetPerMinute: number;
  combinedCappedSupplyPerMinute: number;
  combinedProgressPercent: number;
};

export type MapViewModel = {
  mapSystemCards: Array<{
    solarSystem: SolarSystem;
    planets: Planet[];
    extractionSiteCount: number;
    activePlanetCount: number;
  }>;
  selectedMapSystem: SolarSystem | null;
  selectedMapPlanet: Planet | null;
  selectedMapParentSystem: SolarSystem | null;
  selectedMapPlanetIds: string[];
  selectedMapExtraction: ExtractionView;
  selectedMapExtractionSiteCount: number;
  selectedMapPowerDemandMw: number;
};

export type ProductionTree = {
  rootKeys: string[];
  nodesByKey: Map<string, ProductionTreeNode>;
  uniqueParentByChild: Map<string, string>;
};

export type ProductionViewModel = {
  productionPlanner: ReturnType<typeof buildProductionPlanner>;
  productionItemChoices: ProjectImportedItem[];
  productionItemSummaries: ProductionItemSummary[];
  productionWarnings: ReturnType<typeof buildProductionPlanner>["warnings"];
  productionOverview: ReturnType<typeof buildProductionPlanner>["overview"];
  selectedProductionSummary: ProductionItemSummary | null;
  craftedProjectImportedItems: ProjectImportedItem[];
  productionTree: ProductionTree;
  productionTemplateByKey: Map<string, ProjectImportedItem>;
  selectedProductionTemplate: ProjectImportedItem | null;
  selectedProductionReference: ReturnType<typeof getFactorioLabReference>;
  selectedProductionProliferatorUsage: ReturnType<typeof inferImportedItemProliferatorUsage>;
  selectedProductionSiteViews: ReturnType<typeof buildProductionPlanner>["siteViews"];
};

export type ProjectGoalRow = {
  id: string;
  resourceName: string;
  targetPerMinute: number;
  supplyPerMinute: number;
  coveragePercent: number;
};

export type ProjectsViewModel = {
  selectedProjectGoalRows: ProjectGoalRow[];
};

export type LedgerItem =
  | { kind: "ore"; createdAt: string; data: OreVein }
  | { kind: "liquid"; createdAt: string; data: LiquidSite }
  | { kind: "oil"; createdAt: string; data: OilExtractor }
  | { kind: "gas"; createdAt: string; data: GasGiantSite };

export type LedgerGroup = {
  planet: Planet;
  systemName: string;
  latestActivityAt: string;
  powerDemandMw: number;
  items: LedgerItem[];
};

export type LedgerViewModel = {
  ledgerGroups: LedgerGroup[];
};

export function getPlanetExtractionIlsResourceRows(
  planet: Planet,
  extractionRows: ExtractionRollupRow[],
  resourceLookup: Map<string, ResourceDefinition>,
) {
  const rows = new Map<string, PlanetExtractionIlsResourceRow>();

  extractionRows.forEach((row) => {
    rows.set(row.resourceId, {
      resourceId: row.resourceId,
      name: row.name,
      iconUrl: row.iconUrl,
      colorStart: row.colorStart,
      colorEnd: row.colorEnd,
    });
  });

  planet.extraction_outbound_ils_overrides.forEach((override) => {
    if (rows.has(override.resource_id)) {
      return;
    }

    const resource = resourceLookup.get(override.resource_id);
    if (!resource) {
      return;
    }

    rows.set(override.resource_id, {
      resourceId: resource.id,
      name: resource.name,
      iconUrl: resource.icon_url,
      colorStart: resource.color_start,
      colorEnd: resource.color_end,
    });
  });

  return Array.from(rows.values()).sort((left, right) => left.name.localeCompare(right.name));
}

export function isPlanetMissingExtractionIlsCoverage(data: BootstrapData, planet: Planet) {
  if (planet.planet_type === "gas_giant" || planet.extraction_outbound_ils_count !== null) {
    return false;
  }

  const extractedResourceIds = new Set<string>();
  data.oreVeins
    .filter((vein) => vein.planet_id === planet.id)
    .forEach((vein) => extractedResourceIds.add(vein.resource_id));
  data.liquidSites
    .filter((site) => site.planet_id === planet.id)
    .forEach((site) => extractedResourceIds.add(site.resource_id));
  data.oilExtractors
    .filter((site) => site.planet_id === planet.id)
    .forEach((site) => extractedResourceIds.add(site.resource_id));

  if (extractedResourceIds.size === 0) {
    return false;
  }

  return Array.from(extractedResourceIds).some(
    (resourceId) => !planet.extraction_outbound_ils_overrides.some((override) => override.resource_id === resourceId),
  );
}

export function getProjectGoalDraftQuantity(resourceType: ResourceType | undefined, storedQuantity: number) {
  return resourceType === "ore_vein" ? storedQuantity * 30 : storedQuantity;
}

export function getStoredProjectGoalQuantity(resourceType: ResourceType | undefined, draftQuantity: number) {
  return resourceType === "ore_vein" ? draftQuantity / 30 : draftQuantity;
}

export function getSummaryTargetPerMinute(summary: ResourceSummary) {
  if (summary.goalQuantity <= 0) {
    return 0;
  }

  return getProjectGoalDraftQuantity(summary.type, summary.goalQuantity);
}

export function toProjectGoalMap(projectGoals: ProjectGoal[], projectId: string, resources: ResourceDefinition[]) {
  const resourceTypeLookup = new Map(resources.map((resource) => [resource.id, resource.type]));
  return projectGoals.reduce<Record<string, number>>((acc, goal) => {
    if (goal.project_id === projectId) {
      acc[goal.resource_id] = getProjectGoalDraftQuantity(resourceTypeLookup.get(goal.resource_id), Number(goal.quantity));
    }
    return acc;
  }, {});
}

export function sortResources(resources: ResourceDefinition[], type: ResourceType) {
  return resources
    .filter((resource) => resource.type === type)
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name));
}

export function getDefaultGasOutputs(resources: ResourceDefinition[]) {
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

export function getOreVeinOutputPerMinute(miners: OreVeinMiner[], miningSpeedPercent: number) {
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

export function getOreVeinCoveredNodes(miners: OreVeinMiner[]) {
  return miners.reduce((sum, miner) => sum + Number(miner.covered_nodes), 0);
}

export function getDraftOreOutputPerMinute(
  miners: Array<{ minerType: "regular" | "advanced"; coveredNodes: number; advancedSpeedPercent: number }>,
  miningSpeedPercent: number,
) {
  return miners.reduce((sum, miner) => {
    if (miner.minerType === "advanced") {
      return sum + getAdvancedMinerOutputPerMinute(miner.coveredNodes, miner.advancedSpeedPercent, miningSpeedPercent);
    }

    return sum + getRegularMinerOutputPerMinute(miner.coveredNodes, miningSpeedPercent);
  }, 0);
}

export function getRequiredAdvancedMinerNodes(throughputPerMinute: number, miningSpeedPercent: number) {
  const perNodeOutputPerMinute = getAdvancedMinerOutputPerMinute(1, 100, miningSpeedPercent);
  if (throughputPerMinute <= 0 || perNodeOutputPerMinute <= 0) {
    return 0;
  }

  return throughputPerMinute / perNodeOutputPerMinute;
}

export function getRequiredPumpCount(throughputPerMinute: number, miningSpeedPercent: number) {
  const perPumpOutputPerMinute = getPumpOutputPerMinute(1, miningSpeedPercent);
  if (throughputPerMinute <= 0 || perPumpOutputPerMinute <= 0) {
    return 0;
  }

  return throughputPerMinute / perPumpOutputPerMinute;
}

export function buildWorkspaceLookups(data: BootstrapData, selectedProjectId: string | null): WorkspaceLookups {
  const currentPlanet = getCurrentPlanet(data);
  const planetsInSystem = getCurrentSystemPlanets(data);
  const selectedProject = data.projects.find((project) => project.id === selectedProjectId) ?? null;
  const oreResources = sortResources(data.resources, "ore_vein");
  const liquidResources = sortResources(data.resources, "liquid_pump");
  const oilResources = sortResources(data.resources, "oil_extractor");
  const gasResources = sortResources(data.resources, "gas_giant_output");

  const gasOutputLookup = data.gasGiantOutputs.reduce<GasOutputLookup>((acc, output) => {
    acc[output.gas_giant_site_id] ??= [];
    acc[output.gas_giant_site_id].push(output);
    return acc;
  }, {});

  const oreMinerLookup = data.oreVeinMiners.reduce<OreMinerLookup>((acc, miner) => {
    acc[miner.ore_vein_id] ??= [];
    acc[miner.ore_vein_id].push(miner);
    return acc;
  }, {});

  const resourceLookup = new Map(data.resources.map((resource) => [resource.id, resource]));
  const resourceByNameLookup = new Map(data.resources.map((resource) => [resource.name.toLowerCase(), resource]));
  const planetLookup = new Map(data.planets.map((planet) => [planet.id, planet]));
  const systemLookup = new Map(data.solarSystems.map((solarSystem) => [solarSystem.id, solarSystem]));
  const latestPlanetActivity = getLatestPlanetActivity(data);
  const extractionSiteCountByPlanetId = new Map<string, number>();

  const markExtractionSite = (planetId: string) => {
    extractionSiteCountByPlanetId.set(planetId, (extractionSiteCountByPlanetId.get(planetId) ?? 0) + 1);
  };

  data.oreVeins.forEach((vein) => markExtractionSite(vein.planet_id));
  data.liquidSites.forEach((site) => markExtractionSite(site.planet_id));
  data.oilExtractors.forEach((site) => markExtractionSite(site.planet_id));
  data.gasGiantSites.forEach((site) => markExtractionSite(site.planet_id));

  const currentPlanetExtraction = currentPlanet
    ? getExtractionView(
        data,
        [currentPlanet.id],
        oreMinerLookup,
        gasOutputLookup,
        resourceLookup,
        planetLookup,
        systemLookup,
      )
    : { resourceRows: [], activityRows: [] };

  return {
    currentPlanet,
    planetsInSystem,
    selectedProject,
    oreResources,
    liquidResources,
    oilResources,
    gasResources,
    gasOutputLookup,
    oreMinerLookup,
    resourceLookup,
    resourceByNameLookup,
    planetLookup,
    systemLookup,
    latestPlanetActivity,
    extractionSiteCountByPlanetId,
    currentPlanetExtraction,
  };
}

export function buildOverviewView(
  data: BootstrapData,
  lookups: WorkspaceLookups,
  selectedOverviewResourceId: string,
  overviewTransportTargetSystemId: string,
  overviewTransportThroughputPerMinute: number,
): OverviewViewModel {
  const overviewResourceSummaries = data.summary.resourceSummaries.filter(
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
        data,
        selectedOverviewSummary,
        lookups.oreMinerLookup,
        lookups.gasOutputLookup,
        lookups.resourceLookup,
        lookups.planetLookup,
        lookups.systemLookup,
      )
    : null;
  const selectedOverviewTransportSources = selectedOverviewSummary
    ? getResourceOriginTransportSources(
        data,
        selectedOverviewSummary,
        lookups.oreMinerLookup,
        lookups.gasOutputLookup,
        lookups.resourceLookup,
        lookups.planetLookup,
        lookups.systemLookup,
      )
    : [];
  const overviewTransportTargetSystem = lookups.systemLookup.get(overviewTransportTargetSystemId) ?? null;
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
        distanceLy: null,
      });
      return acc;
    }, new Map()).values(),
  )
    .map((row) => ({
      ...row,
      distanceLy:
        row.systemId === overviewTransportTargetSystemId
          ? 0
          : getGeneratedSystemDistanceLy(lookups.systemLookup.get(row.systemId), overviewTransportTargetSystem),
    }))
    .sort((left, right) => left.systemName.localeCompare(right.systemName));
  const requestedThroughputPerMinute = selectedOverviewSummary ? overviewTransportThroughputPerMinute : 0;
  const overviewTransportPlan = getMultiSourceTransportPlan(
    selectedOverviewTransportSources.map((source) => ({
      id: source.id,
      supplyPerMinute: source.supplyPerMinute,
      distanceLy:
        source.systemId === overviewTransportTargetSystemId
          ? 0
          : getGeneratedSystemDistanceLy(lookups.systemLookup.get(source.systemId), overviewTransportTargetSystem),
    })),
    requestedThroughputPerMinute,
    data.settings.vesselCapacityItems,
    data.settings.ilsStorageItems,
    data.settings.vesselSpeedLyPerSecond,
    data.settings.vesselDockingSeconds,
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
      ? Math.min(
          100,
          (overviewTransportPlan.assignedThroughputPerMinute / overviewTransportPlan.requestedThroughputPerMinute) * 100,
        )
      : 0;
  const overviewTransportIncompleteSystemCount = overviewTransportSystemRows.filter((row) => (
    row.systemId !== overviewTransportTargetSystemId &&
    row.distanceLy === null
  )).length;
  const targetedResourceSummaries = data.summary.resourceSummaries.filter((summary) => summary.goalQuantity > 0);
  const combinedTargetPerMinute = targetedResourceSummaries.reduce(
    (sum, summary) => sum + getSummaryTargetPerMinute(summary),
    0,
  );
  const combinedCappedSupplyPerMinute = targetedResourceSummaries.reduce(
    (sum, summary) => sum + Math.min(summary.supplyPerMinute, getSummaryTargetPerMinute(summary)),
    0,
  );
  const combinedProgressPercent =
    combinedTargetPerMinute > 0 ? Math.min(100, (combinedCappedSupplyPerMinute / combinedTargetPerMinute) * 100) : 0;

  return {
    overviewResourceSummaries,
    selectedOverviewSummary,
    overviewTransportDefaultThroughputPerMinute,
    overviewTransportUsesDefault,
    selectedOverviewBreakdown,
    selectedOverviewTransportSources,
    overviewTransportSystemRows,
    overviewTransportPlan,
    overviewTransportRows,
    overviewTransportTotalSupplyPerMinute,
    overviewTransportCoveragePercent,
    overviewTransportIncompleteSystemCount,
    combinedTargetPerMinute,
    combinedCappedSupplyPerMinute,
    combinedProgressPercent,
  };
}

export function buildMapView(
  data: BootstrapData,
  lookups: WorkspaceLookups,
  selectedMapSelection: MapSelection,
): MapViewModel {
  const mapSystemCards = data.solarSystems.map((solarSystem) => {
    const planets = data.planets
      .filter((planet) => planet.solar_system_id === solarSystem.id)
      .sort((left, right) => left.name.localeCompare(right.name));
    const extractionSiteCount = planets.reduce(
      (sum, planet) => sum + (lookups.extractionSiteCountByPlanetId.get(planet.id) ?? 0),
      0,
    );
    const activePlanetCount = planets.filter((planet) => (lookups.extractionSiteCountByPlanetId.get(planet.id) ?? 0) > 0).length;

    return {
      solarSystem,
      planets,
      extractionSiteCount,
      activePlanetCount,
    };
  });

  const selectedMapSystem =
    selectedMapSelection.scope === "system"
      ? data.solarSystems.find((solarSystem) => solarSystem.id === selectedMapSelection.id) ?? null
      : null;
  const selectedMapPlanet =
    selectedMapSelection.scope === "planet"
      ? data.planets.find((planet) => planet.id === selectedMapSelection.id) ?? null
      : null;
  const selectedMapParentSystem = selectedMapPlanet
    ? lookups.systemLookup.get(selectedMapPlanet.solar_system_id) ?? null
    : selectedMapSystem;
  const selectedMapPlanetIds = selectedMapPlanet
    ? [selectedMapPlanet.id]
    : selectedMapSystem
      ? data.planets
          .filter((planet) => planet.solar_system_id === selectedMapSystem.id)
          .map((planet) => planet.id)
      : [];
  const selectedMapPlanetIdSet = new Set(selectedMapPlanetIds);
  const selectedMapExtraction = getExtractionView(
    data,
    selectedMapPlanetIds,
    lookups.oreMinerLookup,
    lookups.gasOutputLookup,
    lookups.resourceLookup,
    lookups.planetLookup,
    lookups.systemLookup,
  );
  const selectedMapExtractionSiteCount = selectedMapPlanetIds.reduce(
    (sum, planetId) => sum + (lookups.extractionSiteCountByPlanetId.get(planetId) ?? 0),
    0,
  );
  const selectedMapPowerDemandMw =
    data.oreVeins
      .filter((vein) => selectedMapPlanetIdSet.has(vein.planet_id))
      .reduce((sum, vein) => {
        const miners = lookups.oreMinerLookup[vein.id] ?? [];
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
    data.liquidSites
      .filter((site) => selectedMapPlanetIdSet.has(site.planet_id))
      .reduce((sum, site) => sum + Number(site.pump_count) * PUMP_POWER_MW, 0) +
    data.oilExtractors
      .filter((site) => selectedMapPlanetIdSet.has(site.planet_id))
      .length * OIL_EXTRACTOR_POWER_MW;

  return {
    mapSystemCards,
    selectedMapSystem,
    selectedMapPlanet,
    selectedMapParentSystem,
    selectedMapPlanetIds,
    selectedMapExtraction,
    selectedMapExtractionSiteCount,
    selectedMapPowerDemandMw,
  };
}

export function buildProductionView(
  data: BootstrapData,
  selectedProjectId: string | null,
  selectedProductionItemKey: string,
  productionDraftItemKey: string,
): ProductionViewModel {
  const productionPlanner = buildProductionPlanner(data, selectedProjectId || null);
  const productionItemChoices = productionPlanner.itemChoices;
  const productionItemSummaries = productionPlanner.itemSummaries;
  const productionWarnings = productionPlanner.warnings;
  const productionOverview = productionPlanner.overview;
  const selectedProductionSummary =
    productionItemSummaries.find((summary) => summary.itemKey === selectedProductionItemKey) ??
    productionItemSummaries[0] ??
    null;
  const craftedProjectImportedItems = data.projectImportedItems
    .filter((item) => item.project_id === selectedProjectId && item.category === "crafted")
    .sort(
      (left, right) =>
        Number(left.sort_order ?? Number.MAX_SAFE_INTEGER) - Number(right.sort_order ?? Number.MAX_SAFE_INTEGER) ||
        left.display_name.localeCompare(right.display_name),
    );
  const productionTree = buildProductionTree(craftedProjectImportedItems, productionItemSummaries);
  const productionTemplateByKey = new Map(craftedProjectImportedItems.map((item) => [item.item_key, item]));
  const selectedProductionTemplate =
    productionItemChoices.find((item) => item.item_key === selectedProductionSummary?.itemKey) ??
    productionItemChoices.find((item) => item.item_key === productionDraftItemKey) ??
    null;
  const selectedProductionReference = getFactorioLabReference(selectedProductionTemplate);
  const selectedProductionProliferatorUsage = inferImportedItemProliferatorUsage(selectedProductionTemplate);
  const selectedProductionSiteViews = selectedProductionSummary
    ? productionPlanner.siteViews.filter((siteView) => siteView.site.item_key === selectedProductionSummary.itemKey)
    : productionPlanner.siteViews;

  return {
    productionPlanner,
    productionItemChoices,
    productionItemSummaries,
    productionWarnings,
    productionOverview,
    selectedProductionSummary,
    craftedProjectImportedItems,
    productionTree,
    productionTemplateByKey,
    selectedProductionTemplate,
    selectedProductionReference,
    selectedProductionProliferatorUsage,
    selectedProductionSiteViews,
  };
}

export function buildProjectsView(
  data: BootstrapData,
  lookups: WorkspaceLookups,
  selectedProjectId: string | null,
): ProjectsViewModel {
  const selectedProject = data.projects.find((project) => project.id === selectedProjectId) ?? null;
  const selectedProjectGoalRows = selectedProject
    ? data.projectGoals
        .filter((goal) => goal.project_id === selectedProject.id && Number(goal.quantity) > 0)
        .map((goal) => {
          const resource = lookups.resourceLookup.get(goal.resource_id);
          const summary = data.summary.resourceSummaries.find((entry) => entry.resourceId === goal.resource_id);
          const targetPerMinute = getProjectGoalDraftQuantity(resource?.type, goal.quantity);
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

  return {
    selectedProjectGoalRows,
  };
}

export function buildLedgerView(
  data: BootstrapData,
  lookups: WorkspaceLookups,
  showAllLedger: boolean,
): LedgerViewModel {
  const ledgerPlanetIds = showAllLedger
    ? Array.from(
        new Set([
          ...data.oreVeins.map((vein) => vein.planet_id),
          ...data.liquidSites.map((site) => site.planet_id),
          ...data.oilExtractors.map((site) => site.planet_id),
          ...data.gasGiantSites.map((site) => site.planet_id),
        ]),
      )
    : lookups.currentPlanet
      ? [lookups.currentPlanet.id]
      : [];

  const ledgerGroups = ledgerPlanetIds
    .map((planetId) => {
      const planet = lookups.planetLookup.get(planetId);
      if (!planet) {
        return null;
      }

      const systemName = lookups.systemLookup.get(planet.solar_system_id)?.name ?? "Unknown System";
      const oreItems = data.oreVeins
        .filter((vein) => vein.planet_id === planetId)
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
        .map((vein) => ({ kind: "ore" as const, createdAt: vein.created_at, data: vein }));
      const liquidItems = data.liquidSites
        .filter((site) => site.planet_id === planetId)
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
        .map((site) => ({ kind: "liquid" as const, createdAt: site.created_at, data: site }));
      const oilItems = data.oilExtractors
        .filter((site) => site.planet_id === planetId)
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
        .map((site) => ({ kind: "oil" as const, createdAt: site.created_at, data: site }));
      const gasItems = data.gasGiantSites
        .filter((site) => site.planet_id === planetId)
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
        .map((site) => ({ kind: "gas" as const, createdAt: site.created_at, data: site }));

      const items = [...oreItems, ...liquidItems, ...oilItems, ...gasItems].sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      );
      const orePowerMw = oreItems.reduce((sum, item) => {
        const miners = lookups.oreMinerLookup[item.data.id] ?? [];
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
    .filter((group): group is LedgerGroup => group !== null)
    .sort((left, right) => {
      const leftIsCurrent = left.planet.id === lookups.currentPlanet?.id;
      const rightIsCurrent = right.planet.id === lookups.currentPlanet?.id;
      if (leftIsCurrent !== rightIsCurrent) {
        return leftIsCurrent ? -1 : 1;
      }
      return new Date(right.latestActivityAt).getTime() - new Date(left.latestActivityAt).getTime();
    });

  return {
    ledgerGroups,
  };
}

function getExtractionView(
  data: BootstrapData,
  planetIds: string[],
  oreMinerLookup: OreMinerLookup,
  gasOutputLookup: GasOutputLookup,
  resourceLookup: Map<string, ResourceDefinition>,
  planetLookup: Map<string, Planet>,
  systemLookup: Map<string, SolarSystem>,
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
    const coveredNodes = getOreVeinCoveredNodes(miners);
    const supplyPerMinute = getOreVeinOutputPerMinute(miners, data.settings.miningSpeedPercent);
    const rollup = ensureRollup(vein.resource_id);

    if (rollup) {
      rollup.placementIds.add(vein.id);
      rollup.supplyMetric += coveredNodes;
      rollup.supplyPerMinute += supplyPerMinute;
      rollup.supplyPerSecond = rollup.supplyPerMinute / 60;
    }

    activityRows.push({
      id: vein.id,
      kind: "ore",
      title: getResourceName(data.resources, vein.resource_id),
      detail: `${miners.length} ${miners.length === 1 ? "miner" : "miners"} | ${coveredNodes.toFixed(1)} nodes covered | ${supplyPerMinute.toFixed(1)} ore/min`,
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
      detail: `${site.pump_count} ${site.pump_count === 1 ? "pump" : "pumps"} | ${supplyPerMinute.toFixed(1)} / min`,
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

    const supplyPerSecond = getOilOutputPerSecond(Number(extractor.oil_per_second), data.settings.miningSpeedPercent);
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
      detail: `${supplyPerMinute.toFixed(1)} / min`,
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
                `${getResourceName(data.resources, output.resource_id)} ${(output.rate_per_second * trueBoost * site.collector_count * 60).toFixed(1)}/min`,
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
    .sort((left, right) => right.supplyPerMinute - left.supplyPerMinute || left.name.localeCompare(right.name));

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

function getResourceOriginEntries(
  data: BootstrapData,
  summary: ResourceSummary,
  oreMinerLookup: OreMinerLookup,
  gasOutputLookup: GasOutputLookup,
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

    const miners = oreMinerLookup[vein.id] ?? [];
    const supplyPerMinute = getOreVeinOutputPerMinute(miners, data.settings.miningSpeedPercent);
    const coveredNodes = getOreVeinCoveredNodes(miners);

    if (supplyPerMinute <= 0) {
      continue;
    }

    originEntries.push({
      planetId: planet.id,
      systemId: planet.solar_system_id,
      supplyMetric: coveredNodes,
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

    const supplyPerMinute = getPumpOutputPerMinute(Number(site.pump_count), data.settings.miningSpeedPercent);

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

    const supplyPerSecond = getOilOutputPerSecond(Number(extractor.oil_per_second), data.settings.miningSpeedPercent);
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
  oreMinerLookup: OreMinerLookup,
  gasOutputLookup: GasOutputLookup,
  resourceLookup: Map<string, ResourceDefinition>,
  planetLookup: Map<string, Planet>,
  systemLookup: Map<string, SolarSystem>,
) {
  const originEntries = getResourceOriginEntries(
    data,
    summary,
    oreMinerLookup,
    gasOutputLookup,
    resourceLookup,
    planetLookup,
  );
  const totalMetric = summary.supplyPerMinute;

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
        percentOfTotal: totalMetric > 0 ? (aggregate.supplyPerMinute / totalMetric) * 100 : 0,
      }))
      .sort((left, right) => right.supplyPerMinute - left.supplyPerMinute || left.name.localeCompare(right.name));
  }

  return {
    systems: finalizeRows(systemAggregates),
    planets: finalizeRows(planetAggregates),
  };
}

function getResourceOriginTransportSources(
  data: BootstrapData,
  summary: ResourceSummary,
  oreMinerLookup: OreMinerLookup,
  gasOutputLookup: GasOutputLookup,
  resourceLookup: Map<string, ResourceDefinition>,
  planetLookup: Map<string, Planet>,
  systemLookup: Map<string, SolarSystem>,
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

function buildProductionTree(craftedItems: ProjectImportedItem[], summaries: ProductionItemSummary[]): ProductionTree {
  const summaryByKey = new Map(summaries.map((summary) => [summary.itemKey, summary]));
  const itemByKey = new Map(craftedItems.map((item) => [item.item_key, item]));
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

  function normalizeDependencyKey(value: string) {
    return String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  }

  function getTreeDependencyDemandPerMinute(importedItem: ProjectImportedItem, dependencyItemKey: string) {
    const dependency = importedItem.dependencies.find((entry) => (
      entry.item_key === dependencyItemKey ||
      normalizeDependencyKey(entry.item_key) === normalizeDependencyKey(dependencyItemKey) ||
      normalizeDependencyKey(entry.display_name) === normalizeDependencyKey(dependencyItemKey)
    ));

    return dependency?.imported_demand_per_minute ?? null;
  }

  for (const item of craftedItems) {
    parentKeysByChild.set(item.item_key, []);
  }

  for (const item of craftedItems) {
    const dependencyKeys = Array.from(new Set(
      item.dependencies
        .filter((dependency) => itemByKey.has(dependency.item_key))
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

    const canonicalUsageTotals = new Map<string, number>();
    for (const candidateItem of craftedItems) {
      const canonicalDemand = getTreeDependencyDemandPerMinute(candidateItem, itemKey);
      if (canonicalDemand !== null && canonicalDemand > 0) {
        canonicalUsageTotals.set(candidateItem.item_key, canonicalDemand);
      }
    }
    const totalUsageDemand = Array.from(canonicalUsageTotals.values()).reduce((sum, value) => sum + value, 0);

    const inputs = item.dependencies
      .filter((dependency) => {
        if (!itemByKey.has(dependency.item_key)) {
          return true;
        }

        if (dependency.dependency_type !== "crafted") {
          return true;
        }

        if (isProliferator(dependency.display_name) && !isProliferator(item.display_name)) {
          return false;
        }

        return true;
      })
      .map<ProductionTreeInput>((dependency) => {
        const canonicalDemand =
          itemByKey.has(dependency.item_key)
            ? getTreeDependencyDemandPerMinute(item, dependency.item_key)
            : null;
        const effectiveDemandPerMinute = canonicalDemand ?? dependency.imported_demand_per_minute;
        const parentCount = itemByKey.has(dependency.item_key)
          ? (parentKeysByChild.get(dependency.item_key)?.length ?? 0)
          : 0;
        const totalDemandForDependency =
          itemByKey.has(dependency.item_key)
            ? craftedItems.reduce((sum, candidateItem) => (
                sum + (getTreeDependencyDemandPerMinute(candidateItem, dependency.item_key) ?? 0)
              ), 0)
            : 0;
        return {
          itemKey: dependency.item_key,
          displayName: dependency.display_name,
          dependencyType: itemByKey.has(dependency.item_key) ? "crafted" : dependency.dependency_type,
          demandPerMinute: effectiveDemandPerMinute,
          sharePercent:
            itemByKey.has(dependency.item_key) && totalDemandForDependency > 0
              ? Math.min(100, (effectiveDemandPerMinute / totalDemandForDependency) * 100)
              : 0,
          isSharedCrafted: itemByKey.has(dependency.item_key) && parentCount > 1,
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

        const effectiveDemandPerMinute =
          getTreeDependencyDemandPerMinute(parentItem, itemKey) ?? dependency.imported_demand_per_minute;
        return {
          itemKey: parentKey,
          displayName: parentItem.display_name,
          demandPerMinute: effectiveDemandPerMinute,
          sharePercent: totalUsageDemand > 0 ? Math.min(100, (effectiveDemandPerMinute / totalUsageDemand) * 100) : 0,
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
    uniqueParentByChild: new Map(
      allKeys
        .filter((itemKey) => (parentKeysByChild.get(itemKey)?.length ?? 0) === 1)
        .map((itemKey) => [itemKey, parentKeysByChild.get(itemKey)?.[0] ?? ""]),
    ),
  };
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

export function getPlanetResourceExtractionIlsCount(planet: Planet, resourceId: string) {
  return getPlanetExtractionOutboundIlsCount(planet, resourceId);
}
