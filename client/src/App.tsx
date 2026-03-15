import { useEffect, useState } from "react";
import "./App.css";
import { ResourceIcon } from "./components/ResourceIcon";
import { deleteBootstrap, exportSnapshot, getBootstrap, importSnapshot, patchBootstrap, postBootstrap } from "./lib/api";
import type {
  BootstrapData,
  GasGiantOutput,
  GasGiantSite,
  MinerType,
  OilExtractor,
  OreVeinMiner,
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
  const [showAllLedger, setShowAllLedger] = useState(false);
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

  const [oreResourceId, setOreResourceId] = useState("");
  const [oreMiners, setOreMiners] = useState<MinerDraft[]>([
    { minerType: "advanced", coveredNodes: 15, advancedSpeedPercent: 100 },
  ]);

  const [liquidResourceId, setLiquidResourceId] = useState("");
  const [pumpCount, setPumpCount] = useState(1);

  const [oilResourceId, setOilResourceId] = useState("");
  const [oilPerSecond, setOilPerSecond] = useState(2.5);

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

  const planetLookup = new Map(loadedData.planets.map((planet) => [planet.id, planet]));
  const systemLookup = new Map(loadedData.solarSystems.map((solarSystem) => [solarSystem.id, solarSystem]));

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

      return {
        planet,
        systemName,
        latestActivityAt: items[0]?.createdAt ?? "",
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
        setPumpCount(1);
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
        setOilPerSecond(2.5);
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
                    const nextPlanet = data.planets.find(
                      (planet) => planet.id === data.settings.currentPlanetId && planet.solar_system_id === nextSystemId,
                    );
                    void updateSettings({
                      currentSolarSystemId: nextSystemId,
                      currentPlanetId: nextPlanet?.id ?? null,
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
                      {planet.name} · {planet.planet_type === "gas_giant" ? "Gas Giant" : "Solid"}
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
                  <select value={newPlanetType} onChange={(event) => setNewPlanetType(event.target.value as "solid" | "gas_giant")}>
                    <option value="solid">Solid</option>
                    <option value="gas_giant">Gas giant</option>
                  </select>
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
                {currentPlanet ? `${currentPlanet.name} · ${currentPlanet.planet_type === "gas_giant" ? "Gas giant" : "Solid planet"}` : "No planet selected"}
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
                  <label className="field">
                    <span>Resource</span>
                    <select value={oreResourceId} onChange={(event) => setOreResourceId(event.target.value)}>
                      {oreResources.map((resource) => (
                        <option key={resource.id} value={resource.id}>
                          {resource.name}
                        </option>
                      ))}
                    </select>
                  </label>
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

                  <div className="action-row">
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
                    <select value={liquidResourceId} onChange={(event) => setLiquidResourceId(event.target.value)}>
                      {liquidResources.map((resource) => (
                        <option key={resource.id} value={resource.id}>
                          {resource.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Pumps</span>
                    <input type="number" min={1} value={pumpCount} onChange={(event) => setPumpCount(Number(event.target.value))} />
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
                    <select value={oilResourceId} onChange={(event) => setOilResourceId(event.target.value)}>
                      {oilResources.map((resource) => (
                        <option key={resource.id} value={resource.id}>
                          {resource.name}
                        </option>
                      ))}
                    </select>
                  </label>
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

                <p className="helper-text">Each orbital collector produces the configured rate × 8, then the mining research bonus is applied.</p>

                <div className="gas-output-stack">
                  {gasOutputs.map((output, index) => (
                    <div key={`${output.resourceId}-${index}`} className="gas-output-row">
                      <label className="field">
                        <span>Output resource</span>
                        <select
                          value={output.resourceId}
                          onChange={(event) =>
                            setGasOutputs((current) =>
                              current.map((entry, currentIndex) =>
                                currentIndex === index ? { ...entry, resourceId: event.target.value } : entry,
                              ),
                            )
                          }
                        >
                          {gasResources.map((resource) => (
                            <option key={resource.id} value={resource.id}>
                              {resource.name}
                            </option>
                          ))}
                        </select>
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

                <div className="action-row">
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
                    <span className={`resource-status ${summary.supplyMetric >= summary.goalQuantity ? "resource-status-done" : "resource-status-pending"}`}>
                      {summary.supplyMetric >= summary.goalQuantity ? "Goal met" : "In progress"}
                    </span>
                  </div>

                  <div className="metric-line">
                    <strong>{formatValue(summary.supplyMetric)}</strong>
                    <span>/ {summary.goalQuantity > 0 ? formatValue(summary.goalQuantity) : "no target"}</span>
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

          {activeView === "overview" && (
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
                      <div>
                        <h3>{group.planet.name}</h3>
                        <p>{group.systemName} · {group.planet.planet_type === "gas_giant" ? "Gas giant" : "Solid planet"}</p>
                      </div>
                    </div>

                    <div className="ledger-stack">
                      {group.items.map((item) => {
                        if (item.kind === "ore") {
                          const vein = item.data;
                          const miners = oreMinerLookup[vein.id] ?? [];
                          const throughputPerMinute = miners.reduce((sum, miner) => {
                            const baseRate = miner.miner_type === "advanced" ? 60 : 30;
                            const speed = miner.miner_type === "advanced" ? Number(miner.advanced_speed_percent ?? 100) / 100 : 1;
                            const research = 1 + data.settings.miningResearchBonusPercent / 100;
                            return sum + Number(miner.covered_nodes) * baseRate * speed * research;
                          }, 0);

                          return (
                            <article key={vein.id} className="ledger-item">
                              <div>
                                <h3>{getResourceName(data.resources, vein.resource_id)}</h3>
                                <p>{miners.length} miners · {formatValue(throughputPerMinute)} ore/min · {formatValue(throughputPerMinute / 30)} node equivalents</p>
                              </div>
                              <button type="button" className="ghost-button" onClick={() => void mutate(() => deleteBootstrap(`/api/ore-veins/${vein.id}`), applyBootstrap)}>
                                Delete
                              </button>
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
                              </div>
                              <button type="button" className="ghost-button" onClick={() => void mutate(() => deleteBootstrap(`/api/liquids/${site.id}`), applyBootstrap)}>
                                Delete
                              </button>
                            </article>
                          );
                        }

                        if (item.kind === "oil") {
                          const site = item.data as OilExtractor;
                          return (
                            <article key={site.id} className="ledger-item">
                              <div>
                                <h3>{getResourceName(data.resources, site.resource_id)}</h3>
                                <p>{formatValue(site.oil_per_second)} / sec · {formatValue(site.oil_per_second * 60)} / min</p>
                              </div>
                              <button type="button" className="ghost-button" onClick={() => void mutate(() => deleteBootstrap(`/api/oil-extractors/${site.id}`), applyBootstrap)}>
                                Delete
                              </button>
                            </article>
                          );
                        }

                        const site = item.data as GasGiantSite;
                        const outputs = gasOutputLookup[site.id] ?? [];
                        const detail = outputs
                          .map((output) => `${getResourceName(data.resources, output.resource_id)} ${formatValue(output.rate_per_second * site.collector_count * 8 * (1 + data.settings.miningResearchBonusPercent / 100) * 60)}/min`)
                          .join(" · ");

                        return (
                          <article key={site.id} className="ledger-item">
                            <div>
                              <h3>Collector ring</h3>
                              <p>{site.collector_count} collectors · {detail}</p>
                            </div>
                            <button type="button" className="ghost-button" onClick={() => void mutate(() => deleteBootstrap(`/api/gas-giants/${site.id}`), applyBootstrap)}>
                              Delete
                            </button>
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
