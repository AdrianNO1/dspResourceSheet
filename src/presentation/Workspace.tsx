import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "../App.css";
import { PlanetPicker, type PlanetPickerSystemOption } from "../components/PlanetPicker";
import { ResourceIcon } from "../components/ResourceIcon";
import { ResourceSelect } from "../components/ResourceSelect";
import { useAppContext } from "../application/AppProvider";
import { parseApiEntityPath } from "../application/apiPaths";
import { viewTabs } from "../application/appTypes";
import {
  buildMapView,
  buildOverviewView,
  buildProjectsView,
  buildProductionView,
  buildWorkspaceLookups,
  buildLedgerView,
  getDefaultGasOutputs,
  getDraftOreOutputPerMinute,
  getPlanetExtractionIlsResourceRows,
  getPlanetResourceExtractionIlsCount,
  getOreVeinCoveredNodes,
  getOreVeinOutputPerMinute,
  getRequiredAdvancedMinerNodes,
  getRequiredPumpCount,
  getStoredProjectGoalQuantity,
  getSummaryTargetPerMinute,
  isPlanetMissingExtractionIlsCoverage,
  sortResources,
  toProjectGoalMap,
  type ExtractionRollupRow,
  type ProductionTreeInput,
  type ResourceOriginBreakdownRow,
} from "../application/workspaceQueries";
import type { StoreCommand } from "../application/storeCommands";
import { getExactLineDemand, getRoundedMachinePlan, roundUpValue } from "../domain/productionMath";
import { parseClusterAddress } from "../lib/dspCluster";
import {
  getImportedItemExpectedPowerWatts,
  getImportedItemExpectedMachineCount,
} from "../lib/factoriolabCatalog";
import { buildProductionDraftPreview } from "../lib/productionPlanner";
import { resolveGameIconPath } from "../lib/gameIcons";
import { parseFactorioLabProjectCsv } from "../lib/projectImport";
import {
  OverviewTransportModal,
  ProjectOverviewScreen,
  RawResourcesScreen,
} from "./screens/OverviewScreens";
import { ProjectsScreen, SettingsScreen } from "./screens/ManagementScreens";
import {
  getItemsPerMinutePerVessel,
  getOilOutputPerSecond,
  normalizeOilPerSecondTo100Percent,
  getOrbitalCollectorTrueBoost,
  getPumpOutputPerMinute,
  getRequiredStations,
  getTargetStationsNeeded,
  getTransportRoundTripSeconds,
} from "../lib/dspMath";
import type {
  BootstrapData,
  GasGiantSite,
  MinerType,
  OilExtractor,
  Planet,
  Project,
  ResourceDefinition,
  ResourceSummary,
  ResourceType,
  SolarSystem,
} from "../lib/types";

type MinerDraft = {
  minerType: MinerType;
  coveredNodes: number;
  advancedSpeedPercent: number;
};

type GasOutputDraft = {
  resourceId: string;
  ratePerSecond: number;
};

type RecipeEntry = {
  itemKey: string;
  displayName: string;
  quantity: number;
};

function romanToInteger(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  const numerals = new Map<string, number>([
    ["I", 1],
    ["V", 5],
    ["X", 10],
    ["L", 50],
    ["C", 100],
    ["D", 500],
    ["M", 1000],
  ]);

  let total = 0;
  let previous = 0;
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const current = numerals.get(normalized[index]);
    if (!current) {
      return null;
    }

    if (current < previous) {
      total -= current;
    } else {
      total += current;
      previous = current;
    }
  }

  return total > 0 ? total : null;
}

function getPlanetDisplayOrder(planetName: string, systemName: string) {
  const trimmedPlanetName = planetName.trim();
  const trimmedSystemName = systemName.trim();
  if (!trimmedPlanetName || !trimmedSystemName) {
    return Number.MAX_SAFE_INTEGER;
  }

  const suffix = trimmedPlanetName.toLowerCase().startsWith(trimmedSystemName.toLowerCase())
    ? trimmedPlanetName.slice(trimmedSystemName.length).trim()
    : trimmedPlanetName;
  if (!suffix) {
    return Number.MAX_SAFE_INTEGER;
  }

  if (/^\d+$/.test(suffix)) {
    const numericValue = Number(suffix);
    return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : Number.MAX_SAFE_INTEGER;
  }

  return romanToInteger(suffix) ?? Number.MAX_SAFE_INTEGER;
}

function buildPlanetPickerSystems(solarSystems: SolarSystem[], planets: Planet[]) {
  return solarSystems
    .map<PlanetPickerSystemOption>((solarSystem) => ({
      value: solarSystem.id,
      label: solarSystem.name,
      planets: planets
        .filter((planet) => planet.solar_system_id === solarSystem.id)
        .map((planet) => ({
          value: planet.id,
          label: planet.name,
          supportingText: planet.planet_type === "gas_giant" ? "Gas giant" : "Solid planet",
          searchText: `${planet.name} ${solarSystem.name} ${planet.planet_type === "gas_giant" ? "gas giant" : "solid planet"}`,
          sortOrder: getPlanetDisplayOrder(planet.name, solarSystem.name),
        })),
    }))
    .filter((solarSystem) => solarSystem.planets.length > 0);
}

function getRecentSelectionSettings(
  settings: Pick<BootstrapData["settings"], "recentSolarSystemId" | "recentPlanetId">,
  selection: { systemId?: string | null; planetId?: string | null },
) {
  return {
    recentSolarSystemId: selection.systemId ?? settings.recentSolarSystemId ?? null,
    recentPlanetId: selection.planetId ?? settings.recentPlanetId ?? null,
  };
}

function describeExtractionRollup(row: ExtractionRollupRow) {
  if (row.type === "ore_vein") {
    return `${formatValue(row.supplyMetric)} nodes covered | ${formatValue(row.supplyPerMinute)} / min`;
  }

  if (row.type === "liquid_pump") {
    return `${formatValue(row.supplyPerMinute)} / min`;
  }

  return `${formatValue(row.supplyPerMinute)} / min`;
}

function getPlanetExtractionIlsOverrideDraftKey(planetId: string, resourceId: string) {
  return `${planetId}:${resourceId}`;
}

function getBreakdownSecondaryText(summary: ResourceSummary, row: ResourceOriginBreakdownRow) {
  if (summary.type === "ore_vein") {
    return `${formatValue(row.supplyMetric)} nodes covered`;
  }

  if (summary.type === "liquid_pump") {
    return `${formatValue(row.supplyPerMinute)} / min`;
  }

  return `${formatValue(row.supplyPerMinute)} / min`;
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

function formatDistanceLy(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 3,
  }).format(value);
}

function formatProjectSupplyShare(value: number) {
  if (value > 0 && value < 0.1) {
    return "<0.1";
  }

  return formatFixedValue(value, 1);
}

function toDisplayName(value: string) {
  return value
    .trim()
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatPowerWatts(valueWatts: number) {
  const units = [
    { label: "TW", value: 1_000_000_000_000 },
    { label: "GW", value: 1_000_000_000 },
    { label: "MW", value: 1_000_000 },
    { label: "kW", value: 1_000 },
    { label: "W", value: 1 },
  ];

  const unit = units.find((entry) => valueWatts >= entry.value) ?? units[units.length - 1];
  return `${formatFixedValue(Math.ceil((valueWatts / unit.value) * 100) / 100, 2)} ${unit.label}`;
}

function formatRoundedUpInteger(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.ceil(value - 1e-9)));
}

function formatArtificialStarsNeeded(powerDemandMw: number) {
  const artificialStarCount = Math.ceil(Math.max(0, powerDemandMw) / 144);
  return `${formatRoundedUpInteger(artificialStarCount)} artificial ${artificialStarCount === 1 ? "star" : "stars"}`;
}

function parseRecipeEntries(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name = "", quantityValue = "0"] = entry.split(":");
      const quantity = Number(quantityValue);
      return {
        itemKey: name.trim().toLowerCase().replace(/[_\s]+/g, "-"),
        displayName: toDisplayName(name),
        quantity: Number.isFinite(quantity) ? quantity : 0,
      } satisfies RecipeEntry;
    })
    .filter((entry) => entry.displayName.length > 0 && entry.quantity > 0);
}

function getProjectGoalUnitLabel(resourceType: ResourceType | undefined, fallbackLabel = "items / min") {
  switch (resourceType) {
    case "ore_vein":
      return "items / min";
    case "oil_extractor":
      return "oil / min";
    default:
      return fallbackLabel;
  }
}

function getResourceName(resources: ResourceDefinition[], resourceId: string) {
  return resources.find((resource) => resource.id === resourceId)?.name ?? "Unknown Resource";
}

function describePlanet(planet: Planet) {
  return planet.planet_type === "gas_giant" ? `${planet.name} | Gas giant` : planet.name;
}

function getProgressPercent(summary: ResourceSummary) {
  const targetPerMinute = getSummaryTargetPerMinute(summary);
  if (targetPerMinute <= 0) {
    return 0;
  }

  return Math.min(100, (summary.supplyPerMinute / targetPerMinute) * 100);
}

function isTargetMet(currentPerMinute: number, targetPerMinute: number) {
  return currentPerMinute >= targetPerMinute;
}

function getRawCardPlanningLabel(summary: ResourceSummary, miningSpeedPercent: number) {
  const targetPerMinute = getSummaryTargetPerMinute(summary);

  if (summary.type === "ore_vein") {
    return `${formatValue(getRequiredAdvancedMinerNodes(targetPerMinute, miningSpeedPercent))} req. nodes`;
  }

  if (summary.type === "liquid_pump" && (summary.name === "Water" || summary.name === "Sulfuric Acid")) {
    return `${formatValue(getRequiredPumpCount(targetPerMinute, miningSpeedPercent))} req. pumps`;
  }

  return null;
}

function formatCurrentWithPending(current: number, pending: number) {
  if (pending <= 0) {
    return formatValue(current);
  }

  return `${formatValue(current)} + ${formatValue(pending)}`;
}

function MachinePill({ label, variant }: { label: string; variant: "advanced" | "regular" | "pump" | "gas" | "oil" | "logistics" }) {
  return <span className={`machine-pill machine-pill-${variant}`}>{label}</span>;
}

function LoadingShell() {
  return (
    <main className="shell loading-shell">
      <section className="panel">
        <p className="eyebrow">Dyson Sphere Program</p>
        <h1>Loading extraction ledger...</h1>
      </section>
    </main>
  );
}

function WorkspaceShell() {
  const {
    state: { data, loading },
  } = useAppContext();

  if (loading || !data) {
    return <LoadingShell />;
  }

  return <Workspace />;
}

function Workspace() {
  const {
    state: {
      data: bootstrapData,
      busy,
      error,
      undoToast,
      activeView,
      selectedProjectId,
      selectedProductionItemKey,
      selectedMapSelection,
    },
    navigateToView,
    setSelectedProjectId,
    setSelectedProductionItemKey,
    setSelectedMapSelection,
    runCommand,
    runUndoableCommand,
    restoreSnapshot,
    exportSnapshot,
    undoToastProgressWidth,
    undoToastSecondsLabel,
  } = useAppContext();
  const data = bootstrapData!;

  const planetExtractionIlsSaveTimersRef = useRef<Record<string, number>>({});
  const planetResourceExtractionIlsSaveTimersRef = useRef<Record<string, number>>({});
  const planetResourceExtractionIlsDraftsRef = useRef<Record<string, string>>({});
  const [showAllLedger, setShowAllLedger] = useState(true);
  const [selectedOverviewResourceId, setSelectedOverviewResourceId] = useState("");
  const [isOverviewTransportModalOpen, setIsOverviewTransportModalOpen] = useState(false);
  const [overviewTransportTargetSystemId, setOverviewTransportTargetSystemId] = useState("");
  const [overviewTransportThroughputPerMinute, setOverviewTransportThroughputPerMinute] = useState(0);
  const [expandedProductionItemKeys, setExpandedProductionItemKeys] = useState<Record<string, boolean>>({});
  const [pendingProductionScrollKey, setPendingProductionScrollKey] = useState("");
  const [highlightedProductionItemKey, setHighlightedProductionItemKey] = useState("");
  const [clusterAddressDraft, setClusterAddressDraft] = useState("");
  const [planetExtractionIlsDrafts, setPlanetExtractionIlsDrafts] = useState<Record<string, string>>({});
  const [planetResourceExtractionIlsDrafts, setPlanetResourceExtractionIlsDrafts] = useState<Record<string, string>>({});
  const [isProductionModalOpen, setIsProductionModalOpen] = useState(false);
  const [editingProductionSiteId, setEditingProductionSiteId] = useState<string | null>(null);
  const [productionSetupPickerItemKey, setProductionSetupPickerItemKey] = useState("");
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
  const [productionDraft, setProductionDraft] = useState({
    itemKey: "",
    throughputPerMinute: 0,
    outboundIlsCount: 0,
    isFinished: false,
    solarSystemId: "",
    planetId: "",
    sameSystemWarpItemKeys: {} as Record<string, boolean>,
  });

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
  }, [data, gasOutputs, liquidResourceId, oilResourceId, oreResourceId]);

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
    setGoalDrafts(toProjectGoalMap(data.projectGoals, selectedProjectId, data.resources));
  }, [data, selectedProjectId]);

  useEffect(() => {
    if (!data) {
      return;
    }

    setClusterAddressDraft(data.settings.clusterAddress ?? "");
    setPlanetExtractionIlsDrafts((current) =>
      data.planets.reduce<Record<string, string>>((acc, planet) => {
        const pendingSave = planetExtractionIlsSaveTimersRef.current[planet.id];
        acc[planet.id] =
          pendingSave
            ? (current[planet.id] ?? "")
            : planet.extraction_outbound_ils_count === null
              ? ""
              : String(planet.extraction_outbound_ils_count);
        return acc;
      }, {}),
    );
  }, [data]);

  useEffect(() => {
    if (!data) {
      return;
    }

    setPlanetResourceExtractionIlsDrafts((current) => {
      const nextDrafts: Record<string, string> = {};

      data.planets.forEach((planet) => {
        planet.extraction_outbound_ils_overrides.forEach((override) => {
          const draftKey = getPlanetExtractionIlsOverrideDraftKey(planet.id, override.resource_id);
          nextDrafts[draftKey] = planetResourceExtractionIlsSaveTimersRef.current[draftKey]
            ? (current[draftKey] ?? "")
            : String(override.ils_count);
        });
      });

      return nextDrafts;
    });
  }, [data]);

  useEffect(() => {
    planetResourceExtractionIlsDraftsRef.current = planetResourceExtractionIlsDrafts;
  }, [planetResourceExtractionIlsDrafts]);

  useEffect(() => {
    setExpandedProductionItemKeys({});
  }, [selectedProjectId]);

  useEffect(() => {
    if (!pendingProductionScrollKey) {
      return;
    }

    const element = document.getElementById(`production-tree-node-${pendingProductionScrollKey}`);
    if (!element) {
      return;
    }

    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    setHighlightedProductionItemKey(pendingProductionScrollKey);
    setPendingProductionScrollKey("");

    const timerId = window.setTimeout(() => {
      setHighlightedProductionItemKey((current) => (current === pendingProductionScrollKey ? "" : current));
    }, 1600);

    return () => window.clearTimeout(timerId);
  }, [pendingProductionScrollKey, expandedProductionItemKeys]);

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
      data.planets
        .filter((planet) => planet.solar_system_id === defaultSystemId && planet.planet_type === "solid")
        .sort((left, right) => left.name.localeCompare(right.name))[0]?.id ??
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
    const timers = planetExtractionIlsSaveTimersRef.current;
    return () => {
      Object.values(timers).forEach((timerId) => {
        window.clearTimeout(timerId);
      });
    };
  }, []);

  useEffect(() => {
    const timers = planetResourceExtractionIlsSaveTimersRef.current;
    return () => {
      Object.values(timers).forEach((timerId) => {
        window.clearTimeout(timerId);
      });
    };
  }, []);

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

    if (data.settings.recentPlanetId && data.planets.some((planet) => planet.id === data.settings.recentPlanetId)) {
      setSelectedMapSelection({ scope: "planet", id: data.settings.recentPlanetId });
      return;
    }

    if (data.settings.currentPlanetId && data.planets.some((planet) => planet.id === data.settings.currentPlanetId)) {
      setSelectedMapSelection({ scope: "planet", id: data.settings.currentPlanetId });
      return;
    }

    if (
      data.settings.recentSolarSystemId &&
      data.solarSystems.some((solarSystem) => solarSystem.id === data.settings.recentSolarSystemId)
    ) {
      setSelectedMapSelection({ scope: "system", id: data.settings.recentSolarSystemId });
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
  }, [data, selectedMapSelection.id, selectedMapSelection.scope, setSelectedMapSelection]);

  async function handleUndoToast() {
    if (!undoToast) {
      return;
    }

    await restoreSnapshot(undoToast.snapshot);
  }

  async function execute(command: StoreCommand, onSuccess?: (payload: BootstrapData) => void) {
    await runCommand(command, onSuccess);
  }

  async function executeUndoable(
    command: StoreCommand,
    undoTitle: string,
    onSuccess?: (payload: BootstrapData) => void,
    undoDescription?: string,
  ) {
    await runUndoableCommand(command, undoTitle, onSuccess, undoDescription);
  }

  const loadedData = data;
  const lookups = useMemo(
    () => buildWorkspaceLookups(loadedData, selectedProjectId),
    [loadedData, selectedProjectId],
  );
  const {
    currentPlanet,
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
    extractionSiteCountByPlanetId,
    currentPlanetExtraction,
  } = lookups;
  const productionIconStart = "#7adbd8";
  const productionIconEnd = "#f1a04f";
  const getIconUrlForName = (name: string) => {
    const resource = resourceByNameLookup.get(name.toLowerCase());
    return resource?.icon_url ?? resolveGameIconPath(name);
  };
  const selectedOreSummary = loadedData.summary.resourceSummaries.find((summary) => summary.resourceId === oreResourceId) ?? null;
  const selectedLiquidSummary = loadedData.summary.resourceSummaries.find((summary) => summary.resourceId === liquidResourceId) ?? null;
  const selectedOilSummary = loadedData.summary.resourceSummaries.find((summary) => summary.resourceId === oilResourceId) ?? null;
  const pendingOreRequiredNodes = getRequiredAdvancedMinerNodes(
    getDraftOreOutputPerMinute(oreMiners, loadedData.settings.miningSpeedPercent),
    loadedData.settings.miningSpeedPercent,
  );
  const selectedOreRequiredNodes = selectedOreSummary
    ? getRequiredAdvancedMinerNodes(selectedOreSummary.supplyPerMinute, loadedData.settings.miningSpeedPercent)
    : 0;
  const selectedOreTargetRequiredNodes = selectedOreSummary
    ? getRequiredAdvancedMinerNodes(getSummaryTargetPerMinute(selectedOreSummary), loadedData.settings.miningSpeedPercent)
    : 0;
  const pendingLiquidOutputPerMinute = getPumpOutputPerMinute(pumpCount, loadedData.settings.miningSpeedPercent);
  const pendingOilPerMinute = getOilOutputPerSecond(
    normalizeOilPerSecondTo100Percent(oilPerSecond, loadedData.settings.miningSpeedPercent),
    loadedData.settings.miningSpeedPercent,
  ) * 60;
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
  const overviewView = useMemo(
    () =>
      buildOverviewView(
        loadedData,
        lookups,
        selectedOverviewResourceId,
        overviewTransportTargetSystemId,
        overviewTransportThroughputPerMinute,
      ),
    [
      loadedData,
      lookups,
      selectedOverviewResourceId,
      overviewTransportTargetSystemId,
      overviewTransportThroughputPerMinute,
    ],
  );
  const {
    selectedOverviewSummary,
    overviewTransportDefaultThroughputPerMinute,
  } = overviewView;
  const mapView = useMemo(
    () => buildMapView(loadedData, lookups, selectedMapSelection),
    [loadedData, lookups, selectedMapSelection],
  );
  const {
    mapSystemCards,
    selectedMapSystem,
    selectedMapPlanet,
    selectedMapParentSystem,
    selectedMapPlanetIds,
    selectedMapExtraction,
    selectedMapExtractionSiteCount,
    selectedMapTotalPowerDemandMw,
  } = mapView;
  const projectsView = useMemo(
    () => buildProjectsView(loadedData, lookups, selectedProjectId),
    [loadedData, lookups, selectedProjectId],
  );
  const { selectedProjectGoalRows } = projectsView;
  const ledgerView = useMemo(
    () => buildLedgerView(loadedData, lookups, showAllLedger),
    [loadedData, lookups, showAllLedger],
  );
  const { ledgerGroups } = ledgerView;
  const projectGoalInputRows = useMemo(
    () =>
      loadedData.resources.map((resource) => {
        const summary = loadedData.summary.resourceSummaries.find((entry) => entry.resourceId === resource.id);
        return {
          id: resource.id,
          name: resource.name,
          iconUrl: resource.icon_url,
          colorStart: resource.color_start ?? "#4f8fba",
          colorEnd: resource.color_end ?? "#6cc8a6",
          unitLabel: getProjectGoalUnitLabel(resource.type, summary?.goalUnitLabel),
          step: resource.type === "oil_extractor" || resource.type === "gas_giant_output" ? 0.1 : 1,
        };
      }),
    [loadedData],
  );
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
  const quickCalcRoundTripLabel = quickCalcRoundTripSeconds === null ? "Incomplete" : `${formatFixedValue(quickCalcRoundTripSeconds, 1)} s`;
  const quickCalcPerVesselLabel = quickCalcItemsPerMinutePerVessel === null ? "Incomplete" : `${formatFixedValue(quickCalcItemsPerMinutePerVessel, 1)} / min`;
  const quickCalcRequiredIlsLabel = quickCalcRequiredStations === null ? "Incomplete" : formatFixedValue(quickCalcRequiredStations, 1);
  const quickCalcTargetIlsLabel = quickCalcTargetStationsNeeded === null ? "Incomplete" : formatFixedValue(quickCalcTargetStationsNeeded, 1);
  const productionView = useMemo(
    () => buildProductionView(loadedData, selectedProjectId, selectedProductionItemKey, productionDraft.itemKey),
    [loadedData, selectedProjectId, selectedProductionItemKey, productionDraft.itemKey],
  );
  const {
    productionItemChoices,
    productionItemSummaries,
    productionWarnings,
    productionOverview,
    selectedProductionSummary,
    productionTree,
    productionTemplateByKey,
    selectedProductionTemplate,
    selectedProductionReference,
    selectedProductionProliferatorUsage,
    selectedProductionSiteViews,
  } = productionView;
  const productionSiteViewsByItemKey = useMemo(() => {
    const grouped = new Map<string, Array<(typeof selectedProductionSiteViews)[number]>>();
    for (const siteView of productionView.productionPlanner.siteViews) {
      const existing = grouped.get(siteView.site.item_key);
      if (existing) {
        existing.push(siteView);
        continue;
      }

      grouped.set(siteView.site.item_key, [siteView]);
    }
    return grouped;
  }, [productionView.productionPlanner.siteViews]);
  const productionSetupPickerSiteViews = productionSetupPickerItemKey
    ? productionSiteViewsByItemKey.get(productionSetupPickerItemKey) ?? []
    : [];
  const productionSetupPickerSummary = productionSetupPickerItemKey
    ? productionItemSummaries.find((item) => item.itemKey === productionSetupPickerItemKey) ?? null
    : null;
  const allPlanetPickerSystems = useMemo(
    () => buildPlanetPickerSystems(loadedData.solarSystems, loadedData.planets),
    [loadedData.planets, loadedData.solarSystems],
  );
  const solidPlanetPickerSystems = useMemo(
    () => buildPlanetPickerSystems(
      loadedData.solarSystems,
      loadedData.planets.filter((planet) => planet.planet_type === "solid"),
    ),
    [loadedData.planets, loadedData.solarSystems],
  );
  const gasPlanetPickerSystems = useMemo(
    () => buildPlanetPickerSystems(
      loadedData.solarSystems,
      loadedData.planets.filter((planet) => planet.planet_type === "gas_giant"),
    ),
    [loadedData.planets, loadedData.solarSystems],
  );
  const canSubmitProductionSite =
    !busy &&
    !!productionDraft.itemKey &&
    !!productionDraft.solarSystemId &&
    !!productionDraft.planetId;
  const isEditingProductionSite = editingProductionSiteId !== null;
  const productionModalEyebrow = isEditingProductionSite ? "Edit production site" : "New production site";
  const productionModalSubmitLabel = isEditingProductionSite ? "Save production site" : "Add production site";
  const productionDraftPreview = buildProductionDraftPreview(
    loadedData,
    selectedProjectId || null,
    productionDraft.itemKey,
    Number(productionDraft.throughputPerMinute),
    productionDraft.solarSystemId,
    productionDraft.planetId,
    productionDraft.sameSystemWarpItemKeys,
  );
  const selectedProductionFallbackRecipeOutputs = selectedProductionTemplate ? parseRecipeEntries(selectedProductionTemplate.outputs || "") : [];
  const selectedProductionRecipeOutputs = selectedProductionReference?.outputs ?? selectedProductionFallbackRecipeOutputs;
  const selectedProductionPrimaryOutputQuantity = selectedProductionReference?.primaryOutputQuantity ?? selectedProductionRecipeOutputs[0]?.quantity ?? 1;
  const selectedProductionPrimaryOutputIndex = selectedProductionTemplate
    ? selectedProductionRecipeOutputs.findIndex((entry) => entry.itemKey === selectedProductionTemplate.item_key)
    : -1;
  const selectedProductionAdditionalOutputs =
    productionDraftPreview && selectedProductionPrimaryOutputQuantity > 0
      ? selectedProductionRecipeOutputs
          .filter((_, index) => index !== (selectedProductionPrimaryOutputIndex >= 0 ? selectedProductionPrimaryOutputIndex : 0))
          .map((entry) => {
            const outputRatio = entry.quantity / selectedProductionPrimaryOutputQuantity;
            return {
              ...entry,
              throughputPerMinute: productionDraftPreview.throughputPerMinute * outputRatio,
              beltsPerLine: productionDraftPreview.outputBeltsPerLine * outputRatio,
            };
          })
          .filter((entry) => entry.throughputPerMinute > 0)
      : [];
  const selectedProductionRecipeInputs = selectedProductionTemplate
    ? selectedProductionReference?.inputs ?? selectedProductionTemplate.dependencies.map<RecipeEntry>((dependency) => ({
        itemKey: dependency.item_key,
        displayName: dependency.display_name,
        quantity: dependency.per_unit_ratio * selectedProductionPrimaryOutputQuantity,
      }))
    : [];
  const selectedProductionBaseCycleSeconds =
    selectedProductionReference?.baseCycleSeconds ??
    (
      selectedProductionTemplate &&
      selectedProductionTemplate.machine_count > 0 &&
      selectedProductionTemplate.imported_throughput_per_minute > 0
        ? (selectedProductionTemplate.machine_count * selectedProductionPrimaryOutputQuantity * 60) /
          selectedProductionTemplate.imported_throughput_per_minute
        : null
    );
  const selectedProductionAdjustedCycleSeconds =
    selectedProductionProliferatorUsage?.adjustedCycleSeconds ??
    (
      selectedProductionReference?.machineSpeed && selectedProductionBaseCycleSeconds !== null
        ? selectedProductionBaseCycleSeconds / selectedProductionReference.machineSpeed
        : selectedProductionBaseCycleSeconds
    );
  const selectedProductionProliferatorLevel = selectedProductionProliferatorUsage?.level ?? 0;
  const selectedProductionEnergyMultiplier = selectedProductionProliferatorUsage?.energyMultiplier ?? 1;
  const selectedProductionModeLabel =
    selectedProductionProliferatorUsage?.mode === "extra-products"
      ? `P${selectedProductionProliferatorUsage.level} extra products`
      : selectedProductionProliferatorUsage?.mode === "speedup"
        ? `P${selectedProductionProliferatorUsage.level} speedup`
        : selectedProductionProliferatorUsage?.mode === "unknown"
          ? `P${selectedProductionProliferatorUsage.level} mode uncertain`
          : "No proliferator";
  const selectedProductionMachinePlan =
    selectedProductionSummary && selectedProductionTemplate
      ? getRoundedMachinePlan(
          getImportedItemExpectedMachineCount(
            selectedProductionTemplate,
            selectedProductionSummary.totalPlannedThroughput,
          ) ?? selectedProductionSummary.plannedMachineCount,
          selectedProductionSummary.plannedLineCount,
        )
      : null;
  const productionDraftAverageMachinePlan =
    productionDraftPreview && selectedProductionTemplate
      ? getRoundedMachinePlan(
          getImportedItemExpectedMachineCount(
            selectedProductionTemplate,
            productionDraftPreview.throughputPerMinute,
          ) ?? productionDraftPreview.machineCount,
          productionDraftPreview.lineCount,
        )
      : null;
  const productionDraftMachinePlan =
    productionDraftPreview && selectedProductionTemplate
      ? getRoundedMachinePlan(
          getImportedItemExpectedMachineCount(
            selectedProductionTemplate,
            productionDraftPreview.throughputPerMinute,
          ) ?? productionDraftPreview.machineCount,
          productionDraftPreview.lineCount,
        )
      : null;
  const productionDraftExactLineDemand = productionDraftPreview
    ? getExactLineDemand(productionDraftPreview.outputBelts, productionDraftPreview.dependencies)
    : null;
  const selectedProductionEstimatedPowerWatts =
    productionDraftMachinePlan && selectedProductionTemplate
      ? getImportedItemExpectedPowerWatts(selectedProductionTemplate, productionDraftPreview?.throughputPerMinute)
      : 0;
  const allExpandableProductionKeys = Array.from(productionTree.nodesByKey.values())
    .filter((node) => node.inputs.length > 0 || node.usages.length > 0)
    .map((node) => node.itemKey);
  const allProductionRowsExpanded =
    allExpandableProductionKeys.length > 0 &&
    allExpandableProductionKeys.every((itemKey) => expandedProductionItemKeys[itemKey]);

  function focusProductionTreeItem(itemKey: string) {
    setSelectedProductionItemKey(itemKey);
    const nextExpanded: Record<string, boolean> = {};
    let currentKey: string | undefined = itemKey;
    while (currentKey) {
      nextExpanded[currentKey] = true;
      currentKey = productionTree.uniqueParentByChild.get(currentKey);
    }
    setExpandedProductionItemKeys((current) => ({
      ...current,
      ...nextExpanded,
    }));
    setPendingProductionScrollKey(itemKey);
  }

  function getProductionTreeRootKey(itemKey: string) {
    let currentKey = itemKey;
    while (productionTree.uniqueParentByChild.has(currentKey)) {
      currentKey = productionTree.uniqueParentByChild.get(currentKey) ?? currentKey;
    }
    return currentKey;
  }

  function getProductionSetupStatusLabel(activeSiteCount: number, siteCount: number) {
    if (siteCount <= 0) {
      return "";
    }
    if (activeSiteCount === siteCount) {
      return `${siteCount} ${siteCount === 1 ? "setup" : "setups"}`;
    }
    return `${activeSiteCount}/${siteCount} setups active`;
  }

  function getProductionSummaryMachinePlan(summary: (typeof productionItemSummaries)[number]) {
    const summaryTemplate = productionTemplateByKey.get(summary.itemKey) ?? null;
    return getRoundedMachinePlan(
      getImportedItemExpectedMachineCount(summaryTemplate, summary.totalPlannedThroughput) ?? summary.plannedMachineCount,
      summary.plannedLineCount,
    );
  }

  function getProductionSiteMachinePlan(siteView: (typeof selectedProductionSiteViews)[number]) {
    return getRoundedMachinePlan(
      getImportedItemExpectedMachineCount(
        siteView.importedItem,
        Number(siteView.site.throughput_per_minute),
      ) ?? siteView.machineCount,
      siteView.lineCount,
    );
  }

  function openProductionSetupEditor(itemKey: string) {
    const relatedSiteViews = productionSiteViewsByItemKey.get(itemKey) ?? [];
    if (relatedSiteViews.length === 0) {
      return;
    }

    setSelectedProductionItemKey(itemKey);
    if (relatedSiteViews.length === 1) {
      openEditProductionSiteModal(relatedSiteViews[0].site.id);
      return;
    }

    setProductionSetupPickerItemKey(itemKey);
  }

  function closeProductionSetupPicker() {
    setProductionSetupPickerItemKey("");
  }

  function toggleExpandAllProductionRows() {
    if (allProductionRowsExpanded) {
      setExpandedProductionItemKeys({});
      return;
    }

    setExpandedProductionItemKeys(
      Object.fromEntries(allExpandableProductionKeys.map((itemKey) => [itemKey, true])),
    );
  }

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
    const rootItemKey = getProductionTreeRootKey(node.itemKey);
    const nodeMachinePlan = getProductionSummaryMachinePlan(node.summary);
    const matchingRawResource = resourceByNameLookup.get(node.summary.displayName.toLowerCase()) ?? null;
    const trackedRawSupplyPerMinute = matchingRawResource
      ? loadedData.summary.resourceSummaries.find((summary) => summary.resourceId === matchingRawResource.id)?.supplyPerMinute ?? 0
      : 0;

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
      <div
        key={`${referenceInput ? `${referenceInput.itemKey}:${depth}` : "node"}:${node.itemKey}`}
        className="production-tree-branch"
        style={{ "--production-depth": depth } as CSSProperties}
      >
        <div
          id={referenceInput ? undefined : `production-tree-node-${node.itemKey}`}
          className={`production-tree-row ${isSelected ? "production-tree-row-active" : ""} ${highlightedProductionItemKey === node.itemKey ? "production-tree-row-flash" : ""}`}
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
            {'>'}
          </button>
          <div className="production-tree-main">
            <button type="button" className="production-tree-primary-action" onClick={toggleExpanded}>
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
                  <div className="production-tree-reference-meta">
                    <span>{formatRoundedUpInteger(node.summary.totalPlannedThroughput)} / min</span>
                    {referenceInput ? (
                      <>
                      {referenceInput.sharePercent < 99.95 ? <span>{formatProjectSupplyShare(referenceInput.sharePercent)}% of project supply</span> : null}
                      {referenceInput.isSharedCrafted ? (
                        <span
                          className="production-tree-reference-badge production-tree-reference-badge-clickable"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            focusProductionTreeItem(rootItemKey);
                          }}
                          title={`Jump to ${productionTree.nodesByKey.get(rootItemKey)?.summary.displayName ?? node.summary.displayName}`}
                        >
                          shared input
                        </span>
                      ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            </button>
            <div className="production-tree-metrics">
              {node.summary.siteCount > 0 ? (
                <button
                  type="button"
                  className="production-tree-metric production-tree-metric-button"
                  onClick={() => openProductionSetupEditor(node.itemKey)}
                  title={`Edit setup${node.summary.siteCount === 1 ? "" : "s"} for ${node.summary.displayName}`}
                >
                  <strong>{getProductionSetupStatusLabel(node.summary.activeSiteCount, node.summary.siteCount)}</strong>
                </button>
              ) : null}
              <div className="production-tree-metric">
                <strong>{formatRoundedUpInteger(nodeMachinePlan.totalMachineCount)}</strong>
                <span className="production-tree-metric-label">machines</span>
              </div>
              <div className="production-tree-metric">
                <strong>{node.summary.plannedLineCount}</strong>
                <span className="production-tree-metric-label">lines</span>
              </div>
            </div>
          </div>
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

        {isExpanded && (node.usages.length > 1 || trackedRawSupplyPerMinute > 0) ? (
          <div className="production-tree-expanded">
            {node.usages.length > 1 ? (
              <div className="production-tree-expanded-section">
                <span className="production-tree-expanded-label">Used in</span>
                <div className="production-tree-expanded-list">
                  {node.usages.map((usage) => (
                    <button
                      key={`${node.itemKey}:${usage.itemKey}`}
                      type="button"
                      className="production-tree-expanded-row"
                      onClick={() => focusProductionTreeItem(usage.itemKey)}
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
                      <span>{formatProjectSupplyShare(usage.sharePercent)}% of project supply</span>
                      <span>{formatValue(usage.demandPerMinute)} / min</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {trackedRawSupplyPerMinute > 0 ? (
              <p className="helper-text">Tracked raw supply: {formatValue(trackedRawSupplyPerMinute)} / min.</p>
            ) : null}
          </div>
        ) : null}

        {isExpanded && node.inputs.length > 0 ? (
          <div className="production-tree-children" style={{ "--production-depth": depth + 1 } as CSSProperties}>
            {node.inputs.map((input) => {
              if (input.dependencyType === "crafted" && productionTree.nodesByKey.has(input.itemKey) && !input.isSharedCrafted) {
                return renderProductionTreeNode(input.itemKey, depth + 1, { referenceInput: input });
              }

              const sharedInputRootKey = input.isSharedCrafted ? getProductionTreeRootKey(input.itemKey) : "";
              const sharedInputSummary = input.isSharedCrafted
                ? productionTree.nodesByKey.get(sharedInputRootKey)?.summary ?? null
                : null;
              const sharedInputMachinePlan = sharedInputSummary
                ? getProductionSummaryMachinePlan(sharedInputSummary)
                : null;

              return (
                <div key={`${node.itemKey}:${input.itemKey}`} className="production-tree-branch" style={{ "--production-depth": depth + 1 } as CSSProperties}>
                  <div className="production-tree-row production-tree-row-leaf">
                    <div className="production-tree-indent" aria-hidden="true" />
                    <span className="production-tree-usage-toggle production-tree-usage-toggle-leaf" aria-hidden="true">
                      *
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
                          <div className="production-tree-reference-meta">
                            <span>{formatValue(input.demandPerMinute)} / min</span>
                            {input.sharePercent < 99.95 ? <span>{formatProjectSupplyShare(input.sharePercent)}% of project supply</span> : null}
                            <span
                              className={`production-tree-reference-badge ${input.isSharedCrafted ? "production-tree-reference-badge-clickable" : ""}`}
                              onClick={
                                input.isSharedCrafted
                                  ? () => focusProductionTreeItem(sharedInputRootKey)
                                  : undefined
                              }
                              title={
                                input.isSharedCrafted
                                  ? `Jump to ${productionTree.nodesByKey.get(sharedInputRootKey)?.summary.displayName ?? input.displayName}`
                                  : undefined
                              }
                            >
                              {input.isSharedCrafted ? "shared input" : "raw input"}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className={`production-tree-metrics ${sharedInputSummary ? "" : "production-tree-metrics-empty"}`}>
                        {sharedInputSummary?.siteCount ? (
                          <button
                            type="button"
                            className="production-tree-metric production-tree-metric-button"
                            onClick={() => openProductionSetupEditor(sharedInputSummary.itemKey)}
                            title={`Edit setup${sharedInputSummary.siteCount === 1 ? "" : "s"} for ${sharedInputSummary.displayName}`}
                          >
                            <strong>{getProductionSetupStatusLabel(sharedInputSummary.activeSiteCount, sharedInputSummary.siteCount)}</strong>
                          </button>
                        ) : null}
                        {sharedInputSummary && sharedInputMachinePlan ? (
                          <>
                            <div className="production-tree-metric">
                              <strong>{formatRoundedUpInteger(sharedInputMachinePlan.totalMachineCount)}</strong>
                              <span className="production-tree-metric-label">machines</span>
                            </div>
                            <div className="production-tree-metric">
                              <strong>{sharedInputSummary.plannedLineCount}</strong>
                              <span className="production-tree-metric-label">lines</span>
                            </div>
                          </>
                        ) : null}
                      </div>
                    </div>
                    {input.isSharedCrafted && productionItemChoices.some((item) => item.item_key === input.itemKey) ? (
                      <button
                        type="button"
                        className="production-tree-add-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openProductionSiteModal(input.itemKey);
                        }}
                        aria-label={`Add production site for ${input.displayName}`}
                      >
                        +
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }
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
  const clusterAddressHelperText = parsedClusterAddress
    ? `Seed ${parsedClusterAddress.clusterSeed} | ${parsedClusterAddress.clusterStarCount} stars | ${loadedData.summary.generatedSystemCount} systems and ${loadedData.summary.generatedPlanetCount ?? loadedData.summary.planetCount} planets currently generated.`
    : clusterAddressDraft.trim()
      ? "Cluster address format not recognized yet."
      : "Import a DSP cluster address to generate the system and planet catalog with automatic inter-system distances.";

  function getDeleteCommand(path: string): StoreCommand {
    const { collection, id } = parseApiEntityPath(path);

    switch (collection) {
      case "ore-veins":
        return { type: "ore-vein/delete", oreVeinId: id };
      case "liquids":
        return { type: "liquid/delete", liquidSiteId: id };
      case "oil-extractors":
        return { type: "oil-extractor/delete", oilExtractorId: id };
      case "gas-giants":
        return { type: "gas-giant/delete", gasGiantSiteId: id };
      case "production-sites":
        return { type: "production-site/delete", productionSiteId: id };
      case "transport-routes":
        return { type: "transport-route/delete", routeId: id };
      case "planets":
        return { type: "planet/delete", planetId: id };
      case "systems":
        return { type: "system/delete", systemId: id };
      default:
        throw new Error(`Unsupported delete path: ${path}`);
    }
  }

  function getMoveCommand(path: string, planetId: string): StoreCommand {
    const { collection, id } = parseApiEntityPath(path);

    switch (collection) {
      case "ore-veins":
        return { type: "ore-vein/move", oreVeinId: id, planetId };
      case "liquids":
        return { type: "liquid/move", liquidSiteId: id, planetId };
      case "oil-extractors":
        return { type: "oil-extractor/move", oilExtractorId: id, planetId };
      case "gas-giants":
        return { type: "gas-giant/move", gasGiantSiteId: id, planetId };
      default:
        throw new Error(`Unsupported move path: ${path}`);
    }
  }

  async function confirmAndDelete(path: string, label: string) {
    if (!window.confirm(`Delete ${label}?`)) {
      return;
    }

    await executeUndoable(
      getDeleteCommand(path),
      `Deleted ${label}.`,
      undefined,
      "Undo delete is available for a few seconds.",
    );
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

    await execute(getMoveCommand(path, entryLocationDraft.planetId), () => {
      setLastMoveTargets((current) => ({
        ...current,
        [planetType]: {
          systemId: entryLocationDraft.systemId,
          planetId: entryLocationDraft.planetId,
        },
      }));
      cancelLocationEdit();
    });
  }

  function renderLocationEditor(entryKey: string, path: string, planetType: "solid" | "gas_giant") {
    if (editingEntryKey !== entryKey) {
      return null;
    }

    const pickerSystems = planetType === "gas_giant" ? gasPlanetPickerSystems : solidPlanetPickerSystems;

    return (
      <div className="location-editor">
        <label className="field">
          <span>Planet</span>
          <PlanetPicker
            systems={pickerSystems}
            value={entryLocationDraft.planetId}
            onChange={({ planetId, systemId }) => {
              setEntryLocationDraft({ systemId, planetId });
              void updateSettings(getRecentSelectionSettings(loadedData.settings, { systemId, planetId }));
            }}
            recentSystemId={data.settings.recentSolarSystemId}
            recentPlanetId={data.settings.recentPlanetId}
            placeholder="Select planet"
            searchPlaceholder="Search planets or systems"
            emptyText="No planets match your search."
          />
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

  async function updateSettings(payload: Partial<BootstrapData["settings"]>) {
    await execute({ type: "settings/update", settings: payload });
  }

  function handleProductionPlanetChange({ planetId, systemId }: { planetId: string; systemId: string }) {
    setProductionDraft((current) => ({
      ...current,
      planetId,
      solarSystemId: systemId,
    }));
    void updateSettings(getRecentSelectionSettings(loadedData.settings, { systemId, planetId }));
  }

  async function savePlanetExtractionIls(planetId: string, rawValue: string) {
    const nextValue = rawValue.trim() === "" ? null : Number(rawValue);
    if (nextValue !== null && (!Number.isFinite(nextValue) || nextValue < 0)) {
      return;
    }

    const currentValue = data?.planets.find((planet) => planet.id === planetId)?.extraction_outbound_ils_count ?? null;
    if (currentValue === nextValue) {
      return;
    }

    await execute({ type: "planet/update", planetId, extractionOutboundIlsCount: nextValue });
  }

  function queuePlanetExtractionIlsSave(planetId: string, rawValue: string) {
    const existingTimerId = planetExtractionIlsSaveTimersRef.current[planetId];
    if (existingTimerId) {
      window.clearTimeout(existingTimerId);
    }

    const nextValue = rawValue.trim() === "" ? null : Number(rawValue);
    if (nextValue !== null && (!Number.isFinite(nextValue) || nextValue < 0)) {
      delete planetExtractionIlsSaveTimersRef.current[planetId];
      return;
    }

    planetExtractionIlsSaveTimersRef.current[planetId] = window.setTimeout(() => {
      delete planetExtractionIlsSaveTimersRef.current[planetId];
      void savePlanetExtractionIls(planetId, rawValue);
    }, 350);
  }

  function handlePlanetExtractionIlsDraftChange(planetId: string, rawValue: string) {
    setPlanetExtractionIlsDrafts((current) => ({
      ...current,
      [planetId]: rawValue,
    }));
    queuePlanetExtractionIlsSave(planetId, rawValue);
  }

  async function savePlanetResourceExtractionIls(planetId: string, resourceId: string, rawValue: string) {
    const nextValue = rawValue.trim() === "" ? null : Number(rawValue);
    if (nextValue !== null && (!Number.isFinite(nextValue) || nextValue < 0)) {
      return;
    }

    const planet = data?.planets.find((item) => item.id === planetId);
    if (!planet) {
      return;
    }

    const currentValue = planet.extraction_outbound_ils_overrides.find((item) => item.resource_id === resourceId)?.ils_count ?? null;
    if (currentValue === nextValue) {
      return;
    }

    const draftPrefix = `${planetId}:`;
    const draftResourceIds = Object.keys(planetResourceExtractionIlsDraftsRef.current)
      .filter((draftKey) => draftKey.startsWith(draftPrefix))
      .map((draftKey) => draftKey.slice(draftPrefix.length));
    const nextOverrides = Array.from(
      new Set([
        resourceId,
        ...planet.extraction_outbound_ils_overrides.map((item) => item.resource_id),
        ...draftResourceIds,
      ]),
    ).flatMap((draftResourceId) => {
      const draftKey = getPlanetExtractionIlsOverrideDraftKey(planetId, draftResourceId);
      const draftValue = planetResourceExtractionIlsDraftsRef.current[draftKey];
      if (draftValue !== undefined) {
        const parsedValue = draftValue.trim() === "" ? null : Number(draftValue);
        if (parsedValue === null || !Number.isFinite(parsedValue) || parsedValue < 0) {
          return [];
        }

        return [{
          resource_id: draftResourceId,
          ils_count: parsedValue,
        }];
      }

      const existingOverride = planet.extraction_outbound_ils_overrides.find((item) => item.resource_id === draftResourceId);
      return existingOverride ? [existingOverride] : [];
    });

    await execute({
      type: "planet/update",
      planetId,
      extractionOutboundIlsOverrides: nextOverrides.map((item) => ({
        resourceId: item.resource_id,
        ilsCount: item.ils_count,
      })),
    });
  }

  function queuePlanetResourceExtractionIlsSave(planetId: string, resourceId: string, rawValue: string) {
    const draftKey = getPlanetExtractionIlsOverrideDraftKey(planetId, resourceId);
    const existingTimerId = planetResourceExtractionIlsSaveTimersRef.current[draftKey];
    if (existingTimerId) {
      window.clearTimeout(existingTimerId);
    }

    const nextValue = rawValue.trim() === "" ? null : Number(rawValue);
    if (nextValue !== null && (!Number.isFinite(nextValue) || nextValue < 0)) {
      delete planetResourceExtractionIlsSaveTimersRef.current[draftKey];
      return;
    }

    planetResourceExtractionIlsSaveTimersRef.current[draftKey] = window.setTimeout(() => {
      delete planetResourceExtractionIlsSaveTimersRef.current[draftKey];
      void savePlanetResourceExtractionIls(planetId, resourceId, rawValue);
    }, 350);
  }

  function handlePlanetResourceExtractionIlsDraftChange(planetId: string, resourceId: string, rawValue: string) {
    const draftKey = getPlanetExtractionIlsOverrideDraftKey(planetId, resourceId);
    setPlanetResourceExtractionIlsDrafts((current) => ({
      ...current,
      [draftKey]: rawValue,
    }));
    queuePlanetResourceExtractionIlsSave(planetId, resourceId, rawValue);
  }

  function openProductionSiteModal(itemKey: string) {
    const nextTemplate = productionItemChoices.find((item) => item.item_key === itemKey) ?? null;
    if (!nextTemplate) {
      return;
    }

    setProductionSetupPickerItemKey("");
    setEditingProductionSiteId(null);
    setSelectedProductionItemKey(itemKey);
    setProductionDraft((current) => ({
      ...current,
      itemKey,
      throughputPerMinute: Number(nextTemplate.imported_throughput_per_minute),
      outboundIlsCount: 0,
      isFinished: false,
      sameSystemWarpItemKeys: {},
    }));
    setIsProductionModalOpen(true);
  }

  function openEditProductionSiteModal(siteId: string) {
    const site = loadedData.productionSites.find((entry) => entry.id === siteId);
    if (!site) {
      return;
    }

    setProductionSetupPickerItemKey("");
    setEditingProductionSiteId(site.id);
    setSelectedProductionItemKey(site.item_key);
    setProductionDraft({
      itemKey: site.item_key,
      throughputPerMinute: Number(site.throughput_per_minute),
      outboundIlsCount: Number(site.outbound_ils_count),
      isFinished: Number(site.is_finished) === 1,
      solarSystemId: site.solar_system_id,
      planetId: site.planet_id,
      sameSystemWarpItemKeys: Object.fromEntries(site.same_system_warp_item_keys.map((itemKey) => [itemKey, true])),
    });
    setIsProductionModalOpen(true);
  }

  function closeProductionSiteModal() {
    setEditingProductionSiteId(null);
    setIsProductionModalOpen(false);
  }

  async function handleSaveProject() {
    if (!selectedProject) {
      return;
    }

    await execute({
      type: "project/update",
      projectId: selectedProject.id,
      name: projectNameDraft,
      notes: projectNotesDraft,
      isActive: projectActiveDraft,
      goals: loadedData.resources.map((resource) => ({
        resourceId: resource.id,
        quantity: getStoredProjectGoalQuantity(resource.type, Number(goalDrafts[resource.id] ?? 0)),
      })),
    });
  }

  async function handleCreateProject() {
    if (!newProjectName.trim()) {
      return;
    }

    await execute(
      {
        type: "project/create",
        name: newProjectName,
        notes: newProjectNotes,
      },
      (nextData) => {
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

    await execute(
      {
        type: "ore-vein/create",
        planetId: currentPlanet.id,
        resourceId: oreResourceId,
        label: "",
        miners: oreMiners.map((miner) => ({
          minerType: miner.minerType,
          coveredNodes: Number(miner.coveredNodes),
          advancedSpeedPercent: miner.minerType === "advanced" ? Number(miner.advancedSpeedPercent) : undefined,
        })),
      },
      () => {
        const nextAdvancedSpeed = oreMiners.find((miner) => miner.minerType === "advanced")?.advancedSpeedPercent ?? 100;
        setOreMiners([{ minerType: "advanced", coveredNodes: 15, advancedSpeedPercent: nextAdvancedSpeed }]);
      },
    );
  }

  async function handleCreateLiquidSite() {
    if (!currentPlanet || currentPlanet.planet_type !== "solid") {
      return;
    }

    await execute(
      {
        type: "liquid/create",
        planetId: currentPlanet.id,
        resourceId: liquidResourceId,
        label: "",
        pumpCount: Number(pumpCount),
      },
      () => {
        setPumpCount(0);
      },
    );
  }

  async function handleCreateOilExtractor() {
    if (!currentPlanet || currentPlanet.planet_type !== "solid") {
      return;
    }

    await execute(
      {
        type: "oil-extractor/create",
        planetId: currentPlanet.id,
        resourceId: oilResourceId,
        label: "",
        oilPerSecond: normalizeOilPerSecondTo100Percent(Number(oilPerSecond), loadedData.settings.miningSpeedPercent),
      },
      () => {
        setOilPerSecond(0);
      },
    );
  }

  async function handleCreateGasGiant() {
    if (!currentPlanet || currentPlanet.planet_type !== "gas_giant") {
      return;
    }

    await execute(
      {
        type: "gas-giant/create",
        planetId: currentPlanet.id,
        label: "",
        collectorCount: Number(collectorCount),
        outputs: gasOutputs.map((output) => ({
          resourceId: output.resourceId,
          ratePerSecond: Number(output.ratePerSecond),
        })),
      },
      () => {
        setCollectorCount(40);
        setGasOutputs(getDefaultGasOutputs(gasResources));
      },
    );
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
    setIsOverviewTransportModalOpen(true);
  }

  function closeOverviewTransportModal() {
    setIsOverviewTransportModalOpen(false);
  }

  async function handleExport() {
    if (busy) {
      return;
    }

    const payload = await exportSnapshot();
    const blob = new Blob([JSON.stringify(payload.snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "dsp-resource-sheet-export.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(file: File | undefined) {
    if (!file) {
      return;
    }

    const text = await file.text();
    const snapshot = JSON.parse(text) as unknown;
    await restoreSnapshot(snapshot);
  }

  async function handleProjectCsvImport(file: File | undefined) {
    if (!file) {
      return;
    }

    const text = await file.text();
    const importedProject = parseFactorioLabProjectCsv(file.name, text, loadedData.resources);
    await execute(
      {
        type: "project/create",
        name: importedProject.projectName,
        notes: importedProject.projectNotes,
        goals: importedProject.goals,
        importedItems: importedProject.importedItems,
      },
      (bootstrap) => {
        const project = bootstrap.projects
          .filter((item) => item.name === importedProject.projectName && item.notes === importedProject.projectNotes)
          .sort((left, right) => right.sort_order - left.sort_order)[0];

        setSelectedProjectId(project?.id ?? bootstrap.projects[0]?.id ?? "");
        navigateToView("projects");
      },
    );
  }

  async function handleExistingProjectCsvImport(file: File | undefined) {
    if (!file || !selectedProject) {
      return;
    }

    const text = await file.text();
    const importedProject = parseFactorioLabProjectCsv(file.name, text, loadedData.resources);
    await execute(
      {
        type: "project/update",
        projectId: selectedProject.id,
        name: selectedProject.name,
        notes: selectedProject.notes,
        isActive: selectedProject.is_active === 1,
        goals: importedProject.goals,
        importedItems: importedProject.importedItems,
      },
      () => {
        setSelectedProjectId(selectedProject.id);
        navigateToView("projects");
      },
    );
  }

  async function handleSubmitProductionSite() {
    if (
      !selectedProjectId ||
      !productionDraft.itemKey ||
      !productionDraft.solarSystemId ||
      !productionDraft.planetId
    ) {
      return;
    }

    const payload = {
      projectId: selectedProjectId,
      productionSiteId: editingProductionSiteId ?? undefined,
      itemKey: productionDraft.itemKey,
      throughputPerMinute: Number(productionDraft.throughputPerMinute),
      outboundIlsCount: Number(productionDraft.outboundIlsCount),
      isFinished: productionDraft.isFinished,
      solarSystemId: productionDraft.solarSystemId,
      planetId: productionDraft.planetId,
      sameSystemWarpItemKeys: Object.entries(productionDraft.sameSystemWarpItemKeys)
        .filter(([, isEnabled]) => isEnabled)
        .map(([itemKey]) => itemKey),
    } as const;

    if (editingProductionSiteId) {
      await execute(
        { type: "production-site/save", ...payload },
        () => {
          setSelectedProductionItemKey(productionDraft.itemKey);
          closeProductionSiteModal();
        },
      );
      return;
    }

    await execute(
      { type: "production-site/save", ...payload },
      (nextData) => {
        const importedItem = nextData.projectImportedItems.find(
          (item) => item.project_id === selectedProjectId && item.item_key === productionDraft.itemKey,
        );
        setSelectedProductionItemKey(productionDraft.itemKey);
        closeProductionSiteModal();
        setProductionDraft((current) => ({
          ...current,
          throughputPerMinute: Number(importedItem?.imported_throughput_per_minute ?? current.throughputPerMinute),
          outboundIlsCount: 0,
          isFinished: false,
          sameSystemWarpItemKeys: {},
        }));
      },
    );
  }

  async function handleToggleProductionSiteActive(siteId: string, isActive: boolean) {
    const site = loadedData.productionSites.find((entry) => entry.id === siteId);
    if (!site) {
      return;
    }

    await execute({
      type: "production-site/save",
      projectId: site.project_id,
      productionSiteId: site.id,
      itemKey: site.item_key,
      throughputPerMinute: Number(site.throughput_per_minute),
      outboundIlsCount: Number(site.outbound_ils_count),
      isFinished: isActive,
      solarSystemId: site.solar_system_id,
      planetId: site.planet_id,
      sameSystemWarpItemKeys: site.same_system_warp_item_keys,
    });
  }

  async function handleImportClusterAddress() {
    if (!parsedClusterAddress) {
      return;
    }

    await execute({ type: "cluster/import", clusterAddress: parsedClusterAddress.clusterAddress });
  }

  function renderPlanetExtractionIlsFields(planet: Planet, extractionRows: ExtractionRollupRow[]) {
    const resourceRows = getPlanetExtractionIlsResourceRows(planet, extractionRows, resourceLookup);
    const showOverrides = resourceRows.length > 1 || planet.extraction_outbound_ils_overrides.length > 0;

    return (
      <div className="planet-ils-stack">
        <label className="field">
          <span>Default outbound raw ILS on this planet</span>
          <input
            type="number"
            min={0}
            step="any"
            value={planetExtractionIlsDrafts[planet.id] ?? ""}
            onChange={(event) => handlePlanetExtractionIlsDraftChange(planet.id, event.target.value)}
            placeholder="Leave blank if unknown"
          />
        </label>
        <span className="helper-text">Auto-saves after you stop typing. Used for any raw resource without an override.</span>

        {showOverrides && (
          <div className="planet-ils-overrides">
            <div className="planet-ils-overrides-copy">
              <strong>Per-resource overrides</strong>
              <span>Optional. Give shared resources the same count, and leave a field blank to use the planet default.</span>
            </div>

            <div className="planet-ils-override-list">
              {resourceRows.map((row) => {
                const draftKey = getPlanetExtractionIlsOverrideDraftKey(planet.id, row.resourceId);
                const effectiveCount = getPlanetResourceExtractionIlsCount(planet, row.resourceId);

                return (
                  <label key={row.resourceId} className="planet-ils-override-row">
                    <span className="planet-ils-override-label">
                      <ResourceIcon
                        name={row.name}
                        iconUrl={row.iconUrl}
                        colorStart={row.colorStart}
                        colorEnd={row.colorEnd}
                        size="sm"
                      />
                      <span>{row.name}</span>
                    </span>

                    <div className="planet-ils-override-input">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={planetResourceExtractionIlsDrafts[draftKey] ?? ""}
                        onChange={(event) => handlePlanetResourceExtractionIlsDraftChange(planet.id, row.resourceId, event.target.value)}
                        placeholder="Use default"
                      />
                      <span>{effectiveCount === null ? "Unset" : `Using ${formatValue(effectiveCount)}`}</span>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <main className="shell">
      {error && (
        <section className="message-row">
          {error && <div className="message error-message">{error}</div>}
        </section>
      )}
      {undoToast && (
        <section className="message-row">
          <div className="message undo-toast" key={undoToast.id}>
            <div className="undo-toast-main">
              <div className="undo-toast-copy">
                <strong>{undoToast.title}</strong>
                <span>{undoToast.description}</span>
              </div>
              <button type="button" className="ghost-button undo-toast-button" onClick={() => void handleUndoToast()} disabled={busy}>
                Undo
              </button>
            </div>
            <div className="undo-toast-timer">
              <span>{undoToastSecondsLabel}</span>
              <div className="undo-toast-progress" aria-hidden="true">
                <span style={{ width: `${undoToastProgressWidth}%` }} />
              </div>
            </div>
          </div>
        </section>
      )}

      <nav className="view-tabs">
        {viewTabs.map(({ key: viewKey, label }) => (
          <button
            key={viewKey}
            type="button"
            className={`view-tab ${activeView === viewKey ? "view-tab-active" : ""}`}
            onClick={() => navigateToView(viewKey)}
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

            <label className="field">
              <span>Current planet</span>
              <PlanetPicker
                systems={allPlanetPickerSystems}
                value={data.settings.currentPlanetId ?? ""}
                onChange={({ planetId, systemId }) => {
                  void updateSettings({
                    currentSolarSystemId: systemId,
                    currentPlanetId: planetId,
                    recentSolarSystemId: systemId,
                    recentPlanetId: planetId,
                  });
                }}
                disabled={busy || allPlanetPickerSystems.length === 0}
                recentSystemId={data.settings.recentSolarSystemId}
                recentPlanetId={data.settings.recentPlanetId}
                placeholder="Select a planet"
                searchPlaceholder="Search planets or systems"
                emptyText="No planets match your search."
              />
            </label>

            <p className="helper-text">
              Systems and planets now come from the imported cluster seed. Choose a planet directly here and the system will follow automatically. Re-import your seed from Settings when the catalog changes.
            </p>
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

            {!currentPlanet && <p className="empty-state">Select a planet above before logging extraction sites.</p>}

            {currentPlanet && (
              <section className="entry-card entry-card-wide">
                <div className="entry-card-header">
                  <MachinePill label="ILS" variant="logistics" />
                  <h3>Raw export capacity</h3>
                </div>
                {renderPlanetExtractionIlsFields(currentPlanet, currentPlanetExtraction.resourceRows)}
              </section>
            )}

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
                        <span>Current req. nodes</span>
                        <strong>{formatCurrentWithPending(selectedOreRequiredNodes, pendingOreRequiredNodes)}</strong>
                      </div>
                      <div className="entry-stat">
                        <span>Target req. nodes</span>
                        <strong>{formatValue(selectedOreTargetRequiredNodes)}</strong>
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
                    <span>Oil per second at current mining speed</span>
                    <input
                      type="number"
                      min={0.1}
                      max={30}
                      step="any"
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
            <ProjectOverviewScreen
              projects={loadedData.projects}
              selectedProjectId={selectedProjectId}
              selectedProject={selectedProject}
              selectedProjectGoalRows={selectedProjectGoalRows}
              productionOverview={productionOverview}
              productionWarnings={productionWarnings}
              onSelectProject={setSelectedProjectId}
              formatValue={formatValue}
              formatFixedValue={formatFixedValue}
            />
          )}

          {activeView === "raw" && (
            <RawResourcesScreen
              solarSystems={loadedData.solarSystems}
              selectedOverviewResourceId={selectedOverviewResourceId}
              setSelectedOverviewResourceId={setSelectedOverviewResourceId}
              overviewView={overviewView}
              miningSpeedPercent={loadedData.settings.miningSpeedPercent}
              openOverviewTransportModal={openOverviewTransportModal}
              formatValue={formatValue}
              formatFixedValue={formatFixedValue}
              isTargetMet={isTargetMet}
              getProgressPercent={getProgressPercent}
              getSummaryTargetPerMinute={getSummaryTargetPerMinute}
              getRawCardPlanningLabel={getRawCardPlanningLabel}
              getBreakdownSecondaryText={getBreakdownSecondaryText}
            />
          )}

          <OverviewTransportModal
            isOpen={isOverviewTransportModalOpen}
            selectedOverviewSummary={selectedOverviewSummary}
            overviewView={overviewView}
            solarSystems={loadedData.solarSystems}
            overviewTransportTargetSystemId={overviewTransportTargetSystemId}
            setOverviewTransportTargetSystemId={(systemId) => {
              setOverviewTransportTargetSystemId(systemId);
              void updateSettings(getRecentSelectionSettings(loadedData.settings, { systemId }));
            }}
            recentSolarSystemId={loadedData.settings.recentSolarSystemId}
            overviewTransportThroughputPerMinute={overviewTransportThroughputPerMinute}
            setOverviewTransportThroughputPerMinute={setOverviewTransportThroughputPerMinute}
            closeOverviewTransportModal={closeOverviewTransportModal}
            formatValue={formatValue}
            formatFixedValue={formatFixedValue}
          />

                    {activeView === "production" && (
          <>
            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Production</p>
                  <h2>{selectedProject ? `${selectedProject.name} factory plan` : "Factory plan"}</h2>
                </div>
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
                    <span>{productionOverview.activeSiteCount} active</span>
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
                <div className="overview-detail-actions">
                  <button type="button" className="ghost-button" onClick={toggleExpandAllProductionRows}>
                    {allProductionRowsExpanded ? "Collapse all" : "Expand everything"}
                  </button>
                </div>
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
                      <span>
                        {selectedProductionMachinePlan && selectedProductionMachinePlan.machinesPerLine > 0
                          ? `${formatRoundedUpInteger(selectedProductionMachinePlan.machinesPerLine)} machines/line | `
                          : ""}
                        {formatRoundedUpInteger(selectedProductionMachinePlan?.totalMachineCount ?? selectedProductionSummary.plannedMachineCount)} machines total
                      </span>
                    </div>
                  {selectedProductionSummary.siteCount > 0 ? (
                    <button
                      type="button"
                      className="entry-stat production-setup-stat-button"
                      onClick={() => openProductionSetupEditor(selectedProductionSummary.itemKey)}
                    >
                      <span>Placed sites</span>
                      <strong>{getProductionSetupStatusLabel(selectedProductionSummary.activeSiteCount, selectedProductionSummary.siteCount)}</strong>
                      <span>{selectedProductionSummary.activeSiteCount === selectedProductionSummary.siteCount ? "all active" : "mixed active state"}</span>
                    </button>
                  ) : (
                    <div className="entry-stat">
                      <span>Placed sites</span>
                      <strong>No setups</strong>
                      <span>Use New production site to place one</span>
                    </div>
                  )}
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
                  {selectedProductionSiteViews.map((siteView) => {
                    const siteMachinePlan = getProductionSiteMachinePlan(siteView);

                    return (
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
                          <label className="toggle-field">
                            <input
                              type="checkbox"
                              checked={Number(siteView.site.is_finished) === 1}
                              onChange={(event) => void handleToggleProductionSiteActive(siteView.site.id, event.target.checked)}
                              disabled={busy}
                            />
                            <span>Active</span>
                          </label>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => openEditProductionSiteModal(siteView.site.id)}
                            disabled={busy}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => void confirmAndDelete(`/api/production-sites/${siteView.site.id}`, `${siteView.importedItem.display_name} site`)}
                            disabled={busy}
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      <div className="transport-route-stats">
                        <span><strong>{formatValue(siteView.site.throughput_per_minute)}</strong> / min</span>
                        <span>{formatRoundedUpInteger(siteMachinePlan.totalMachineCount)} machines</span>
                        <span>{formatFixedValue(siteView.outputBeltsPerLine * siteView.lineCount, 2)} output belts</span>
                        <span>{formatFixedValue(siteView.outboundIlsRequired, 2)} / {formatValue(siteView.site.outbound_ils_count)} outbound ILS</span>
                      </div>

                      <p className="helper-text">
                        {siteView.lineCount} lines | {formatRoundedUpInteger(siteMachinePlan.machinesPerLine)} machines/line | {formatFixedValue(siteView.outputBeltsPerLine, 2)} output belts/line
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
                                  <p>{formatValue(ingredient.requiredPerMinute)} / min required | {formatValue(ingredient.coveragePerMinute)} covered</p>
                                </div>
                              </div>
                              <div className="overview-breakdown-values">
                                <strong>{formatFixedValue(ingredient.beltsPerLine, 2)} belts/line</strong>
                                <span>{ingredient.targetIlsFraction === null ? "ILS n/a" : `${formatFixedValue(ingredient.targetIlsFraction, 2)} target ILS`}</span>
                              </div>
                            </div>
                            <p className="helper-text">
                              {ingredient.sourcesLabel}
                              {ingredient.shortagePerMinute > 0 ? ` | Missing ${formatValue(ingredient.shortagePerMinute)} / min.` : ""}
                              {ingredient.hasSourceIlsWarning ? " One or more source exporters need more source ILS than currently configured." : ""}
                            </p>
                          </article>
                        ))}
                      </div>

                      <p className="helper-text">
                        Mixed target ILS {siteView.mixedIlsFullStationCount + siteView.mixedIlsBins.length}
                        {siteView.mixedIlsBins.length > 0
                          ? ` | shared bins: ${siteView.mixedIlsBins.map((bin) => `[${bin.entries.map((item) => `${item.itemName} ${formatFixedValue(item.fraction, 2)}`).join(", ")}]`).join(" | ")}`
                          : ""}
                      </p>
                    </article>
                    );
                  })}
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
                      <p className="eyebrow">{productionModalEyebrow}</p>
                      <h2>{selectedProductionTemplate.display_name}</h2>
                      <p className="helper-text">Preview line count, inbound belts, and source coverage before saving this build.</p>
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
                    void handleSubmitProductionSite();
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
                      <label className="field production-modal-planet-field">
                        <span>Planet</span>
                        <PlanetPicker
                          systems={solidPlanetPickerSystems}
                          value={productionDraft.planetId}
                          onChange={handleProductionPlanetChange}
                          disabled={solidPlanetPickerSystems.length === 0}
                          recentSystemId={data.settings.recentSolarSystemId}
                          recentPlanetId={data.settings.recentPlanetId}
                          placeholder="Select planet"
                          searchPlaceholder="Search planets or systems"
                          emptyText="No planets match your search."
                        />
                      </label>
                    </div>

                    <label className="toggle-field">
                      <input
                        type="checkbox"
                        checked={productionDraft.isFinished}
                        onChange={(event) => setProductionDraft((current) => ({ ...current, isFinished: event.target.checked }))}
                      />
                      <span>Active setup</span>
                    </label>

                    {productionDraftPreview ? (
                      <>
                        <div className="production-line-plan">
                          <div className="production-line-plan-header">
                            <div className="production-line-plan-stat">
                              <span>Line plan</span>
                              <strong>{formatFixedValue(roundUpValue(productionDraftExactLineDemand ?? productionDraftPreview.lineCount, 1), 1)} lines</strong>
                              <span>
                                {formatRoundedUpInteger(productionDraftAverageMachinePlan?.machinesPerLine ?? productionDraftPreview.assemblersPerLine)} machines/line | {formatRoundedUpInteger(productionDraftMachinePlan?.totalMachineCount ?? productionDraftPreview.machineCount)} machines total
                              </span>
                            </div>
                            <div className="production-line-plan-stat">
                              <span>Estimated power</span>
                              <strong>{selectedProductionEstimatedPowerWatts > 0 ? formatPowerWatts(selectedProductionEstimatedPowerWatts) : "n/a"}</strong>
                              <span>
                                {selectedProductionProliferatorLevel > 0 ? `${selectedProductionModeLabel} | energy x${formatFixedValue(selectedProductionEnergyMultiplier, 2)}` : "No proliferator energy bonus"}
                                {selectedProductionEstimatedPowerWatts > 0 ? ` | ${formatFixedValue(selectedProductionEstimatedPowerWatts / 144_000_000, 2)} artificial stars` : ""}
                              </span>
                            </div>
                          </div>
                          <div className="production-line-plan-list">
                            <div className="production-line-plan-row production-line-plan-row-output">
                              <div className="production-line-plan-copy">
                                <ResourceIcon
                                  name={selectedProductionTemplate.display_name}
                                  iconUrl={getIconUrlForName(selectedProductionTemplate.display_name)}
                                  colorStart={productionIconStart}
                                  colorEnd={productionIconEnd}
                                  size="sm"
                                />
                                <div className="production-line-plan-copy-text">
                                  <strong>{selectedProductionTemplate.display_name}</strong>
                                  <span>{formatFixedValue(productionDraftPreview.outputBeltsPerLine, 2)} belts/line</span>
                                </div>
                              </div>
                              <span>{formatValue(productionDraftPreview.throughputPerMinute)} / min</span>
                              <span>Output</span>
                            </div>
                            {selectedProductionAdditionalOutputs.map((output) => (
                              <div
                                key={`line-output:${output.itemKey}`}
                                className="production-line-plan-row production-line-plan-row-output production-line-plan-row-output-secondary"
                              >
                                <div className="production-line-plan-copy">
                                  <ResourceIcon
                                    name={output.displayName}
                                    iconUrl={getIconUrlForName(output.displayName)}
                                    colorStart={productionIconStart}
                                    colorEnd={productionIconEnd}
                                    size="sm"
                                  />
                                  <div className="production-line-plan-copy-text">
                                    <strong>{output.displayName}</strong>
                                    <span>{formatFixedValue(output.beltsPerLine, 2)} belts/line</span>
                                  </div>
                                </div>
                                <span>{formatValue(output.throughputPerMinute)} / min</span>
                                <span>Byproduct</span>
                              </div>
                            ))}
                            {productionDraftPreview.dependencies.map((dependency) => (
                              <details key={`line:${dependency.dependency.item_key}`} className="production-line-plan-detail">
                                <summary className="production-line-plan-row production-line-plan-row-detail">
                                  <div className="production-line-plan-copy">
                                    <ResourceIcon
                                      name={dependency.dependency.display_name}
                                      iconUrl={getIconUrlForName(dependency.dependency.display_name)}
                                      colorStart={productionIconStart}
                                      colorEnd={productionIconEnd}
                                      size="sm"
                                    />
                                    <div className="production-line-plan-copy-text">
                                      <strong>{dependency.dependency.display_name}</strong>
                                      <span>{formatValue(dependency.requiredPerMinute)} / min | {formatFixedValue(dependency.beltsPerLine, 2)} belts/line</span>
                                    </div>
                                  </div>
                                  <div className="production-line-plan-values">
                                    <strong>{formatFixedValue(dependency.coveragePercent, 1)}%</strong>
                                    <span>
                                      {dependency.sources.length === 0 || dependency.targetIlsFraction === null
                                        ? "? receiver ILS"
                                        : `${formatFixedValue(dependency.targetIlsFraction, 2)} receiver ILS`}
                                    </span>
                                  </div>
                                </summary>
                                <div className="production-ingredient-body">
                                  {dependency.sources.some((source) => source.isLocalSystem) ? (
                                    <label className="toggle-field">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(productionDraft.sameSystemWarpItemKeys[dependency.dependency.item_key])}
                                        onChange={(event) =>
                                          setProductionDraft((current) => ({
                                            ...current,
                                            sameSystemWarpItemKeys: {
                                              ...current.sameSystemWarpItemKeys,
                                              [dependency.dependency.item_key]: event.target.checked,
                                            },
                                          }))
                                        }
                                      />
                                      <span>Use warp for same-system transport</span>
                                    </label>
                                  ) : null}
                                  <p className="helper-text">
                                    {dependency.sourcesLabel}
                                    {dependency.shortagePerMinute > 0 ? ` | Missing ${formatValue(dependency.shortagePerMinute)} / min.` : ""}
                                    {dependency.hasSourceIlsWarning ? " One or more source exporters need more source ILS than currently configured." : ""}
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
                                                <span>
                                                  {source.solarSystemName} | {source.producerName}
                                                  {source.distanceLy === null ? "" : ` | ${formatDistanceLy(source.distanceLy)} ly`}
                                                </span>
                                              </div>
                                            </div>
                                          <div className="overview-breakdown-values">
                                            <strong>{formatValue(source.throughputPerMinute)} / min</strong>
                                            <span>
                                              {source.isLocalPlanet
                                                ? "Local planet"
                                                  : source.isLocalSystem
                                                    ? `${source.sameSystemTransportMode === "warp" ? "Same system warp" : "Same system cruise"} | Source ILS ${source.sourceStationsNeeded === null ? "?" : formatFixedValue(source.sourceStationsNeeded, 2)}`
                                                    : `Source ILS ${source.sourceStationsNeeded === null ? "?" : formatFixedValue(source.sourceStationsNeeded, 2)}`}
                                              </span>
                                            </div>
                                          </div>
                                          {source.hasSourceIlsWarning ? (
                                            <p className="helper-text">This source is still allocated, but it needs more source ILS than is currently configured.</p>
                                          ) : null}
                                        </article>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </details>
                            ))}
                          </div>
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
                        <span>{selectedProductionReference?.recipeName || selectedProductionTemplate.recipe || "Imported"}</span>
                      </div>
                      <div className="production-machine-pill production-machine-pill-static">
                        <ResourceIcon
                          name={selectedProductionReference?.machineDisplayName || selectedProductionTemplate.machine_label || "Factory"}
                          iconUrl={getIconUrlForName(selectedProductionTemplate.machine_label || "Factory")}
                          colorStart="#99c9ff"
                          colorEnd="#5578b5"
                          size="sm"
                        />
                        {selectedProductionReference?.machineDisplayName || selectedProductionTemplate.machine_label || "Imported machine"}
                      </div>
                      <div className="production-recipe-card">
                        <div className="production-recipe-summary">
                          <div className="production-recipe-stat">
                            <span>Base cycle</span>
                            <strong>{selectedProductionBaseCycleSeconds === null ? "n/a" : `${formatFixedValue(selectedProductionBaseCycleSeconds, 2)} s`}</strong>
                          </div>
                          <div className="production-recipe-stat">
                            <span>Cycle adjusted</span>
                            <strong>{selectedProductionAdjustedCycleSeconds === null ? "n/a" : `${formatFixedValue(selectedProductionAdjustedCycleSeconds, 2)} s`}</strong>
                          </div>
                        </div>
                        <p className="helper-text">
                          {selectedProductionModeLabel}
                        </p>

                        {selectedProductionRecipeInputs.length > 0 ? (
                          <div className="production-recipe-io">
                            <span className="production-recipe-label">Inputs</span>
                            <div className="production-recipe-entry-list">
                              {selectedProductionRecipeInputs.map((entry) => (
                                <div key={`input:${entry.itemKey}`} className="production-recipe-entry">
                                  <ResourceIcon
                                    name={entry.displayName}
                                    iconUrl={getIconUrlForName(entry.displayName)}
                                    colorStart={productionIconStart}
                                    colorEnd={productionIconEnd}
                                    size="sm"
                                  />
                                  <div className="production-recipe-entry-copy">
                                    <strong>{entry.displayName}</strong>
                                    <span>{formatValue(entry.quantity)}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {selectedProductionRecipeOutputs.length > 0 ? (
                          <div className="production-recipe-io">
                            <span className="production-recipe-label">Outputs</span>
                            <div className="production-recipe-entry-list">
                              {selectedProductionRecipeOutputs.map((entry) => (
                                <div key={`output:${entry.itemKey}`} className="production-recipe-entry">
                                  <ResourceIcon
                                    name={entry.displayName}
                                    iconUrl={getIconUrlForName(entry.displayName)}
                                    colorStart={productionIconStart}
                                    colorEnd={productionIconEnd}
                                    size="sm"
                                  />
                                  <div className="production-recipe-entry-copy">
                                    <strong>{entry.displayName}</strong>
                                    <span>
                                      {formatValue(entry.quantity)}
                                      {selectedProductionProliferatorUsage?.mode === "extra-products" && selectedProductionProliferatorUsage.outputMultiplier > 1 ? (
                                        <span className="production-recipe-bonus"> +{formatValue(entry.quantity * (selectedProductionProliferatorUsage.outputMultiplier - 1), 2)}</span>
                                      ) : null}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <button type="submit" className="primary-button full-width" disabled={!canSubmitProductionSite}>
                      {productionModalSubmitLabel}
                    </button>
                  </div>
                </form>
              </section>
            </div>
          )}
          {productionSetupPickerItemKey ? (
            <div className="modal-backdrop" onClick={closeProductionSetupPicker}>
              <section className="modal-card production-setup-picker-modal" onClick={(event) => event.stopPropagation()}>
                <div className="overview-card-header">
                  <div>
                    <p className="eyebrow">Choose setup</p>
                    <h2>{productionSetupPickerSummary?.displayName ?? "Production setups"}</h2>
                  </div>
                  <button type="button" className="ghost-button" onClick={closeProductionSetupPicker}>
                    Close
                  </button>
                </div>
                <p className="helper-text">Select the setup you want to edit.</p>
                <div className="production-setup-picker-list">
                  {productionSetupPickerSiteViews.map((siteView) => {
                    const siteMachinePlan = getProductionSiteMachinePlan(siteView);
                    return (
                      <button
                        key={siteView.site.id}
                        type="button"
                        className="production-setup-picker-row"
                        onClick={() => openEditProductionSiteModal(siteView.site.id)}
                      >
                        <div className="production-setup-picker-copy">
                          <strong>{siteView.solarSystemName} | {siteView.planetName}</strong>
                          <span>{formatValue(siteView.site.throughput_per_minute)} / min</span>
                        </div>
                        <div className="production-setup-picker-stats">
                          <span>{formatRoundedUpInteger(siteMachinePlan.totalMachineCount)} machines</span>
                          <span>{siteView.lineCount} lines</span>
                          <span>{Number(siteView.site.is_finished) === 1 ? "Active" : "Planned"}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
          ) : null}

          {activeView === "map" && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Star Map</p>
                <h2>Systems and planets</h2>
              </div>
              <span className="helper-text">Select a seed-generated system or planet to inspect extraction coverage.</span>
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
                        onClick={() => {
                          setSelectedMapSelection({ scope: "system", id: solarSystem.id });
                          void updateSettings(getRecentSelectionSettings(loadedData.settings, { systemId: solarSystem.id }));
                        }}
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
                            const showMissingIlsWarning =
                              planet.id === data.settings.currentPlanetId &&
                              isPlanetMissingExtractionIlsCoverage(loadedData, planet);

                            return (
                              <button
                                key={planet.id}
                                type="button"
                                className={`map-planet-button ${isPlanetSelected ? "map-planet-button-active" : ""}`}
                                onClick={() => {
                                  setSelectedMapSelection({ scope: "planet", id: planet.id });
                                  void updateSettings(
                                    getRecentSelectionSettings(loadedData.settings, {
                                      systemId: planet.solar_system_id,
                                      planetId: planet.id,
                                    }),
                                  );
                                }}
                              >
                                <div className="map-planet-copy">
                                  <strong>{planet.name}</strong>
                                  <span>
                                    {planet.planet_type === "gas_giant" ? "Gas giant" : "Solid planet"} | {siteCount} sites
                                  </span>
                                </div>
                                {showMissingIlsWarning ? <span className="resource-badge resource-badge-warning">Missing ILS</span> : null}
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
              <p className="empty-state">Import a cluster seed from Settings to generate your star map.</p>
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
                          const coveredNodes = getOreVeinCoveredNodes(miners);
                          const throughputPerMinute = getOreVeinOutputPerMinute(miners, data.settings.miningSpeedPercent);

                          return (
                            <article key={vein.id} className="ledger-item">
                              <div>
                                <h3>{getResourceName(data.resources, vein.resource_id)}</h3>
                                <p>{miners.length} {miners.length === 1 ? "miner" : "miners"} | {formatValue(coveredNodes)} nodes covered | {formatValue(throughputPerMinute)} ore/min</p>
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
                          const oilPerSecondActual = getOilOutputPerSecond(site.oil_per_second, data.settings.miningSpeedPercent);
                          return (
                            <article key={site.id} className="ledger-item">
                              <div>
                                <h3>{getResourceName(data.resources, site.resource_id)}</h3>
                                <p>{formatValue(oilPerSecondActual * 60)} / min</p>
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
                      <span>Total power demand</span>
                      <strong>
                        {formatFixedValue(selectedMapTotalPowerDemandMw / 1_000, 2)} GW · {formatArtificialStarsNeeded(selectedMapTotalPowerDemandMw)}
                      </strong>
                    </article>
                  </div>

                  <div className="divider" />

                  {selectedMapSystem && (
                    <p className="helper-text">
                      System names are locked to the imported seed. Re-import the cluster address in Settings if the catalog needs to be refreshed.
                    </p>
                  )}

                  {selectedMapPlanet && (
                    <>
                      <p className="helper-text">
                        Planet names and types come from the imported seed. Re-import the cluster address in Settings if the generated catalog looks out of date.
                      </p>

                      <div className="divider" />

                      {selectedMapPlanet.planet_type === "solid"
                        ? renderPlanetExtractionIlsFields(selectedMapPlanet, selectedMapExtraction.resourceRows)
                        : null}
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

          {activeView === "settings" && (
          <SettingsScreen
            busy={busy}
            clusterAddressDraft={clusterAddressDraft}
            clusterHelperText={clusterAddressHelperText}
            canImportCluster={Boolean(parsedClusterAddress)}
            onClusterAddressChange={setClusterAddressDraft}
            onImportCluster={() => void handleImportClusterAddress()}
            miningSpeedPercent={loadedData.settings.miningSpeedPercent}
            onMiningSpeedChange={(value) =>
              void updateSettings({
                miningSpeedPercent: value,
              })
            }
            onMiningSpeedIncrement={() =>
              void updateSettings({
                miningSpeedPercent: loadedData.settings.miningSpeedPercent + 10,
              })
            }
            vesselCapacityItems={loadedData.settings.vesselCapacityItems}
            onVesselCapacityChange={(value) =>
              void updateSettings({
                vesselCapacityItems: value,
              })
            }
            onVesselCapacityIncrement={() =>
              void updateSettings({
                vesselCapacityItems: loadedData.settings.vesselCapacityItems + 200,
              })
            }
            ilsStorageItems={loadedData.settings.ilsStorageItems}
            onIlsStorageChange={(value) =>
              void updateSettings({
                ilsStorageItems: value,
              })
            }
            onIlsStorageIncrement={() =>
              void updateSettings({
                ilsStorageItems: loadedData.settings.ilsStorageItems + 2000,
              })
            }
            vesselSpeedLyPerSecond={loadedData.settings.vesselSpeedLyPerSecond}
            onVesselSpeedChange={(value) =>
              void updateSettings({
                vesselSpeedLyPerSecond: value,
              })
            }
            vesselCruisingSpeedMetersPerSecond={loadedData.settings.vesselCruisingSpeedMetersPerSecond}
            onVesselCruisingSpeedChange={(value) =>
              void updateSettings({
                vesselCruisingSpeedMetersPerSecond: value,
              })
            }
            vesselDockingSeconds={loadedData.settings.vesselDockingSeconds}
            onVesselDockingSecondsChange={(value) =>
              void updateSettings({
                vesselDockingSeconds: value,
              })
            }
            quickCalcDistanceLy={quickCalcDistanceLy}
            onQuickCalcDistanceChange={setQuickCalcDistanceLy}
            quickCalcThroughputPerMinute={quickCalcThroughputPerMinute}
            onQuickCalcThroughputChange={setQuickCalcThroughputPerMinute}
            quickCalcRoundTripLabel={quickCalcRoundTripLabel}
            quickCalcPerVesselLabel={quickCalcPerVesselLabel}
            quickCalcRequiredIlsLabel={quickCalcRequiredIlsLabel}
            quickCalcTargetIlsLabel={quickCalcTargetIlsLabel}
            newResourceName={newResourceName}
            onNewResourceNameChange={setNewResourceName}
            newResourceType={newResourceType}
            onNewResourceTypeChange={setNewResourceType}
            canCreateResource={newResourceName.trim().length > 0}
            onCreateResource={() =>
              void execute(
                {
                  type: "resource/create",
                  name: newResourceName,
                  resourceType: newResourceType,
                },
                () => {
                  setNewResourceName("");
                },
              )
            }
            onExport={() => void handleExport()}
            onImport={(file) => void handleImport(file)}
          />
          )}


          {activeView === "projects" && (
          <ProjectsScreen
            busy={busy}
            projects={data.projects}
            selectedProjectId={selectedProjectId}
            selectedProject={selectedProject}
            projectNameDraft={projectNameDraft}
            projectNotesDraft={projectNotesDraft}
            projectActiveDraft={projectActiveDraft}
            goalDrafts={goalDrafts}
            goalInputRows={projectGoalInputRows}
            newProjectName={newProjectName}
            newProjectNotes={newProjectNotes}
            onSelectProject={setSelectedProjectId}
            onProjectNameChange={setProjectNameDraft}
            onProjectNotesChange={setProjectNotesDraft}
            onProjectActiveChange={setProjectActiveDraft}
            onGoalChange={(resourceId, value) =>
              setGoalDrafts((current) => ({
                ...current,
                [resourceId]: value,
              }))
            }
            onSaveProject={() => void handleSaveProject()}
            onExistingProjectCsvImport={(file) => void handleExistingProjectCsvImport(file)}
            onNewProjectNameChange={setNewProjectName}
            onNewProjectNotesChange={setNewProjectNotes}
            onCreateProject={() => void handleCreateProject()}
            onProjectCsvImport={(file) => void handleProjectCsvImport(file)}
          />
          )}

        </aside>
        )}
      </section>
    </main>
  );
}

export { Workspace, WorkspaceShell };
export default WorkspaceShell;
