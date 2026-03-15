import { startTransition, useEffect, useState } from "react";
import "./App.css";
import { ResourceIcon } from "./components/ResourceIcon";
import { deleteBootstrap, exportSnapshot, getBootstrap, importSnapshot, patchBootstrap, postBootstrap, putBootstrap } from "./lib/api";
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
  const [oreLabel, setOreLabel] = useState("");
  const [oreMiners, setOreMiners] = useState<MinerDraft[]>([
    { minerType: "advanced", coveredNodes: 15, advancedSpeedPercent: 100 },
  ]);

  const [liquidResourceId, setLiquidResourceId] = useState("");
  const [liquidLabel, setLiquidLabel] = useState("");
  const [pumpCount, setPumpCount] = useState(1);

  const [oilResourceId, setOilResourceId] = useState("");
  const [oilLabel, setOilLabel] = useState("");
  const [oilPerSecond, setOilPerSecond] = useState(2.5);

  const [gasLabel, setGasLabel] = useState("");
  const [collectorCount, setCollectorCount] = useState(40);
  const [gasOutputs, setGasOutputs] = useState<GasOutputDraft[]>([{ resourceId: "", ratePerSecond: 1 }]);

  async function refreshBootstrap() {
    setLoading(true);

    try {
      const nextData = await getBootstrap();
      startTransition(() => {
        setData(nextData);
      });
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
    startTransition(() => {
      setData(nextData);
    });
  }

  if (loading || !data) {
    return (
      <main className="shell loading-shell">
        <section className="panel hero-panel">
          <p className="eyebrow">Dyson Sphere Program</p>
          <h1>Loading the extraction ledger…</h1>
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

  const oreVeinsOnPlanet = loadedData.oreVeins.filter((vein) => vein.planet_id === currentPlanet?.id);
  const liquidSitesOnPlanet = loadedData.liquidSites.filter((site) => site.planet_id === currentPlanet?.id);
  const oilExtractorsOnPlanet = loadedData.oilExtractors.filter((site) => site.planet_id === currentPlanet?.id);
  const gasSitesOnPlanet = loadedData.gasGiantSites.filter((site) => site.planet_id === currentPlanet?.id);

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

  async function updateSettings(payload: Partial<BootstrapData["settings"]>) {
    await mutate(() => patchBootstrap("/api/settings", payload), applyBootstrap);
  }

  async function handleSaveProject() {
    if (!selectedProject) {
      return;
    }

    await mutate(async () => {
      await patchBootstrap(`/api/projects/${selectedProject.id}`, {
        name: projectNameDraft,
        notes: projectNotesDraft,
        isActive: projectActiveDraft,
      });

      return putBootstrap(`/api/projects/${selectedProject.id}/goals`, {
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
          label: oreLabel,
          miners: oreMiners.map((miner) => ({
            minerType: miner.minerType,
            coveredNodes: Number(miner.coveredNodes),
            advancedSpeedPercent: miner.minerType === "advanced" ? Number(miner.advancedSpeedPercent) : undefined,
          })),
        }),
      (nextData) => {
        applyBootstrap(nextData);
        setOreLabel("");
        setOreMiners([{ minerType: "advanced", coveredNodes: 15, advancedSpeedPercent: 100 }]);
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
          label: liquidLabel,
          pumpCount: Number(pumpCount),
        }),
      (nextData) => {
        applyBootstrap(nextData);
        setLiquidLabel("");
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
          label: oilLabel,
          oilPerSecond: Number(oilPerSecond),
        }),
      (nextData) => {
        applyBootstrap(nextData);
        setOilLabel("");
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
          label: gasLabel,
          collectorCount: Number(collectorCount),
          outputs: gasOutputs.map((output) => ({
            resourceId: output.resourceId,
            ratePerSecond: Number(output.ratePerSecond),
          })),
        }),
      (nextData) => {
        applyBootstrap(nextData);
        setGasLabel("");
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
      <section className="hero-banner">
        <div>
          <p className="eyebrow">Dyson Sphere Program</p>
          <h1>Resource Sheet</h1>
          <p className="hero-copy">
            Track every vein, pump, orbital collector, and oil extractor across your interstellar logistics network.
          </p>
        </div>
        <div className="hero-stats">
          <article className="hero-stat">
            <strong>{data.summary.activeProjectCount}</strong>
            <span>active projects</span>
          </article>
          <article className="hero-stat">
            <strong>{data.summary.planetCount}</strong>
            <span>tracked planets</span>
          </article>
          <article className="hero-stat">
            <strong>{data.summary.solarSystemCount}</strong>
            <span>solar systems</span>
          </article>
        </div>
      </section>

      {(error || notice) && (
        <section className="message-row">
          {error && <div className="message error-message">{error}</div>}
          {notice && <div className="message notice-message">{notice}</div>}
        </section>
      )}

      <section className="grid-layout">
        <div className="main-column">
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
                    <MachinePill label="ADV / MIN" variant="advanced" />
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
                  <label className="field">
                    <span>Label</span>
                    <input value={oreLabel} onChange={(event) => setOreLabel(event.target.value)} placeholder="North ridge vein" />
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

                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => setOreMiners((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                              disabled={oreMiners.length === 1}
                            >
                              Remove
                            </button>
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
                              max={miner.minerType === "advanced" ? 30 : 10}
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
                    <span>Label</span>
                    <input value={liquidLabel} onChange={(event) => setLiquidLabel(event.target.value)} placeholder="South coast" />
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
                    <span>Label</span>
                    <input value={oilLabel} onChange={(event) => setOilLabel(event.target.value)} placeholder="Shale basin" />
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
                    <span>Label</span>
                    <input value={gasLabel} onChange={(event) => setGasLabel(event.target.value)} placeholder="Equatorial ring" />
                  </label>
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

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Live Totals</p>
                <h2>Combined resource progress</h2>
              </div>
            </div>
            <div className="resource-grid">
              {data.summary.resourceSummaries.map((summary) => (
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
                    {summary.fuelValueMj ? <span className="resource-badge">{formatValue(summary.fuelValueMj)} MJ</span> : null}
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

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Planet Ledger</p>
                <h2>{currentPlanet ? `${currentPlanet.name} extraction` : "Select a planet"}</h2>
              </div>
            </div>

            {!currentPlanet && <p className="empty-state">Pick a planet to review the sites you have already logged.</p>}

            {currentPlanet && (
              <div className="ledger-stack">
                {oreVeinsOnPlanet.map((vein) => {
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
                        <p>
                          {vein.label || "Unnamed vein"} · {miners.length} miner rows · {formatValue(throughputPerMinute)} ore/min
                        </p>
                      </div>
                      <button type="button" className="ghost-button" onClick={() => void mutate(() => deleteBootstrap(`/api/ore-veins/${vein.id}`), applyBootstrap)}>
                        Delete
                      </button>
                    </article>
                  );
                })}

                {liquidSitesOnPlanet.map((site) => (
                  <article key={site.id} className="ledger-item">
                    <div>
                      <h3>{getResourceName(data.resources, site.resource_id)}</h3>
                      <p>
                        {site.label || "Unnamed pump site"} · {site.pump_count} pumps
                      </p>
                    </div>
                    <button type="button" className="ghost-button" onClick={() => void mutate(() => deleteBootstrap(`/api/liquids/${site.id}`), applyBootstrap)}>
                      Delete
                    </button>
                  </article>
                ))}

                {oilExtractorsOnPlanet.map((site: OilExtractor) => (
                  <article key={site.id} className="ledger-item">
                    <div>
                      <h3>{getResourceName(data.resources, site.resource_id)}</h3>
                      <p>
                        {site.label || "Unnamed extractor"} · {formatValue(site.oil_per_second)} / sec · {formatValue(site.oil_per_second * 60)} / min
                      </p>
                    </div>
                    <button type="button" className="ghost-button" onClick={() => void mutate(() => deleteBootstrap(`/api/oil-extractors/${site.id}`), applyBootstrap)}>
                      Delete
                    </button>
                  </article>
                ))}

                {gasSitesOnPlanet.map((site: GasGiantSite) => {
                  const outputs = gasOutputLookup[site.id] ?? [];
                  const detail = outputs
                    .map((output) => `${getResourceName(data.resources, output.resource_id)} ${formatValue(output.rate_per_second * site.collector_count * 8 * (1 + data.settings.miningResearchBonusPercent / 100))}/sec`)
                    .join(" · ");

                  return (
                    <article key={site.id} className="ledger-item">
                      <div>
                        <h3>{site.label || "Unnamed collector ring"}</h3>
                        <p>
                          {site.collector_count} collectors · {detail}
                        </p>
                      </div>
                      <button type="button" className="ghost-button" onClick={() => void mutate(() => deleteBootstrap(`/api/gas-giants/${site.id}`), applyBootstrap)}>
                        Delete
                      </button>
                    </article>
                  );
                })}

                {oreVeinsOnPlanet.length === 0 &&
                  liquidSitesOnPlanet.length === 0 &&
                  oilExtractorsOnPlanet.length === 0 &&
                  gasSitesOnPlanet.length === 0 && <p className="empty-state">No extraction sites logged on this planet yet.</p>}
              </div>
            )}
          </section>
        </div>

        <aside className="sidebar-column">
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
        </aside>
      </section>
    </main>
  );
}

export default App;
