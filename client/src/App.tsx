import { useEffect, useState } from "react";
import "./App.css";
import { ResourceIcon } from "./components/ResourceIcon";
import { ResourceSelect } from "./components/ResourceSelect";
import { deleteBootstrap, exportSnapshot, getBootstrap, importSnapshot, patchBootstrap, postBootstrap } from "./lib/api";
import {
  getAdvancedMinerOutputPerMinute,
  getAdvancedMinerPowerMw,
  getItemsPerMinutePerVessel,
  getOilOutputPerSecond,
  getOrbitalCollectorTrueBoost,
  getPumpOutputPerMinute,
  getRegularMinerOutputPerMinute,
  getRequiredStations,
  getRequiredVessels,
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
  ResourceDefinition,
  ResourceSummary,
  ResourceType,
  SystemDistance,
  TransportRoute,
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

type TransportRouteDraft = {
  sourceSystemId: string;
  destinationSystemId: string;
  resourceId: string;
  throughputPerMinute: number;
};

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
  return planet.planet_type === "gas_giant" ? `${planet.name} · Gas giant` : planet.name;
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

function sortAllResources(resources: ResourceDefinition[]) {
  return resources.slice().sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name));
}

function getSystemPairKey(systemAId: string, systemBId: string) {
  return [systemAId, systemBId].sort().join(":");
}

function getProgressPercent(summary: ResourceSummary) {
  if (summary.goalQuantity <= 0) {
    return 0;
  }

  return Math.min(100, (summary.supplyMetric / summary.goalQuantity) * 100);
}

function getSummaryTargetPerMinute(summary: ResourceSummary) {
  if (summary.goalQuantity <= 0) {
    return 0;
  }

  return summary.type === "ore_vein" ? summary.goalQuantity * 30 : summary.goalQuantity;
}

function getOreVeinOutputPerMinute(miners: OreVeinMiner[], miningResearchBonusPercent: number) {
  return miners.reduce((sum, miner) => {
    if (miner.miner_type === "advanced") {
      return (
        sum +
        getAdvancedMinerOutputPerMinute(
          Number(miner.covered_nodes),
          Number(miner.advanced_speed_percent ?? 100),
          miningResearchBonusPercent,
        )
      );
    }

    return sum + getRegularMinerOutputPerMinute(Number(miner.covered_nodes), miningResearchBonusPercent);
  }, 0);
}

function getDraftOreOutputPerMinute(miners: MinerDraft[], miningResearchBonusPercent: number) {
  return miners.reduce((sum, miner) => {
    if (miner.minerType === "advanced") {
      return sum + getAdvancedMinerOutputPerMinute(miner.coveredNodes, miner.advancedSpeedPercent, miningResearchBonusPercent);
    }

    return sum + getRegularMinerOutputPerMinute(miner.coveredNodes, miningResearchBonusPercent);
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

function App() {
  const [data, setData] = useState<BootstrapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeView, setActiveView] = useState<"log" | "overview" | "transport" | "projects" | "settings">("log");
  const [showAllLedger, setShowAllLedger] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const [newSystemName, setNewSystemName] = useState("");
  const [newPlanetName, setNewPlanetName] = useState("");
  const [newPlanetType, setNewPlanetType] = useState<"solid" | "gas_giant">("solid");
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
  const [gasOutputs, setGasOutputs] = useState<GasOutputDraft[]>([{ resourceId: "", ratePerSecond: 1 }]);
  const [routeDraft, setRouteDraft] = useState<TransportRouteDraft>({
    sourceSystemId: "",
    destinationSystemId: "",
    resourceId: "",
    throughputPerMinute: 0,
  });
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
  const [editingRouteId, setEditingRouteId] = useState("");
  const [editingRouteDraft, setEditingRouteDraft] = useState<TransportRouteDraft>({
    sourceSystemId: "",
    destinationSystemId: "",
    resourceId: "",
    throughputPerMinute: 0,
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
    if (!data) {
      return;
    }

    const oreResources = sortResources(data.resources, "ore_vein");
    const liquidResources = sortResources(data.resources, "liquid_pump");
    const oilResources = sortResources(data.resources, "oil_extractor");
    const gasResources = sortResources(data.resources, "gas_giant_output");
    const allResources = sortAllResources(data.resources);

    if (!oreResourceId && oreResources[0]) {
      setOreResourceId(oreResources[0].id);
    }

    if (!liquidResourceId && liquidResources[0]) {
      setLiquidResourceId(liquidResources[0].id);
    }

    if (!oilResourceId && oilResources[0]) {
      setOilResourceId(oilResources[0].id);
    }

    if (gasResources.length > 0 && !gasOutputs[0]?.resourceId) {
      setGasOutputs([{ resourceId: gasResources[0].id, ratePerSecond: 1 }]);
    }

    if (!routeDraft.resourceId && allResources[0]) {
      setRouteDraft((current) => ({ ...current, resourceId: allResources[0].id }));
    }

    if (!routeDraft.sourceSystemId && data.solarSystems[0]) {
      setRouteDraft((current) => ({
        ...current,
        sourceSystemId: data.solarSystems[0]?.id ?? "",
        destinationSystemId: current.destinationSystemId || data.solarSystems[1]?.id || "",
      }));
    }

    if (!distanceDraft.systemAId && data.solarSystems[0]) {
      setDistanceDraft((current) => ({
        ...current,
        systemAId: data.solarSystems[0]?.id ?? "",
        systemBId: current.systemBId || data.solarSystems[1]?.id || "",
      }));
    }
  }, [data, distanceDraft.systemAId, gasOutputs, liquidResourceId, oilResourceId, oreResourceId, routeDraft.resourceId, routeDraft.sourceSystemId]);

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
    if (!data || newPlanetName) {
      return;
    }

    const currentSystemName =
      data.solarSystems.find((solarSystem) => solarSystem.id === data.settings.currentSolarSystemId)?.name ?? "";
    if (currentSystemName) {
      setNewPlanetName(buildPlanetNamePrefix(currentSystemName));
    }
  }, [data, newPlanetName]);

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
  const allResources = sortAllResources(loadedData.resources);

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
  const planetLookup = new Map(loadedData.planets.map((planet) => [planet.id, planet]));
  const systemLookup = new Map(loadedData.solarSystems.map((solarSystem) => [solarSystem.id, solarSystem]));
  const systemDistanceLookup = new Map(
    loadedData.systemDistances.map((distance) => [getSystemPairKey(distance.system_a_id, distance.system_b_id), distance]),
  );
  const latestPlanetActivity = getLatestPlanetActivity(loadedData);
  const selectedOreSummary = loadedData.summary.resourceSummaries.find((summary) => summary.resourceId === oreResourceId) ?? null;
  const selectedLiquidSummary = loadedData.summary.resourceSummaries.find((summary) => summary.resourceId === liquidResourceId) ?? null;
  const selectedOilSummary = loadedData.summary.resourceSummaries.find((summary) => summary.resourceId === oilResourceId) ?? null;
  const pendingOreNodeEquivalents = getDraftOreOutputPerMinute(oreMiners, loadedData.settings.miningResearchBonusPercent) / 30;
  const pendingLiquidOutputPerMinute = getPumpOutputPerMinute(pumpCount, loadedData.settings.miningResearchBonusPercent);
  const pendingOilPerMinute = getOilOutputPerSecond(oilPerSecond) * 60;
  const targetedResourceSummaries = loadedData.summary.resourceSummaries.filter((summary) => summary.goalQuantity > 0);
  const combinedTargetPerMinute = targetedResourceSummaries.reduce(
    (sum, summary) => sum + getSummaryTargetPerMinute(summary),
    0,
  );
  const combinedSupplyPerMinute = targetedResourceSummaries.reduce(
    (sum, summary) => sum + summary.supplyPerMinute,
    0,
  );
  const combinedProgressPercent =
    combinedTargetPerMinute > 0 ? Math.min(100, (combinedSupplyPerMinute / combinedTargetPerMinute) * 100) : 0;
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
  const sortedSystemDistances = loadedData.systemDistances
    .slice()
    .sort((left, right) => {
      const leftLabel = `${systemLookup.get(left.system_a_id)?.name ?? ""} ${systemLookup.get(left.system_b_id)?.name ?? ""}`;
      const rightLabel = `${systemLookup.get(right.system_a_id)?.name ?? ""} ${systemLookup.get(right.system_b_id)?.name ?? ""}`;
      return leftLabel.localeCompare(rightLabel);
    });
  const routeEntries = loadedData.transportRoutes
    .slice()
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .map((route) => {
      const distance = systemDistanceLookup.get(getSystemPairKey(route.source_system_id, route.destination_system_id)) ?? null;
      const distanceLy = distance ? Number(distance.distance_ly) : null;
      const roundTripSeconds =
        distanceLy === null
          ? null
          : getTransportRoundTripSeconds(
              distanceLy,
              loadedData.settings.vesselSpeedLyPerSecond,
              loadedData.settings.vesselDockingSeconds,
            );
      const itemsPerMinutePerVessel =
        distanceLy === null
          ? null
          : getItemsPerMinutePerVessel(
              loadedData.settings.vesselCapacityItems,
              distanceLy,
              loadedData.settings.vesselSpeedLyPerSecond,
              loadedData.settings.vesselDockingSeconds,
            );
      const requiredVessels =
        distanceLy === null
          ? null
          : getRequiredVessels(
              Number(route.throughput_per_minute),
              loadedData.settings.vesselCapacityItems,
              distanceLy,
              loadedData.settings.vesselSpeedLyPerSecond,
              loadedData.settings.vesselDockingSeconds,
            );
      const requiredStations =
        distanceLy === null
          ? null
          : getRequiredStations(
              Number(route.throughput_per_minute),
              loadedData.settings.vesselCapacityItems,
              distanceLy,
              loadedData.settings.vesselSpeedLyPerSecond,
              loadedData.settings.vesselDockingSeconds,
            );

      return {
        route,
        distance,
        distanceLy,
        roundTripSeconds,
        itemsPerMinutePerVessel,
        requiredVessels,
        requiredStations,
      };
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
        setGasOutputs([{ resourceId: gasResources[0]?.id ?? "", ratePerSecond: 1 }]);
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

  function startRouteEdit(route: TransportRoute) {
    setEditingRouteId(route.id);
    setEditingRouteDraft({
      sourceSystemId: route.source_system_id,
      destinationSystemId: route.destination_system_id,
      resourceId: route.resource_id,
      throughputPerMinute: Number(route.throughput_per_minute),
    });
  }

  function cancelRouteEdit() {
    setEditingRouteId("");
    setEditingRouteDraft({
      sourceSystemId: "",
      destinationSystemId: "",
      resourceId: "",
      throughputPerMinute: 0,
    });
  }

  async function handleCreateTransportRoute() {
    if (!routeDraft.sourceSystemId || !routeDraft.destinationSystemId || !routeDraft.resourceId || routeDraft.throughputPerMinute <= 0) {
      return;
    }

    await mutate(
      () =>
        postBootstrap("/api/transport-routes", {
          sourceSystemId: routeDraft.sourceSystemId,
          destinationSystemId: routeDraft.destinationSystemId,
          resourceId: routeDraft.resourceId,
          throughputPerMinute: Number(routeDraft.throughputPerMinute),
        }),
      (nextData) => {
        applyBootstrap(nextData);
      },
    );
  }

  async function handleSaveRouteEdit() {
    if (!editingRouteId || !editingRouteDraft.sourceSystemId || !editingRouteDraft.destinationSystemId || !editingRouteDraft.resourceId || editingRouteDraft.throughputPerMinute <= 0) {
      return;
    }

    await mutate(
      () =>
        patchBootstrap(`/api/transport-routes/${editingRouteId}`, {
          sourceSystemId: editingRouteDraft.sourceSystemId,
          destinationSystemId: editingRouteDraft.destinationSystemId,
          resourceId: editingRouteDraft.resourceId,
          throughputPerMinute: Number(editingRouteDraft.throughputPerMinute),
        }),
      (nextData) => {
        applyBootstrap(nextData);
        cancelRouteEdit();
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
      setNotice(`Exported snapshot and downloaded JSON. Server copy: ${payload.exportPath}`);
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
          ["transport", "Transportation"],
          ["projects", "Projects"],
          ["settings", "Settings"],
        ].map(([viewKey, label]) => (
          <button
            key={viewKey}
            type="button"
            className={`view-tab ${activeView === viewKey ? "view-tab-active" : ""}`}
            onClick={() => setActiveView(viewKey as "log" | "overview" | "transport" | "projects" | "settings")}
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

                <p className="helper-text">Net output uses the collector true boost formula, including the 30 MW internal fuel burn and your mining research bonus.</p>

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
                      <label className="field">
                        <span>Configured rate / sec</span>
                        <input
                          type="number"
                          min={0.1}
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
                    onClick={() => setGasOutputs((current) => [...current, { resourceId: gasResources[0]?.id ?? "", ratePerSecond: 1 }])}
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
                <p className="eyebrow">Live Totals</p>
                <h2>Combined resource progress</h2>
              </div>
            </div>
            <article className="overview-total-card">
              <div className="overview-total-header">
                <div>
                  <h3>Total throughput</h3>
                  <p>All targeted resources combined, normalized to per-minute output.</p>
                </div>
                <div className={`metric-line metric-line-inline ${combinedSupplyPerMinute >= combinedTargetPerMinute && combinedTargetPerMinute > 0 ? "metric-line-done" : ""}`}>
                  <strong>{formatValue(combinedSupplyPerMinute)}</strong>
                  <span>/ {formatValue(combinedTargetPerMinute)} / min</span>
                </div>
              </div>
              <div className="progress-rail progress-rail-large">
                <span style={{ width: `${combinedProgressPercent}%` }} />
              </div>
            </article>
            <div className="resource-grid">
              {data.summary.resourceSummaries.filter((summary) => summary.goalQuantity > 0 || summary.supplyMetric > 0).map((summary) => (
                <article key={summary.resourceId} className="resource-card">
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
                        <p>{summary.goalUnitLabel}</p>
                      </div>
                    </div>
                  </div>

                  <div className={`metric-line metric-line-inline ${summary.supplyMetric >= summary.goalQuantity ? "metric-line-done" : ""}`}>
                    <strong>{formatValue(summary.supplyMetric)}</strong>
                    <span>/ {formatValue(summary.goalQuantity)}</span>
                  </div>
                  <div className="progress-rail">
                    <span style={{ width: `${getProgressPercent(summary)}%` }} />
                  </div>
                  <div className="resource-meta">
                    <span>{summary.placementCount} setups</span>
                    {summary.type !== "liquid_pump" && (
                      <span>
                        {formatValue(summary.supplyPerSecond)} / sec · {formatValue(summary.supplyPerMinute)} / min
                      </span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
          )}

          {activeView === "transport" && (
          <>
            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Transport Planner</p>
                  <h2>Routes and instant calculator</h2>
                </div>
              </div>

              <div className="transport-planner-grid">
                <form
                  className="entry-card"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleCreateTransportRoute();
                  }}
                >
                  <div className="entry-card-header">
                    <div>
                      <p className="eyebrow">Saved route</p>
                      <h3>New interstellar route</h3>
                    </div>
                  </div>

                  <div className="transport-form-grid">
                    <label className="field">
                      <span>Source system</span>
                      <select
                        value={routeDraft.sourceSystemId}
                        onChange={(event) => setRouteDraft((current) => ({ ...current, sourceSystemId: event.target.value }))}
                      >
                        <option value="">Select source</option>
                        {data.solarSystems.map((solarSystem) => (
                          <option key={solarSystem.id} value={solarSystem.id}>
                            {solarSystem.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      <span>Destination system</span>
                      <select
                        value={routeDraft.destinationSystemId}
                        onChange={(event) => setRouteDraft((current) => ({ ...current, destinationSystemId: event.target.value }))}
                      >
                        <option value="">Select destination</option>
                        {data.solarSystems.map((solarSystem) => (
                          <option key={solarSystem.id} value={solarSystem.id}>
                            {solarSystem.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      <span>Resource</span>
                      <ResourceSelect resources={allResources} value={routeDraft.resourceId} onChange={(value) => setRouteDraft((current) => ({ ...current, resourceId: value }))} disabled={busy} />
                    </label>

                    <label className="field">
                      <span>Throughput / min</span>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={routeDraft.throughputPerMinute}
                        onChange={(event) => setRouteDraft((current) => ({ ...current, throughputPerMinute: Number(event.target.value) }))}
                      />
                    </label>
                  </div>

                  <button type="submit" className="primary-button" disabled={busy || data.solarSystems.length < 2}>
                    Save route
                  </button>
                </form>

                <section className="entry-card">
                  <div className="entry-card-header">
                    <div>
                      <p className="eyebrow">Quick calc</p>
                      <h3>Raw ILS requirement</h3>
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
                      <span>Target ILS needed</span>
                      <strong>{quickCalcTargetStationsNeeded === null ? "Incomplete" : formatFixedValue(quickCalcTargetStationsNeeded, 1)}</strong>
                    </div>
                  </div>
                </section>
              </div>
            </section>

            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">System pairs</p>
                  <h2>System distances</h2>
                </div>
              </div>

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
                <p className="empty-state">Add a system pair distance to resolve saved route calculations.</p>
              )}
            </section>

            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Saved routes</p>
                  <h2>Transportation ledger</h2>
                </div>
              </div>

              {routeEntries.length > 0 ? (
                <div className="transport-ledger">
                  {routeEntries.map((entry) => {
                    const route = entry.route;
                    const resource = resourceLookup.get(route.resource_id);
                    const sourceLabel = systemLookup.get(route.source_system_id)?.name ?? "Unknown System";
                    const destinationLabel = systemLookup.get(route.destination_system_id)?.name ?? "Unknown System";

                    return (
                      <article key={route.id} className="transport-row-card">
                        <div className="transport-row-main">
                          <div className="transport-route-heading">
                            {resource && (
                              <ResourceIcon
                                name={resource.name}
                                iconUrl={resource.icon_url}
                                colorStart={resource.color_start}
                                colorEnd={resource.color_end}
                                size="sm"
                              />
                            )}
                            <div>
                              <h3>{resource?.name ?? "Unknown Resource"}</h3>
                              <p>{sourceLabel} {"->"} {destinationLabel}</p>
                            </div>
                          </div>

                          <div className="ledger-item-actions">
                            <button type="button" className="ghost-button" onClick={() => startRouteEdit(route)}>
                              Edit
                            </button>
                            <button type="button" className="ghost-button" onClick={() => void confirmAndDelete(`/api/transport-routes/${route.id}`, `${resource?.name ?? "route"} route`)}>
                              Delete
                            </button>
                          </div>
                        </div>

                        <div className="transport-route-stats">
                          <span><strong>{formatFixedValue(Number(route.throughput_per_minute), 1)}</strong> / min</span>
                          <span>
                            {entry.distanceLy === null ? (
                              <span className="transport-warning">Distance missing</span>
                            ) : (
                              `${formatFixedValue(entry.distanceLy, 1)} ly`
                            )}
                          </span>
                          <span>{entry.requiredVessels === null ? "Incomplete" : `${formatFixedValue(entry.requiredVessels, 1)} vessels`}</span>
                          <span>{entry.requiredStations === null ? "Incomplete" : `${formatFixedValue(entry.requiredStations, 1)} ILS`}</span>
                        </div>

                        {entry.itemsPerMinutePerVessel !== null && entry.roundTripSeconds !== null && (
                          <p className="helper-text">
                            {formatFixedValue(entry.itemsPerMinutePerVessel, 1)} items/min per vessel · round trip {formatFixedValue(entry.roundTripSeconds, 1)} s
                          </p>
                        )}

                        {editingRouteId === route.id && (
                          <div className="transport-inline-editor">
                            <label className="field">
                              <span>Source system</span>
                              <select
                                value={editingRouteDraft.sourceSystemId}
                                onChange={(event) => setEditingRouteDraft((current) => ({ ...current, sourceSystemId: event.target.value }))}
                              >
                                <option value="">Select source</option>
                                {data.solarSystems.map((solarSystem) => (
                                  <option key={solarSystem.id} value={solarSystem.id}>
                                    {solarSystem.name}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="field">
                              <span>Destination system</span>
                              <select
                                value={editingRouteDraft.destinationSystemId}
                                onChange={(event) => setEditingRouteDraft((current) => ({ ...current, destinationSystemId: event.target.value }))}
                              >
                                <option value="">Select destination</option>
                                {data.solarSystems.map((solarSystem) => (
                                  <option key={solarSystem.id} value={solarSystem.id}>
                                    {solarSystem.name}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="field">
                              <span>Resource</span>
                              <ResourceSelect resources={allResources} value={editingRouteDraft.resourceId} onChange={(value) => setEditingRouteDraft((current) => ({ ...current, resourceId: value }))} disabled={busy} />
                            </label>

                            <label className="field">
                              <span>Throughput / min</span>
                              <input
                                type="number"
                                min={0}
                                step="any"
                                value={editingRouteDraft.throughputPerMinute}
                                onChange={(event) => setEditingRouteDraft((current) => ({ ...current, throughputPerMinute: Number(event.target.value) }))}
                              />
                            </label>

                            <div className="transport-form-actions">
                              <button type="button" className="primary-button" onClick={() => void handleSaveRouteEdit()} disabled={busy}>
                                Save
                              </button>
                              <button type="button" className="ghost-button" onClick={cancelRouteEdit} disabled={busy}>
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
                <p className="empty-state">No transport routes saved yet.</p>
              )}
            </section>
          </>
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
                          const throughputPerMinute = getOreVeinOutputPerMinute(miners, data.settings.miningResearchBonusPercent);

                          return (
                            <article key={vein.id} className="ledger-item">
                              <div>
                                <h3>{getResourceName(data.resources, vein.resource_id)}</h3>
                                <p>{miners.length} {miners.length === 1 ? "miner" : "miners"} · {formatValue(throughputPerMinute)} ore/min · {formatValue(throughputPerMinute / 30)} node equivalents</p>
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
                                <p>{formatValue(oilPerSecondActual)} / sec · {formatValue(oilPerSecondActual * 60)} / min</p>
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
                          data.settings.miningResearchBonusPercent,
                        );
                        const detail = outputs
                          .map((output) => `${getResourceName(data.resources, output.resource_id)} ${formatValue(output.rate_per_second * trueBoost * site.collector_count * 60)}/min`)
                          .join(" · ");

                        return (
                          <article key={site.id} className="ledger-item">
                            <div>
                              <h3>Collector ring</h3>
                              <p>{site.collector_count} collectors · {detail}</p>
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

        {(activeView === "projects" || activeView === "settings") && (
        <aside className="sidebar-column">
          {activeView === "settings" && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Configuration</p>
                <h2>Mining bonus</h2>
              </div>
            </div>
            <label className="field">
              <span>Mining research bonus %</span>
              <input
                type="number"
                min={0}
                max={500}
                value={data.settings.miningResearchBonusPercent}
                onChange={(event) =>
                  void updateSettings({
                    miningResearchBonusPercent: Number(event.target.value),
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
                    miningResearchBonusPercent: data.settings.miningResearchBonusPercent + 10,
                  })
                }
              >
                +10%
              </button>
              <span className="helper-text">Applied to ore miners, pumps, and orbital collectors.</span>
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
                <p className="eyebrow">Map</p>
                <h2>Systems and planets</h2>
              </div>
            </div>
            <div className="admin-stack">
              {data.solarSystems.map((solarSystem) => {
                const systemPlanets = data.planets.filter((planet) => planet.solar_system_id === solarSystem.id);

                return (
                  <section key={solarSystem.id} className="admin-card">
                    <div className="admin-row">
                      <div>
                        <strong>{solarSystem.name}</strong>
                        <span>{systemPlanets.length} planets</span>
                      </div>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => void confirmAndDelete(`/api/systems/${solarSystem.id}`, `solar system ${solarSystem.name}`)}
                      >
                        Delete system
                      </button>
                    </div>
                    <div className="admin-stack">
                      {systemPlanets.length > 0 ? (
                        systemPlanets
                          .slice()
                          .sort((left, right) => left.name.localeCompare(right.name))
                          .map((planet) => (
                            <div key={planet.id} className="admin-row">
                              <div>
                                <strong>{planet.name}</strong>
                                {planet.planet_type === "gas_giant" && <span>Gas giant</span>}
                              </div>
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={() => void confirmAndDelete(`/api/planets/${planet.id}`, `planet ${planet.name}`)}
                              >
                                Delete planet
                              </button>
                            </div>
                          ))
                      ) : (
                        <p className="helper-text">No planets in this system yet.</p>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
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
                  <textarea value={projectNotesDraft} onChange={(event) => setProjectNotesDraft(event.target.value)} rows={3} />
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
              </>
            )}

            <div className="divider" />

            <label className="field">
              <span>New project name</span>
              <input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="Mall expansion" />
            </label>
            <label className="field">
              <span>Notes</span>
              <textarea value={newProjectNotes} onChange={(event) => setNewProjectNotes(event.target.value)} rows={2} />
            </label>
            <button type="button" className="ghost-button full-width" onClick={() => void handleCreateProject()} disabled={busy}>
              Create project
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
            <label className="file-input">
              <span>Import snapshot</span>
              <input type="file" accept=".json,application/json" onChange={(event) => void handleImport(event.target.files?.[0])} />
            </label>
          </section>
          )}
        </aside>
        )}
      </section>
    </main>
  );
}

export default App;
