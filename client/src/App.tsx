import { useEffect, useState } from "react";
import "./App.css";
import { ResourceIcon } from "./components/ResourceIcon";
import { ResourceSelect } from "./components/ResourceSelect";
import { deleteBootstrap, exportSnapshot, getBootstrap, importSnapshot, patchBootstrap, postBootstrap } from "./lib/api";
import {
  getAdvancedMinerOutputPerMinute,
  getAdvancedMinerPowerMw,
  getOilOutputPerSecond,
  getOrbitalCollectorTrueBoost,
  getRegularMinerOutputPerMinute,
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

function formatValue(value: number, digits = 1) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: value % 1 === 0 ? 0 : digits,
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
  if (summary.goalQuantity <= 0) {
    return 0;
  }

  return Math.min(100, (summary.supplyMetric / summary.goalQuantity) * 100);
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
  const [activeView, setActiveView] = useState<"log" | "overview" | "projects" | "settings">("log");
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
    setGoalDrafts(toProjectGoalMap(data.projectGoals, selectedProjectId));
  }, [data, selectedProjectId]);

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
  const planetLookup = new Map(loadedData.planets.map((planet) => [planet.id, planet]));
  const systemLookup = new Map(loadedData.solarSystems.map((solarSystem) => [solarSystem.id, solarSystem]));
  const latestPlanetActivity = getLatestPlanetActivity(loadedData);
  const selectedOreSummary = loadedData.summary.resourceSummaries.find((summary) => summary.resourceId === oreResourceId) ?? null;
  const selectedLiquidSummary = loadedData.summary.resourceSummaries.find((summary) => summary.resourceId === liquidResourceId) ?? null;
  const selectedOilSummary = loadedData.summary.resourceSummaries.find((summary) => summary.resourceId === oilResourceId) ?? null;
  const pendingOreNodeEquivalents = getDraftOreOutputPerMinute(oreMiners, loadedData.settings.miningResearchBonusPercent) / 30;
  const pendingLiquidPumps = pumpCount;
  const pendingOilPerMinute = getOilOutputPerSecond(oilPerSecond) * 60;

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

  function startLocationEdit(entryKey: string, planetId: string) {
    const planet = planetLookup.get(planetId);
    setEditingEntryKey(entryKey);
    setEntryLocationDraft({
      systemId: planet?.solar_system_id ?? "",
      planetId,
    });
  }

  function cancelLocationEdit() {
    setEditingEntryKey("");
    setEntryLocationDraft({ systemId: "", planetId: "" });
  }

  async function saveLocationEdit(path: string) {
    if (!entryLocationDraft.planetId) {
      return;
    }

    await mutate(() => patchBootstrap(path, { planetId: entryLocationDraft.planetId }), (nextData) => {
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
          <button type="button" className="primary-button" onClick={() => void saveLocationEdit(path)} disabled={busy || !entryLocationDraft.planetId}>
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
          ["projects", "Projects"],
          ["settings", "Settings"],
        ].map(([viewKey, label]) => (
          <button
            key={viewKey}
            type="button"
            className={`view-tab ${activeView === viewKey ? "view-tab-active" : ""}`}
            onClick={() => setActiveView(viewKey as "log" | "overview" | "projects" | "settings")}
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
                        name: newPlanetName,
                        planetType: newPlanetType,
                      }),
                    (nextData) => {
                      applyBootstrap(nextData);
                      setNewPlanetName("");
                    },
                  );
                }}
              >
                <label className="field">
                  <span>Add planet</span>
                  <input value={newPlanetName} onChange={(event) => setNewPlanetName(event.target.value)} placeholder="Arden II" />
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
                        <strong>{formatCurrentWithPending(selectedLiquidSummary.supplyMetric, pendingLiquidPumps)}</strong>
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
                          step={0.1}
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
            <div className="resource-grid">
              {data.summary.resourceSummaries.filter((summary) => summary.goalQuantity > 0).map((summary) => (
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
                                <button type="button" className="ghost-button" onClick={() => startLocationEdit(`ore:${vein.id}`, vein.planet_id)}>
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
                                <button type="button" className="ghost-button" onClick={() => startLocationEdit(`liquid:${site.id}`, site.planet_id)}>
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
                                <button type="button" className="ghost-button" onClick={() => startLocationEdit(`oil:${site.id}`, site.planet_id)}>
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
                              <button type="button" className="ghost-button" onClick={() => startLocationEdit(`gas:${site.id}`, site.planet_id)}>
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
              <span className="helper-text">Applied to ore miners and orbital collectors.</span>
            </div>
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
