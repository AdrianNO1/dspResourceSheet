import {
  getAdvancedMinerOutputPerMinute,
  getOilOutputPerSecond,
  getOrbitalCollectorTrueBoost,
  getPumpOutputPerMinute,
  getRegularMinerOutputPerMinute,
} from "./dspMath";
import { generateClusterCatalog, generateClusterSystems, parseClusterAddress } from "./dspCluster";
import { getCanonicalImportedItemDependencies } from "./factoriolabCatalog";
import type {
  BootstrapData,
  GasGiantOutput,
  GasGiantSite,
  LiquidSite,
  MinerType,
  OilExtractor,
  OreVein,
  OreVeinMiner,
  Planet,
  PlanetExtractionIlsOverride,
  PlanetType,
  Project,
  ProjectGoal,
  ProjectImportedItem,
  ProductionSite,
  ResourceDefinition,
  ResourceSummary,
  ResourceType,
  SolarSystem,
  SystemDistance,
  TransportRoute,
} from "./types";

export type StoredSnapshot = {
  resources: ResourceDefinition[];
  solarSystems: SolarSystem[];
  systemDistances: SystemDistance[];
  planets: Planet[];
  projects: Project[];
  projectGoals: ProjectGoal[];
  projectImportedItems: ProjectImportedItem[];
  oreVeins: OreVein[];
  oreVeinMiners: OreVeinMiner[];
  liquidSites: LiquidSite[];
  oilExtractors: OilExtractor[];
  gasGiantSites: GasGiantSite[];
  gasGiantOutputs: GasGiantOutput[];
  productionSites: ProductionSite[];
  transportRoutes: TransportRoute[];
  settings: Record<string, string>;
};

type Snapshot = StoredSnapshot;

type ResourceSeed = {
  id: string;
  name: string;
  type: ResourceType;
  sort_order: number;
  color_start: string;
  color_end: string;
  icon_url: string | null;
  fuel_value_mj: number | null;
};

const databaseName = "dsp-resource-sheet";
const databaseVersion = 1;
const snapshotStoreName = "app";
const snapshotKey = "snapshot";

const seededResources: ResourceSeed[] = [
  { id: "8cd50eb9-d303-46cb-94ed-0cf4dfd12d11", name: "Stalagmite Crystal", type: "ore_vein", sort_order: 10, color_start: "#6af7d9", color_end: "#127f73", icon_url: "icons/resources/stalagmite-crystal.png", fuel_value_mj: null },
  { id: "3f7e8804-0caf-4f0e-8760-bc5c5f4b2ca6", name: "Fractal Silicon", type: "ore_vein", sort_order: 15, color_start: "#91ffe8", color_end: "#267769", icon_url: "icons/resources/fractal-silicon.png", fuel_value_mj: null },
  { id: "ee8f2c6e-5e85-4a42-a98a-5ea575b2ba45", name: "Silicon Ore", type: "ore_vein", sort_order: 20, color_start: "#f7e6a6", color_end: "#7f6c2b", icon_url: "icons/resources/silicon-ore.png", fuel_value_mj: null },
  { id: "9fc63cc0-e433-4e09-b2b7-3fd22f4c6b79", name: "Iron Ore", type: "ore_vein", sort_order: 30, color_start: "#d7dce7", color_end: "#4f5e78", icon_url: "icons/resources/iron-ore.png", fuel_value_mj: null },
  { id: "e34e4651-2eb8-4734-99cb-ccf61d77de83", name: "Grating Crystal", type: "ore_vein", sort_order: 40, color_start: "#95f0ff", color_end: "#246d96", icon_url: "icons/resources/grating-crystal.png", fuel_value_mj: null },
  { id: "3e1160d7-9b0b-46db-8fbc-c20d3094cbf1", name: "Organic Crystal", type: "ore_vein", sort_order: 45, color_start: "#d8ffb4", color_end: "#4e8c39", icon_url: "icons/resources/organic-crystal.png", fuel_value_mj: null },
  { id: "1ac25922-6ec1-4664-8884-cbfeb4afe634", name: "Coal", type: "ore_vein", sort_order: 50, color_start: "#858993", color_end: "#252833", icon_url: "icons/resources/coal.png", fuel_value_mj: null },
  { id: "7d62ac20-79a7-4ec4-b1d8-904eb636453c", name: "Copper Ore", type: "ore_vein", sort_order: 60, color_start: "#feb375", color_end: "#8a3d22", icon_url: "icons/resources/copper-ore.png", fuel_value_mj: null },
  { id: "350efd4a-514d-4cec-b421-0ec7e36ce9a2", name: "Titanium Ore", type: "ore_vein", sort_order: 70, color_start: "#d3c4ff", color_end: "#6153c5", icon_url: "icons/resources/titanium-ore.png", fuel_value_mj: null },
  { id: "71870674-5da7-4062-bf26-cde403d17ed8", name: "Stone", type: "ore_vein", sort_order: 80, color_start: "#e2dfcf", color_end: "#7c725c", icon_url: "icons/resources/stone.png", fuel_value_mj: null },
  { id: "9c2cedcb-10ee-430c-a512-d523b80f8771", name: "Kimberlite Ore", type: "ore_vein", sort_order: 90, color_start: "#c7f9ff", color_end: "#387e95", icon_url: "icons/resources/kimberlite-ore.png", fuel_value_mj: null },
  { id: "538735d0-04f5-4082-a503-feac8c304f18", name: "Unipolar Magnet", type: "ore_vein", sort_order: 95, color_start: "#ffb5d8", color_end: "#7b2e66", icon_url: "icons/resources/unipolar-magnet.png", fuel_value_mj: null },
  { id: "dcb9e99e-a9a9-470d-b465-5174cd8d536f", name: "Water", type: "liquid_pump", sort_order: 100, color_start: "#89cfff", color_end: "#1f5cc6", icon_url: "icons/resources/water.png", fuel_value_mj: null },
  { id: "2bd99a79-75fc-4a54-af63-5886dd05f179", name: "Sulfuric Acid", type: "liquid_pump", sort_order: 110, color_start: "#f3ff92", color_end: "#8b9133", icon_url: "icons/resources/sulfuric-acid.png", fuel_value_mj: null },
  { id: "33be1ca4-c877-4829-bb7c-fd44e4a0de53", name: "Crude Oil", type: "oil_extractor", sort_order: 120, color_start: "#e8a065", color_end: "#6b2a21", icon_url: "icons/resources/crude-oil.png", fuel_value_mj: null },
  { id: "d4e3ebfe-bc56-48ba-b7cd-0879b40f5f4e", name: "Hydrogen", type: "gas_giant_output", sort_order: 130, color_start: "#fbfbff", color_end: "#87acff", icon_url: "icons/resources/hydrogen.png", fuel_value_mj: 9 },
  { id: "cff31929-7765-4a06-8d8f-085932cb0fec", name: "Deuterium", type: "gas_giant_output", sort_order: 140, color_start: "#ffe6a4", color_end: "#c28d23", icon_url: "icons/resources/deuterium.png", fuel_value_mj: 9 },
  { id: "c70fccf4-ac16-4ae5-960c-4f612c56ac74", name: "Fire Ice", type: "gas_giant_output", sort_order: 150, color_start: "#d8ffff", color_end: "#37afdb", icon_url: "icons/resources/fire-ice.png", fuel_value_mj: 4.8 },
];

const settingsDefaults = new Map<string, string>([
  ["currentSolarSystemId", ""],
  ["currentPlanetId", ""],
  ["miningSpeedPercent", "100"],
  ["vesselCapacityItems", "1000"],
  ["vesselSpeedLyPerSecond", "0.25"],
  ["vesselCruisingSpeedMetersPerSecond", "2000"],
  ["vesselDockingSeconds", "0"],
  ["ilsStorageItems", "10000"],
  ["clusterAddress", ""],
  ["clusterSeed", ""],
  ["clusterStarCount", ""],
  ["clusterResourceCode", ""],
  ["clusterSuffix", ""],
]);

function generateId() {
  return crypto.randomUUID();
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, databaseVersion);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(snapshotStoreName)) {
        db.createObjectStore(snapshotStoreName);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB."));
  });
}

function readRecord<T>(db: IDBDatabase, key: IDBValidKey) {
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(snapshotStoreName, "readonly");
    const store = tx.objectStore(snapshotStoreName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error ?? new Error("Failed to read IndexedDB record."));
  });
}

function writeRecord<T>(db: IDBDatabase, key: IDBValidKey, value: T) {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(snapshotStoreName, "readwrite");
    const store = tx.objectStore(snapshotStoreName);
    store.put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to write IndexedDB record."));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted."));
  });
}

function normalizeSystemPair(systemAId: string, systemBId: string) {
  return [systemAId, systemBId].sort() as [string, string];
}

function nowIso() {
  return new Date().toISOString();
}

function getSortableValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function getNumericValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function ensureArray<T>(value: unknown) {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeStringArray(value: unknown) {
  return Array.from(
    new Set(
      ensureArray<unknown>(value)
        .map((item) => String(item ?? "").trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function ensureSettingsObject(value: unknown) {
  if (!value || typeof value !== "object") {
    return {} as Record<string, string>;
  }

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, item]) => {
    acc[key] = String(item ?? "");
    return acc;
  }, {});
}

function normalizePlanetExtractionIlsOverrides(value: unknown) {
  const overridesByResourceId = new Map<string, PlanetExtractionIlsOverride>();

  for (const item of ensureArray<PlanetExtractionIlsOverride>(value)) {
    const resourceId = getSortableValue(item.resource_id);
    const ilsCount = typeof item.ils_count === "number" && Number.isFinite(item.ils_count) && item.ils_count >= 0
      ? item.ils_count
      : null;

    if (!resourceId || ilsCount === null) {
      continue;
    }

    overridesByResourceId.set(resourceId, {
      resource_id: resourceId,
      ils_count: ilsCount,
    });
  }

  return Array.from(overridesByResourceId.values());
}

function createEmptySnapshot(): Snapshot {
  return {
    resources: [],
    solarSystems: [],
    systemDistances: [],
    planets: [],
    projects: [],
    projectGoals: [],
    projectImportedItems: [],
    oreVeins: [],
    oreVeinMiners: [],
    liquidSites: [],
    oilExtractors: [],
    gasGiantSites: [],
    gasGiantOutputs: [],
    productionSites: [],
    transportRoutes: [],
    settings: {},
  };
}

function ensureSettingsDefaults(settings: Record<string, string>) {
  for (const [key, value] of settingsDefaults.entries()) {
    if (!(key in settings)) {
      settings[key] = value;
    }
  }
}

function seedResourceDefinitions(resources: ResourceDefinition[]) {
  for (const resource of seededResources) {
    const existing = resources.find((item) => item.name === resource.name);
    if (existing) {
      existing.type = resource.type;
      existing.icon_url = resource.icon_url;
      existing.color_start = resource.color_start;
      existing.color_end = resource.color_end;
      existing.fuel_value_mj = resource.fuel_value_mj;
      existing.is_seeded = 1;
      existing.sort_order = resource.sort_order;
      if (!existing.id) {
        existing.id = resource.id;
      }
      continue;
    }

    resources.push({
      ...resource,
      is_seeded: 1,
    });
  }
}

function seedStarterProject(snapshot: Snapshot) {
  if (snapshot.projects.length > 0) {
    return;
  }

  const projectId = generateId();
  snapshot.projects.push({
    id: projectId,
    name: "Current Factory Plan",
    notes: "Seeded from the current Dyson Sphere Program extraction targets.",
    is_active: 1,
    sort_order: 1,
  });

  const starterGoals = new Map<string, number>([
    ["Stalagmite Crystal", 2428],
    ["Silicon Ore", 1806],
    ["Iron Ore", 1617],
    ["Grating Crystal", 990],
    ["Coal", 860],
    ["Copper Ore", 753],
    ["Titanium Ore", 628],
    ["Stone", 305],
    ["Kimberlite Ore", 192],
    ["Water", 115],
    ["Sulfuric Acid", 243],
  ]);

  for (const [resourceName, quantity] of starterGoals.entries()) {
    const resource = snapshot.resources.find((item) => item.name === resourceName);
    if (!resource) {
      continue;
    }

    snapshot.projectGoals.push({
      id: generateId(),
      project_id: projectId,
      resource_id: resource.id,
      quantity,
    });
  }
}

function migrateLiquidGoalsToItemsPerMinute(snapshot: Snapshot) {
  if (snapshot.settings.liquidGoalsMigratedToItemsPerMinute === "1") {
    return;
  }

  const liquidResourceIds = new Set(
    snapshot.resources.filter((resource) => resource.type === "liquid_pump").map((resource) => resource.id),
  );

  snapshot.projectGoals = snapshot.projectGoals.map((goal) =>
    liquidResourceIds.has(goal.resource_id)
      ? { ...goal, quantity: Number(goal.quantity) * 50 }
      : goal,
  );

  snapshot.settings.liquidGoalsMigratedToItemsPerMinute = "1";
}

export function normalizeSnapshot(input: unknown): StoredSnapshot {
  const source = input && typeof input === "object" ? (input as Partial<Snapshot>) : {};
  const snapshot = createEmptySnapshot();

  snapshot.resources = ensureArray<ResourceDefinition>(source.resources).map((item) => ({
    id: getSortableValue(item.id) || generateId(),
    name: getSortableValue(item.name) || "Unnamed Resource",
    type: (item.type as ResourceType) ?? "ore_vein",
    icon_url: typeof item.icon_url === "string" ? item.icon_url : null,
    color_start: getSortableValue(item.color_start) || "#8ee5ff",
    color_end: getSortableValue(item.color_end) || "#305f8f",
    fuel_value_mj: typeof item.fuel_value_mj === "number" ? item.fuel_value_mj : null,
    is_seeded: getNumericValue(item.is_seeded, 0),
    sort_order: getNumericValue(item.sort_order, 0),
  }));
  seedResourceDefinitions(snapshot.resources);

  snapshot.solarSystems = ensureArray<SolarSystem>(source.solarSystems).map((item) => ({
    id: getSortableValue(item.id) || generateId(),
    name: getSortableValue(item.name) || "Unnamed System",
    generated_x: typeof item.generated_x === "number" ? item.generated_x : null,
    generated_y: typeof item.generated_y === "number" ? item.generated_y : null,
    generated_z: typeof item.generated_z === "number" ? item.generated_z : null,
    generated_name_locked: getNumericValue(item.generated_name_locked, 0),
    generated_from_cluster: getNumericValue(item.generated_from_cluster, 0),
  }));

  snapshot.systemDistances = ensureArray<SystemDistance>(source.systemDistances).map((item) => {
    const [systemAId, systemBId] = normalizeSystemPair(
      getSortableValue(item.system_a_id),
      getSortableValue(item.system_b_id),
    );

    return {
      id: getSortableValue(item.id) || generateId(),
      system_a_id: systemAId,
      system_b_id: systemBId,
      distance_ly: getNumericValue(item.distance_ly),
    };
  });

  snapshot.planets = ensureArray<Planet>(source.planets).map((item) => ({
    id: getSortableValue(item.id) || generateId(),
    solar_system_id: getSortableValue(item.solar_system_id),
    name: getSortableValue(item.name) || "Unnamed Planet",
    planet_type: item.planet_type === "gas_giant" ? "gas_giant" : "solid",
    extraction_outbound_ils_count:
      typeof item.extraction_outbound_ils_count === "number" && Number.isFinite(item.extraction_outbound_ils_count)
        ? item.extraction_outbound_ils_count
        : null,
    extraction_outbound_ils_overrides: normalizePlanetExtractionIlsOverrides(item.extraction_outbound_ils_overrides),
  }));

  snapshot.projects = ensureArray<Project>(source.projects).map((item) => ({
    id: getSortableValue(item.id) || generateId(),
    name: getSortableValue(item.name) || "Unnamed Project",
    notes: getSortableValue(item.notes),
    is_active: getNumericValue(item.is_active, 1),
    sort_order: getNumericValue(item.sort_order, 0),
  }));

  snapshot.projectGoals = ensureArray<ProjectGoal>(source.projectGoals).map((item) => ({
    id: getSortableValue(item.id) || generateId(),
    project_id: getSortableValue(item.project_id),
    resource_id: getSortableValue(item.resource_id),
    quantity: getNumericValue(item.quantity),
  }));

  snapshot.projectImportedItems = ensureArray<ProjectImportedItem>(source.projectImportedItems).map<ProjectImportedItem>((item) => ({
    id: getSortableValue(item.id) || generateId(),
    project_id: getSortableValue(item.project_id),
    item_key: getSortableValue(item.item_key),
    display_name: getSortableValue(item.display_name) || "Unnamed Item",
    category: item.category === "raw" ? "raw" : "crafted",
    imported_throughput_per_minute: getNumericValue(item.imported_throughput_per_minute),
    machine_count: getNumericValue(item.machine_count),
    machine_label: getSortableValue(item.machine_label),
    belt_label: getSortableValue(item.belt_label),
    belt_speed_per_minute: typeof item.belt_speed_per_minute === "number" ? item.belt_speed_per_minute : null,
    output_belts: getNumericValue(item.output_belts),
    recipe: getSortableValue(item.recipe),
    outputs: getSortableValue(item.outputs),
    dependencies: ensureArray<ProjectImportedItem["dependencies"][number]>(item.dependencies).map((dependency) => ({
      item_key: getSortableValue(dependency.item_key),
      display_name: getSortableValue(dependency.display_name) || "Unnamed Dependency",
      dependency_type: dependency.dependency_type === "crafted" ? "crafted" : "raw",
      per_unit_ratio: getNumericValue(dependency.per_unit_ratio),
      imported_demand_per_minute: getNumericValue(dependency.imported_demand_per_minute),
    })),
    sort_order: getNumericValue(item.sort_order),
  })).map<ProjectImportedItem>((item) => ({
    ...item,
    dependencies: getCanonicalImportedItemDependencies(item) ?? item.dependencies,
  }));

  snapshot.oreVeins = ensureArray<OreVein>(source.oreVeins).map((item) => ({
    id: getSortableValue(item.id) || generateId(),
    planet_id: getSortableValue(item.planet_id),
    resource_id: getSortableValue(item.resource_id),
    label: getSortableValue(item.label),
    created_at: getSortableValue(item.created_at) || nowIso(),
  }));

  snapshot.oreVeinMiners = ensureArray<OreVeinMiner>(source.oreVeinMiners).map((item) => ({
    id: getSortableValue(item.id) || generateId(),
    ore_vein_id: getSortableValue(item.ore_vein_id),
    miner_type: item.miner_type === "advanced" ? "advanced" : "regular",
    covered_nodes: getNumericValue(item.covered_nodes, 1),
    advanced_speed_percent:
      typeof item.advanced_speed_percent === "number" ? item.advanced_speed_percent : null,
  }));

  snapshot.liquidSites = ensureArray<LiquidSite>(source.liquidSites).map((item) => ({
    id: getSortableValue(item.id) || generateId(),
    planet_id: getSortableValue(item.planet_id),
    resource_id: getSortableValue(item.resource_id),
    label: getSortableValue(item.label),
    pump_count: getNumericValue(item.pump_count),
    created_at: getSortableValue(item.created_at) || nowIso(),
  }));

  snapshot.oilExtractors = ensureArray<OilExtractor>(source.oilExtractors).map((item) => ({
    id: getSortableValue(item.id) || generateId(),
    planet_id: getSortableValue(item.planet_id),
    resource_id: getSortableValue(item.resource_id),
    label: getSortableValue(item.label),
    oil_per_second: getNumericValue(item.oil_per_second),
    created_at: getSortableValue(item.created_at) || nowIso(),
  }));

  snapshot.gasGiantSites = ensureArray<GasGiantSite>(source.gasGiantSites).map((item) => ({
    id: getSortableValue(item.id) || generateId(),
    planet_id: getSortableValue(item.planet_id),
    label: getSortableValue(item.label),
    collector_count: getNumericValue(item.collector_count),
    created_at: getSortableValue(item.created_at) || nowIso(),
  }));

  snapshot.gasGiantOutputs = ensureArray<GasGiantOutput>(source.gasGiantOutputs).map((item) => ({
    id: getSortableValue(item.id) || generateId(),
    gas_giant_site_id: getSortableValue(item.gas_giant_site_id),
    resource_id: getSortableValue(item.resource_id),
    rate_per_second: getNumericValue(item.rate_per_second),
  }));

  snapshot.productionSites = ensureArray<ProductionSite>(source.productionSites).map((item) => ({
    id: getSortableValue(item.id) || generateId(),
    project_id: getSortableValue(item.project_id),
    item_key: getSortableValue(item.item_key),
    throughput_per_minute: getNumericValue(item.throughput_per_minute),
    solar_system_id: getSortableValue(item.solar_system_id),
    planet_id: getSortableValue(item.planet_id),
    outbound_ils_count: getNumericValue(item.outbound_ils_count),
    same_system_warp_item_keys: normalizeStringArray(item.same_system_warp_item_keys),
    is_finished: getNumericValue(item.is_finished, 1),
    created_at: getSortableValue(item.created_at) || nowIso(),
  }));

  snapshot.transportRoutes = ensureArray<TransportRoute>(source.transportRoutes).map((item) => ({
    id: getSortableValue(item.id) || generateId(),
    source_system_id: getSortableValue(item.source_system_id),
    destination_system_id: getSortableValue(item.destination_system_id),
    resource_id: getSortableValue(item.resource_id),
    throughput_per_minute: getNumericValue(item.throughput_per_minute),
    created_at: getSortableValue(item.created_at) || nowIso(),
  }));

  snapshot.settings = ensureSettingsObject(source.settings);
  ensureSettingsDefaults(snapshot.settings);
  seedStarterProject(snapshot);
  migrateLiquidGoalsToItemsPerMinute(snapshot);

  return snapshot;
}

async function loadSnapshot() {
  const db = await openDatabase();
  const existing = await readRecord<Snapshot>(db, snapshotKey);
  const snapshot = normalizeSnapshot(existing);
  if (!existing) {
    await writeRecord(db, snapshotKey, snapshot);
  }
  db.close();
  return snapshot;
}

async function saveSnapshot(snapshot: Snapshot) {
  const db = await openDatabase();
  await writeRecord(db, snapshotKey, snapshot);
  db.close();
}

function sortResourcesByDisplay(resources: ResourceDefinition[]) {
  return resources.slice().sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name));
}

function getResourceById(snapshot: Snapshot, id: string) {
  return snapshot.resources.find((resource) => resource.id === id) ?? null;
}

function getSolarSystemById(snapshot: Snapshot, id: string) {
  return snapshot.solarSystems.find((solarSystem) => solarSystem.id === id) ?? null;
}

function getPlanetById(snapshot: Snapshot, id: string) {
  return snapshot.planets.find((planet) => planet.id === id) ?? null;
}

function getNextResourceSortOrder(snapshot: Snapshot) {
  return Math.max(0, ...snapshot.resources.map((resource) => resource.sort_order)) + 10;
}

function deleteOreVein(snapshot: Snapshot, id: string) {
  snapshot.oreVeinMiners = snapshot.oreVeinMiners.filter((miner) => miner.ore_vein_id !== id);
  snapshot.oreVeins = snapshot.oreVeins.filter((vein) => vein.id !== id);
}

function deleteGasGiantSite(snapshot: Snapshot, id: string) {
  snapshot.gasGiantOutputs = snapshot.gasGiantOutputs.filter((output) => output.gas_giant_site_id !== id);
  snapshot.gasGiantSites = snapshot.gasGiantSites.filter((site) => site.id !== id);
}

function deletePlanet(snapshot: Snapshot, planetId: string) {
  snapshot.oreVeins.filter((vein) => vein.planet_id === planetId).forEach((vein) => deleteOreVein(snapshot, vein.id));
  snapshot.liquidSites = snapshot.liquidSites.filter((site) => site.planet_id !== planetId);
  snapshot.oilExtractors = snapshot.oilExtractors.filter((site) => site.planet_id !== planetId);
  snapshot.gasGiantSites.filter((site) => site.planet_id === planetId).forEach((site) => deleteGasGiantSite(snapshot, site.id));
  snapshot.productionSites = snapshot.productionSites.filter((site) => site.planet_id !== planetId);
  snapshot.planets = snapshot.planets.filter((planet) => planet.id !== planetId);

  if (snapshot.settings.currentPlanetId === planetId) {
    snapshot.settings.currentPlanetId = "";
  }
}

function deleteSolarSystem(snapshot: Snapshot, solarSystemId: string) {
  snapshot.planets
    .filter((planet) => planet.solar_system_id === solarSystemId)
    .forEach((planet) => deletePlanet(snapshot, planet.id));
  snapshot.productionSites = snapshot.productionSites.filter((site) => site.solar_system_id !== solarSystemId);
  snapshot.systemDistances = snapshot.systemDistances.filter(
    (distance) => distance.system_a_id !== solarSystemId && distance.system_b_id !== solarSystemId,
  );
  snapshot.transportRoutes = snapshot.transportRoutes.filter(
    (route) => route.source_system_id !== solarSystemId && route.destination_system_id !== solarSystemId,
  );
  snapshot.solarSystems = snapshot.solarSystems.filter((solarSystem) => solarSystem.id !== solarSystemId);

  if (snapshot.settings.currentSolarSystemId === solarSystemId) {
    snapshot.settings.currentSolarSystemId = "";
    snapshot.settings.currentPlanetId = "";
  }
}

function replaceProjectGoals(snapshot: Snapshot, projectId: string, goals: Array<{ resourceId: string; quantity: number }>) {
  snapshot.projectGoals = snapshot.projectGoals.filter((goal) => goal.project_id !== projectId);
  goals
    .filter((goal) => goal.quantity > 0)
    .forEach((goal) => {
      snapshot.projectGoals.push({
        id: generateId(),
        project_id: projectId,
        resource_id: goal.resourceId,
        quantity: goal.quantity,
      });
    });
}

function replaceProjectImportedItems(
  snapshot: Snapshot,
  projectId: string,
  importedItems: Array<Omit<ProjectImportedItem, "id" | "project_id">>,
) {
  snapshot.projectImportedItems = snapshot.projectImportedItems.filter((item) => item.project_id !== projectId);
  importedItems.forEach((item) => {
    const nextItem: ProjectImportedItem = {
      id: generateId(),
      project_id: projectId,
      item_key: item.item_key,
      display_name: item.display_name,
      category: item.category,
      imported_throughput_per_minute: Number(item.imported_throughput_per_minute),
      machine_count: Number(item.machine_count),
      machine_label: item.machine_label,
      belt_label: item.belt_label,
      belt_speed_per_minute: item.belt_speed_per_minute === null ? null : Number(item.belt_speed_per_minute),
      output_belts: Number(item.output_belts),
      recipe: item.recipe,
      outputs: item.outputs,
      dependencies: item.dependencies.map((dependency) => ({
        item_key: dependency.item_key,
        display_name: dependency.display_name,
        dependency_type: dependency.dependency_type,
        per_unit_ratio: Number(dependency.per_unit_ratio),
        imported_demand_per_minute: Number(dependency.imported_demand_per_minute),
      })),
      sort_order: Number(item.sort_order),
    };

    snapshot.projectImportedItems.push({
      ...nextItem,
      dependencies: getCanonicalImportedItemDependencies(nextItem) ?? nextItem.dependencies,
    });
  });
}

function normalizeSeedLookupValue(value: string) {
  return value.trim().toLowerCase();
}

function buildSeedSystemKey(systemName: string) {
  return normalizeSeedLookupValue(systemName);
}

function buildSeedPlanetKey(systemName: string, planetName: string, planetType: PlanetType) {
  return `${buildSeedSystemKey(systemName)}::${normalizeSeedLookupValue(planetName)}::${planetType}`;
}

function summarizeSeedMismatchEntries(values: string[]) {
  if (values.length === 0) {
    return "";
  }

  const preview = values.slice(0, 3).join(", ");
  return values.length > 3 ? `${preview} (+${values.length - 3} more)` : preview;
}

function getSeedValidationError(snapshot: Snapshot) {
  const clusterAddress = snapshot.settings.clusterAddress?.trim() ?? "";
  if (!clusterAddress) {
    return { error: null, generatedSystemCount: 0, generatedPlanetCount: 0 };
  }

  let generatedCatalog: ReturnType<typeof generateClusterCatalog>;
  try {
    generatedCatalog = generateClusterCatalog(parseClusterAddress(clusterAddress));
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to validate the imported seed.",
      generatedSystemCount: 0,
      generatedPlanetCount: 0,
    };
  }

  const generatedSystemNames = new Set(generatedCatalog.map((system) => buildSeedSystemKey(system.name)));
  const missingSystems = generatedCatalog
    .filter((system) => !snapshot.solarSystems.some((entry) => buildSeedSystemKey(entry.name) === buildSeedSystemKey(system.name)))
    .map((system) => system.name);
  const extraSystems = snapshot.solarSystems
    .filter((system) => !generatedSystemNames.has(buildSeedSystemKey(system.name)))
    .map((system) => system.name);

  const systemNameById = new Map(snapshot.solarSystems.map((system) => [system.id, system.name]));
  const generatedPlanetKeys = new Set(
    generatedCatalog.flatMap((system) => system.planets.map((planet) => buildSeedPlanetKey(system.name, planet.name, planet.planetType))),
  );
  const actualPlanetEntries = snapshot.planets
    .map((planet) => {
      const systemName = systemNameById.get(planet.solar_system_id);
      if (!systemName) {
        return null;
      }

      return {
        label: `${systemName} / ${planet.name}`,
        key: buildSeedPlanetKey(systemName, planet.name, planet.planet_type),
      };
    })
    .filter((entry): entry is { label: string; key: string } => entry !== null);

  const missingPlanets = generatedCatalog
    .flatMap((system) =>
      system.planets
        .filter(
          (planet) =>
            !actualPlanetEntries.some((entry) => entry.key === buildSeedPlanetKey(system.name, planet.name, planet.planetType)),
        )
        .map((planet) => `${system.name} / ${planet.name}`),
    );
  const extraPlanets = actualPlanetEntries
    .filter((entry) => !generatedPlanetKeys.has(entry.key))
    .map((entry) => entry.label);

  if (missingSystems.length === 0 && extraSystems.length === 0 && missingPlanets.length === 0 && extraPlanets.length === 0) {
    return {
      error: null,
      generatedSystemCount: generatedCatalog.length,
      generatedPlanetCount: generatedCatalog.reduce((sum, system) => sum + system.planets.length, 0),
    };
  }

  const parts = [
    extraSystems.length > 0
      ? `${extraSystems.length} system entries are not part of the imported seed: ${summarizeSeedMismatchEntries(extraSystems)}.`
      : "",
    missingSystems.length > 0
      ? `${missingSystems.length} seed systems are missing locally: ${summarizeSeedMismatchEntries(missingSystems)}.`
      : "",
    extraPlanets.length > 0
      ? `${extraPlanets.length} planet entries are not part of the imported seed: ${summarizeSeedMismatchEntries(extraPlanets)}.`
      : "",
    missingPlanets.length > 0
      ? `${missingPlanets.length} seed planets are missing locally: ${summarizeSeedMismatchEntries(missingPlanets)}.`
      : "",
  ].filter(Boolean);

  return {
    error: `Imported seed ${clusterAddress} does not match the saved systems and planets. ${parts.join(" ")}`.trim(),
    generatedSystemCount: generatedCatalog.length,
    generatedPlanetCount: generatedCatalog.reduce((sum, system) => sum + system.planets.length, 0),
  };
}

function importClusterAddress(snapshot: Snapshot, clusterAddressValue: string) {
  const parsedCluster = parseClusterAddress(clusterAddressValue);
  const generatedSystems = generateClusterSystems(parsedCluster);
  const generatedCatalog = generateClusterCatalog(parsedCluster);
  const generatedNameSet = new Set(generatedSystems.map((system) => system.name));

  snapshot.settings.clusterAddress = parsedCluster.clusterAddress;
  snapshot.settings.clusterSeed = String(parsedCluster.clusterSeed);
  snapshot.settings.clusterStarCount = String(parsedCluster.clusterStarCount);
  snapshot.settings.clusterResourceCode = parsedCluster.clusterResourceCode ?? "";
  snapshot.settings.clusterSuffix = parsedCluster.clusterSuffix ?? "";

  snapshot.solarSystems.forEach((system) => {
    if (system.generated_from_cluster === 1 && !generatedNameSet.has(system.name)) {
      system.generated_x = null;
      system.generated_y = null;
      system.generated_z = null;
      system.generated_name_locked = 0;
      system.generated_from_cluster = 0;
    }
  });

  for (const generatedSystem of generatedSystems) {
    const existing = snapshot.solarSystems.find((system) => system.name === generatedSystem.name);
    if (existing) {
      existing.generated_x = generatedSystem.x;
      existing.generated_y = generatedSystem.y;
      existing.generated_z = generatedSystem.z;
      existing.generated_name_locked = 1;
      existing.generated_from_cluster = 1;
      continue;
    }

    snapshot.solarSystems.push({
      id: generateId(),
      name: generatedSystem.name,
      generated_x: generatedSystem.x,
      generated_y: generatedSystem.y,
      generated_z: generatedSystem.z,
      generated_name_locked: 1,
      generated_from_cluster: 1,
    });
  }

  const systemIdByName = new Map(snapshot.solarSystems.map((system) => [system.name, system.id]));
  generatedCatalog.forEach((generatedSystem) => {
    const systemId = systemIdByName.get(generatedSystem.name);
    if (!systemId) {
      return;
    }

    generatedSystem.planets.forEach((generatedPlanet) => {
      const existingPlanet = snapshot.planets.find(
        (planet) =>
          planet.solar_system_id === systemId &&
          planet.name.trim().toLowerCase() === generatedPlanet.name.trim().toLowerCase() &&
          planet.planet_type === generatedPlanet.planetType,
      );
      if (existingPlanet) {
        return;
      }

      snapshot.planets.push({
        id: generateId(),
        solar_system_id: systemId,
        name: generatedPlanet.name,
        planet_type: generatedPlanet.planetType,
        extraction_outbound_ils_count: null,
        extraction_outbound_ils_overrides: [],
      });
    });
  });

  const birthSystemId = systemIdByName.get(generatedCatalog[0]?.name ?? "") ?? "";
  const birthPlanetName =
    generatedCatalog[0]?.planets.find((planet) => planet.planetType === "solid")?.name ??
    generatedCatalog[0]?.planets[0]?.name ??
    "";
  const birthPlanetId =
    snapshot.planets.find(
      (planet) =>
        planet.solar_system_id === birthSystemId &&
        planet.name.trim().toLowerCase() === birthPlanetName.trim().toLowerCase(),
    )?.id ?? "";

  if (!snapshot.settings.currentSolarSystemId || !getSolarSystemById(snapshot, snapshot.settings.currentSolarSystemId)) {
    snapshot.settings.currentSolarSystemId = birthSystemId;
  }
  if (!snapshot.settings.currentPlanetId || !getPlanetById(snapshot, snapshot.settings.currentPlanetId)) {
    snapshot.settings.currentPlanetId = birthPlanetId;
  }
}

function resourceGoalUnit(type: ResourceType) {
  switch (type) {
    case "ore_vein":
      return "30/min nodes";
    case "liquid_pump":
      return "items / min";
    case "oil_extractor":
      return "oil / min";
    case "gas_giant_output":
      return "items / min";
  }
}

export function buildBootstrap(snapshot: Snapshot): BootstrapData {
  const miningSpeedPercent = Number(snapshot.settings.miningSpeedPercent ?? "100");
  const oreVeinById = new Map(snapshot.oreVeins.map((item) => [item.id, item]));
  const gasSiteById = new Map(snapshot.gasGiantSites.map((item) => [item.id, item]));
  const resourceById = new Map(snapshot.resources.map((resource) => [resource.id, resource]));
  const seedValidation = getSeedValidationError(snapshot);
  const activeProjectIds = new Set(snapshot.projects.filter((project) => Number(project.is_active) === 1).map((project) => project.id));
  const goalTotals = new Map<string, number>();
  const aggregates = new Map(
    snapshot.resources.map((resource) => [
      resource.id,
      {
        supplyMetric: 0,
        supplyPerMinute: 0,
        supplyPerSecond: 0,
        placementIds: new Set<string>(),
      },
    ]),
  );

  snapshot.projectGoals.forEach((goal) => {
    if (!activeProjectIds.has(goal.project_id)) {
      return;
    }

    goalTotals.set(goal.resource_id, (goalTotals.get(goal.resource_id) ?? 0) + Number(goal.quantity));
  });

  snapshot.oreVeinMiners.forEach((miner) => {
    const parentVein = oreVeinById.get(miner.ore_vein_id);
    if (!parentVein) {
      return;
    }

    const aggregate = aggregates.get(parentVein.resource_id);
    if (!aggregate) {
      return;
    }

    const supplyPerMinute =
      miner.miner_type === "advanced"
        ? getAdvancedMinerOutputPerMinute(
            Number(miner.covered_nodes),
            Number(miner.advanced_speed_percent ?? 100),
            miningSpeedPercent,
          )
        : getRegularMinerOutputPerMinute(Number(miner.covered_nodes), miningSpeedPercent);

    aggregate.placementIds.add(parentVein.id);
    aggregate.supplyMetric += Number(miner.covered_nodes);
    aggregate.supplyPerMinute += supplyPerMinute;
    aggregate.supplyPerSecond = aggregate.supplyPerMinute / 60;
  });

  snapshot.liquidSites.forEach((site) => {
    const aggregate = aggregates.get(site.resource_id);
    if (!aggregate) {
      return;
    }

    const supplyPerMinute = getPumpOutputPerMinute(Number(site.pump_count), miningSpeedPercent);
    aggregate.placementIds.add(site.id);
    aggregate.supplyPerMinute += supplyPerMinute;
    aggregate.supplyPerSecond = aggregate.supplyPerMinute / 60;
    aggregate.supplyMetric = aggregate.supplyPerMinute;
  });

  snapshot.oilExtractors.forEach((extractor) => {
    const aggregate = aggregates.get(extractor.resource_id);
    if (!aggregate) {
      return;
    }

    aggregate.placementIds.add(extractor.id);
    aggregate.supplyPerSecond += getOilOutputPerSecond(Number(extractor.oil_per_second), miningSpeedPercent);
    aggregate.supplyPerMinute = aggregate.supplyPerSecond * 60;
    aggregate.supplyMetric = aggregate.supplyPerMinute;
  });

  snapshot.gasGiantSites.forEach((site) => {
    const outputs = snapshot.gasGiantOutputs.filter((output) => output.gas_giant_site_id === site.id);
    const trueBoost = getOrbitalCollectorTrueBoost(
      outputs.map((output) => ({
        ratePerSecond: Number(output.rate_per_second),
        fuelValueMj: Number(resourceById.get(output.resource_id)?.fuel_value_mj ?? 0),
      })),
      miningSpeedPercent,
    );

    outputs.forEach((output) => {
      const parentSite = gasSiteById.get(output.gas_giant_site_id);
      if (!parentSite) {
        return;
      }

      const aggregate = aggregates.get(output.resource_id);
      if (!aggregate) {
        return;
      }

      aggregate.placementIds.add(parentSite.id);
      aggregate.supplyPerSecond += Number(output.rate_per_second) * trueBoost * Number(parentSite.collector_count);
      aggregate.supplyPerMinute = aggregate.supplyPerSecond * 60;
      aggregate.supplyMetric = aggregate.supplyPerMinute;
    });
  });

  const resourceSummaries: ResourceSummary[] = sortResourcesByDisplay(snapshot.resources).map((resource) => {
    const aggregate = aggregates.get(resource.id);
    return {
      resourceId: resource.id,
      name: resource.name,
      type: resource.type,
      iconUrl: resource.icon_url,
      colorStart: resource.color_start,
      colorEnd: resource.color_end,
      fuelValueMj: resource.fuel_value_mj,
      goalUnitLabel: resourceGoalUnit(resource.type),
      goalQuantity: goalTotals.get(resource.id) ?? 0,
      supplyMetric: aggregate?.supplyMetric ?? 0,
      supplyPerMinute: aggregate?.supplyPerMinute ?? 0,
      supplyPerSecond: aggregate?.supplyPerSecond ?? 0,
      placementCount: aggregate?.placementIds.size ?? 0,
    };
  });

  return {
    resources: sortResourcesByDisplay(snapshot.resources),
    solarSystems: snapshot.solarSystems.slice().sort((left, right) => left.name.localeCompare(right.name)),
    systemDistances: snapshot.systemDistances.slice(),
    planets: snapshot.planets.slice().sort((left, right) => left.name.localeCompare(right.name)),
    projects: snapshot.projects.slice().sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name)),
    projectGoals: snapshot.projectGoals.slice(),
    projectImportedItems: snapshot.projectImportedItems.slice().sort(
      (left, right) => left.project_id.localeCompare(right.project_id) || left.display_name.localeCompare(right.display_name),
    ),
    oreVeins: snapshot.oreVeins.slice().sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
    oreVeinMiners: snapshot.oreVeinMiners.slice(),
    liquidSites: snapshot.liquidSites.slice().sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
    oilExtractors: snapshot.oilExtractors.slice().sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
    gasGiantSites: snapshot.gasGiantSites.slice().sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
    gasGiantOutputs: snapshot.gasGiantOutputs.slice(),
    productionSites: snapshot.productionSites.slice().sort(
      (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
    ),
    transportRoutes: snapshot.transportRoutes.slice().sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
    settings: {
      currentSolarSystemId: snapshot.settings.currentSolarSystemId || null,
      currentPlanetId: snapshot.settings.currentPlanetId || null,
      miningSpeedPercent,
      vesselCapacityItems: Number(snapshot.settings.vesselCapacityItems ?? "1000"),
      vesselSpeedLyPerSecond: Number(snapshot.settings.vesselSpeedLyPerSecond ?? "0.25"),
      vesselCruisingSpeedMetersPerSecond: Number(snapshot.settings.vesselCruisingSpeedMetersPerSecond ?? "2000"),
      vesselDockingSeconds: Number(snapshot.settings.vesselDockingSeconds ?? "0"),
      ilsStorageItems: Number(snapshot.settings.ilsStorageItems ?? "10000"),
      clusterAddress: snapshot.settings.clusterAddress ?? "",
      clusterSeed: snapshot.settings.clusterSeed ? Number(snapshot.settings.clusterSeed) : null,
      clusterStarCount: snapshot.settings.clusterStarCount ? Number(snapshot.settings.clusterStarCount) : null,
      clusterResourceCode: snapshot.settings.clusterResourceCode || null,
      clusterSuffix: snapshot.settings.clusterSuffix || null,
    },
    summary: {
      totalResourcesTracked: resourceSummaries.length,
      activeProjectCount: activeProjectIds.size,
      solarSystemCount: snapshot.solarSystems.length,
      planetCount: snapshot.planets.length,
      generatedSystemCount: snapshot.solarSystems.filter((system) => system.generated_from_cluster === 1).length,
      generatedPlanetCount: seedValidation.generatedPlanetCount,
      seedValidationError: seedValidation.error,
      resourceSummaries,
      productionByProjectId: {},
    },
  };
}

function matchId(url: string, pattern: RegExp) {
  const match = pattern.exec(url);
  return match?.[1] ?? null;
}

function ensureResourceExists(snapshot: Snapshot, resourceId: string, expectedType?: ResourceType) {
  const resource = getResourceById(snapshot, resourceId);
  if (!resource) {
    throw new Error("Selected resource does not exist.");
  }
  if (expectedType && resource.type !== expectedType) {
    throw new Error(`Selected resource is not a ${expectedType} resource.`);
  }
  return resource;
}

function ensurePlanetExists(snapshot: Snapshot, planetId: string, expectedType?: PlanetType) {
  const planet = getPlanetById(snapshot, planetId);
  if (!planet) {
    throw new Error("Selected planet does not exist.");
  }
  if (expectedType && planet.planet_type !== expectedType) {
    throw new Error(expectedType === "gas_giant" ? "Target must be a gas giant." : "Target must be a solid planet.");
  }
  return planet;
}

function ensureSolarSystemExists(snapshot: Snapshot, solarSystemId: string) {
  const solarSystem = getSolarSystemById(snapshot, solarSystemId);
  if (!solarSystem) {
    throw new Error("Selected system does not exist.");
  }
  return solarSystem;
}

function cloneSnapshot(snapshot: Snapshot) {
  return structuredClone(snapshot);
}

export async function getBootstrapFromStore() {
  return buildBootstrap(await loadSnapshot());
}

export async function exportSnapshotFromStore() {
  const snapshot = await loadSnapshot();
  return {
    exportPath: "Browser download",
    snapshot,
  };
}

export async function importSnapshotToStore(input: unknown) {
  const snapshot = normalizeSnapshot(input);
  await saveSnapshot(snapshot);
  return buildBootstrap(snapshot);
}

export async function mutateStore(url: string, method: string, body?: unknown) {
  const snapshot = cloneSnapshot(await loadSnapshot());
  const payload = (body ?? {}) as Record<string, unknown>;

  if (url === "/api/resources" && method === "POST") {
    const name = String(payload.name ?? "").trim();
    const type = payload.type as ResourceType;
    if (!name) {
      throw new Error("Resource name is required.");
    }
    if (snapshot.resources.some((resource) => resource.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("A resource with that name already exists.");
    }

    snapshot.resources.push({
      id: generateId(),
      name,
      type,
      icon_url: null,
      color_start: "#8ee5ff",
      color_end: "#305f8f",
      fuel_value_mj: null,
      is_seeded: 0,
      sort_order: getNextResourceSortOrder(snapshot),
    });
  } else if (url === "/api/systems" && method === "POST") {
    const name = String(payload.name ?? "").trim();
    if (!name) {
      throw new Error("System name is required.");
    }
    if (snapshot.solarSystems.some((solarSystem) => solarSystem.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("A system with that name already exists.");
    }

    const id = generateId();
    snapshot.solarSystems.push({
      id,
      name,
      generated_x: null,
      generated_y: null,
      generated_z: null,
      generated_name_locked: 0,
      generated_from_cluster: 0,
    });
    snapshot.settings.currentSolarSystemId = id;
  } else if (url === "/api/planets" && method === "POST") {
    const solarSystemId = String(payload.solarSystemId ?? "");
    const name = String(payload.name ?? "").trim();
    const planetType = payload.planetType === "gas_giant" ? "gas_giant" : "solid";
    ensureSolarSystemExists(snapshot, solarSystemId);
    if (!name) {
      throw new Error("Planet name is required.");
    }
    if (
      snapshot.planets.some(
        (planet) => planet.solar_system_id === solarSystemId && planet.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new Error("A planet with that name already exists in this system.");
    }

    const id = generateId();
    snapshot.planets.push({
      id,
      solar_system_id: solarSystemId,
      name,
      planet_type: planetType,
      extraction_outbound_ils_count: null,
      extraction_outbound_ils_overrides: [],
    });
    snapshot.settings.currentSolarSystemId = solarSystemId;
    snapshot.settings.currentPlanetId = id;
  } else if (matchId(url, /^\/api\/systems\/([^/]+)$/) && method === "PATCH") {
    const solarSystemId = matchId(url, /^\/api\/systems\/([^/]+)$/)!;
    const solarSystem = snapshot.solarSystems.find((item) => item.id === solarSystemId);
    if (!solarSystem) {
      throw new Error("System not found.");
    }
    if (solarSystem.generated_name_locked === 1) {
      throw new Error("Generated cluster systems cannot be renamed manually.");
    }

    const name = String(payload.name ?? solarSystem.name).trim();
    if (!name) {
      throw new Error("System name is required.");
    }
    if (
      snapshot.solarSystems.some(
        (item) => item.id !== solarSystemId && item.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new Error("A system with that name already exists.");
    }

    solarSystem.name = name;
  } else if (matchId(url, /^\/api\/planets\/([^/]+)$/) && method === "PATCH") {
    const planetId = matchId(url, /^\/api\/planets\/([^/]+)$/)!;
    const planet = snapshot.planets.find((item) => item.id === planetId);
    if (!planet) {
      throw new Error("Planet not found.");
    }

    const name = String(payload.name ?? planet.name).trim();
    if (!name) {
      throw new Error("Planet name is required.");
    }
    if (
      snapshot.planets.some(
        (item) =>
          item.id !== planetId &&
          item.solar_system_id === planet.solar_system_id &&
          item.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new Error("A planet with that name already exists in this system.");
    }

    planet.name = name;
    if ("extractionOutboundIlsCount" in payload) {
      const nextIlsCount = payload.extractionOutboundIlsCount;
      planet.extraction_outbound_ils_count =
        nextIlsCount === null || nextIlsCount === ""
          ? null
          : Number.isFinite(Number(nextIlsCount))
            ? Number(nextIlsCount)
            : planet.extraction_outbound_ils_count;
    }
    if ("extractionOutboundIlsOverrides" in payload) {
      const overridesByResourceId = new Map<string, PlanetExtractionIlsOverride>();

      ensureArray<{ resourceId: string; ilsCount: number }>(payload.extractionOutboundIlsOverrides).forEach((override) => {
        const resourceId = String(override.resourceId ?? "").trim();
        const ilsCount = Number(override.ilsCount);
        if (!resourceId || !Number.isFinite(ilsCount) || ilsCount < 0) {
          return;
        }

        overridesByResourceId.set(resourceId, {
          resource_id: resourceId,
          ils_count: ilsCount,
        });
      });

      planet.extraction_outbound_ils_overrides = Array.from(overridesByResourceId.values());
    }
  } else if (url === "/api/settings" && method === "PATCH") {
    Object.entries(payload).forEach(([key, value]) => {
      snapshot.settings[key] = value === null ? "" : String(value);
    });
  } else if (url === "/api/cluster/import" && method === "POST") {
    importClusterAddress(snapshot, String(payload.clusterAddress ?? ""));
  } else if (url === "/api/projects" && method === "POST") {
    const name = String(payload.name ?? "").trim();
    const notes = String(payload.notes ?? "").trim();
    if (!name) {
      throw new Error("Project name is required.");
    }
    const projectId = generateId();
    snapshot.projects.push({
      id: projectId,
      name,
      notes,
      is_active: 1,
      sort_order: Math.max(0, ...snapshot.projects.map((project) => project.sort_order)) + 1,
    });
    if (Array.isArray(payload.goals)) {
      replaceProjectGoals(
        snapshot,
        projectId,
        (payload.goals as Array<{ resourceId: string; quantity: number }>).map((goal) => ({
          resourceId: goal.resourceId,
          quantity: Number(goal.quantity),
        })),
      );
    }
    if (Array.isArray(payload.importedItems)) {
      replaceProjectImportedItems(
        snapshot,
        projectId,
        payload.importedItems as Array<Omit<ProjectImportedItem, "id" | "project_id">>,
      );
    }
  } else if (matchId(url, /^\/api\/projects\/([^/]+)$/) && method === "PATCH") {
    const projectId = matchId(url, /^\/api\/projects\/([^/]+)$/)!;
    const project = snapshot.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("Project not found.");
    }
    project.name = String(payload.name ?? project.name).trim();
    project.notes = String(payload.notes ?? project.notes).trim();
    project.is_active = payload.isActive ? 1 : 0;
    if (Array.isArray(payload.goals)) {
      replaceProjectGoals(
        snapshot,
        projectId,
        (payload.goals as Array<{ resourceId: string; quantity: number }>).map((goal) => ({
          resourceId: goal.resourceId,
          quantity: Number(goal.quantity),
        })),
      );
    }
    if (Array.isArray(payload.importedItems)) {
      replaceProjectImportedItems(
        snapshot,
        projectId,
        payload.importedItems as Array<Omit<ProjectImportedItem, "id" | "project_id">>,
      );
    }
  } else if (matchId(url, /^\/api\/projects\/([^/]+)\/goals$/) && method === "PUT") {
    const projectId = matchId(url, /^\/api\/projects\/([^/]+)\/goals$/)!;
    replaceProjectGoals(
      snapshot,
      projectId,
      ensureArray<{ resourceId: string; quantity: number }>(payload.goals).map((goal) => ({
        resourceId: goal.resourceId,
        quantity: Number(goal.quantity),
      })),
    );
  } else if (url === "/api/production-sites" && method === "POST") {
    const projectId = String(payload.projectId ?? "");
    const itemKey = String(payload.itemKey ?? "").trim();
    const solarSystemId = String(payload.solarSystemId ?? "");
    const planetId = String(payload.planetId ?? "");
    ensureSolarSystemExists(snapshot, solarSystemId);
    const planet = ensurePlanetExists(snapshot, planetId);
    if (planet.solar_system_id !== solarSystemId) {
      throw new Error("Selected planet does not belong to the selected system.");
    }
    if (!snapshot.projects.some((project) => project.id === projectId)) {
      throw new Error("Selected project does not exist.");
    }
    if (!snapshot.projectImportedItems.some((item) => item.project_id === projectId && item.item_key === itemKey)) {
      throw new Error("Selected production item is not available in this project.");
    }

    snapshot.productionSites.push({
      id: generateId(),
      project_id: projectId,
      item_key: itemKey,
      throughput_per_minute: Number(payload.throughputPerMinute ?? 0),
      solar_system_id: solarSystemId,
      planet_id: planetId,
      outbound_ils_count: Number(payload.outboundIlsCount ?? 0),
      same_system_warp_item_keys: normalizeStringArray(payload.sameSystemWarpItemKeys),
      is_finished: payload.isFinished === false ? 0 : 1,
      created_at: nowIso(),
    });
  } else if (matchId(url, /^\/api\/production-sites\/([^/]+)$/) && method === "PATCH") {
    const productionSiteId = matchId(url, /^\/api\/production-sites\/([^/]+)$/)!;
    const productionSite = snapshot.productionSites.find((item) => item.id === productionSiteId);
    if (!productionSite) {
      throw new Error("Production site not found.");
    }

    const solarSystemId = String(payload.solarSystemId ?? productionSite.solar_system_id);
    const planetId = String(payload.planetId ?? productionSite.planet_id);
    ensureSolarSystemExists(snapshot, solarSystemId);
    const planet = ensurePlanetExists(snapshot, planetId);
    if (planet.solar_system_id !== solarSystemId) {
      throw new Error("Selected planet does not belong to the selected system.");
    }

    const nextItemKey = String(payload.itemKey ?? productionSite.item_key).trim();
    if (!snapshot.projectImportedItems.some((item) => item.project_id === productionSite.project_id && item.item_key === nextItemKey)) {
      throw new Error("Selected production item is not available in this project.");
    }
    productionSite.item_key = nextItemKey;
    productionSite.throughput_per_minute = Number(payload.throughputPerMinute ?? productionSite.throughput_per_minute);
    productionSite.solar_system_id = solarSystemId;
    productionSite.planet_id = planetId;
    productionSite.outbound_ils_count = Number(payload.outboundIlsCount ?? productionSite.outbound_ils_count);
    if ("sameSystemWarpItemKeys" in payload) {
      productionSite.same_system_warp_item_keys = normalizeStringArray(payload.sameSystemWarpItemKeys);
    }
    productionSite.is_finished = payload.isFinished === undefined ? productionSite.is_finished : payload.isFinished ? 1 : 0;
  } else if (url === "/api/ore-veins" && method === "POST") {
    const planetId = String(payload.planetId ?? "");
    const resourceId = String(payload.resourceId ?? "");
    ensurePlanetExists(snapshot, planetId, "solid");
    ensureResourceExists(snapshot, resourceId, "ore_vein");
    const oreVeinId = generateId();
    snapshot.oreVeins.push({
      id: oreVeinId,
      planet_id: planetId,
      resource_id: resourceId,
      label: String(payload.label ?? ""),
      created_at: nowIso(),
    });
    ensureArray<{ minerType: MinerType; coveredNodes: number; advancedSpeedPercent?: number }>(payload.miners).forEach((miner) => {
      snapshot.oreVeinMiners.push({
        id: generateId(),
        ore_vein_id: oreVeinId,
        miner_type: miner.minerType,
        covered_nodes: Number(miner.coveredNodes),
        advanced_speed_percent: miner.minerType === "advanced" ? Number(miner.advancedSpeedPercent ?? 100) : null,
      });
    });
  } else if (url === "/api/liquids" && method === "POST") {
    const planetId = String(payload.planetId ?? "");
    const resourceId = String(payload.resourceId ?? "");
    ensurePlanetExists(snapshot, planetId, "solid");
    ensureResourceExists(snapshot, resourceId, "liquid_pump");
    snapshot.liquidSites.push({
      id: generateId(),
      planet_id: planetId,
      resource_id: resourceId,
      label: String(payload.label ?? ""),
      pump_count: Number(payload.pumpCount ?? 0),
      created_at: nowIso(),
    });
  } else if (url === "/api/oil-extractors" && method === "POST") {
    const planetId = String(payload.planetId ?? "");
    const resourceId = String(payload.resourceId ?? "");
    ensurePlanetExists(snapshot, planetId, "solid");
    ensureResourceExists(snapshot, resourceId, "oil_extractor");
    snapshot.oilExtractors.push({
      id: generateId(),
      planet_id: planetId,
      resource_id: resourceId,
      label: String(payload.label ?? ""),
      oil_per_second: Number(payload.oilPerSecond ?? 0),
      created_at: nowIso(),
    });
  } else if (url === "/api/gas-giants" && method === "POST") {
    const planetId = String(payload.planetId ?? "");
    ensurePlanetExists(snapshot, planetId, "gas_giant");
    const siteId = generateId();
    snapshot.gasGiantSites.push({
      id: siteId,
      planet_id: planetId,
      label: String(payload.label ?? ""),
      collector_count: Number(payload.collectorCount ?? 0),
      created_at: nowIso(),
    });
    ensureArray<{ resourceId: string; ratePerSecond: number }>(payload.outputs).forEach((output) => {
      ensureResourceExists(snapshot, output.resourceId, "gas_giant_output");
      snapshot.gasGiantOutputs.push({
        id: generateId(),
        gas_giant_site_id: siteId,
        resource_id: output.resourceId,
        rate_per_second: Number(output.ratePerSecond),
      });
    });
  } else if (url === "/api/transport-routes" && method === "POST") {
    const sourceSystemId = String(payload.sourceSystemId ?? "");
    const destinationSystemId = String(payload.destinationSystemId ?? "");
    const resourceId = String(payload.resourceId ?? "");
    ensureSolarSystemExists(snapshot, sourceSystemId);
    ensureSolarSystemExists(snapshot, destinationSystemId);
    ensureResourceExists(snapshot, resourceId);
    if (sourceSystemId === destinationSystemId) {
      throw new Error("Routes must use two different systems.");
    }

    const existing = snapshot.transportRoutes.find(
      (route) =>
        route.source_system_id === sourceSystemId &&
        route.destination_system_id === destinationSystemId &&
        route.resource_id === resourceId,
    );

    if (existing) {
      existing.throughput_per_minute = Number(payload.throughputPerMinute ?? existing.throughput_per_minute);
    } else {
      snapshot.transportRoutes.push({
        id: generateId(),
        source_system_id: sourceSystemId,
        destination_system_id: destinationSystemId,
        resource_id: resourceId,
        throughput_per_minute: Number(payload.throughputPerMinute ?? 0),
        created_at: nowIso(),
      });
    }
  } else if (matchId(url, /^\/api\/transport-routes\/([^/]+)$/) && method === "PATCH") {
    const routeId = matchId(url, /^\/api\/transport-routes\/([^/]+)$/)!;
    const route = snapshot.transportRoutes.find((item) => item.id === routeId);
    if (!route) {
      throw new Error("Transport route not found.");
    }

    const sourceSystemId = String(payload.sourceSystemId ?? "");
    const destinationSystemId = String(payload.destinationSystemId ?? "");
    const resourceId = String(payload.resourceId ?? "");
    ensureSolarSystemExists(snapshot, sourceSystemId);
    ensureSolarSystemExists(snapshot, destinationSystemId);
    ensureResourceExists(snapshot, resourceId);

    const duplicate = snapshot.transportRoutes.find(
      (item) =>
        item.id !== routeId &&
        item.source_system_id === sourceSystemId &&
        item.destination_system_id === destinationSystemId &&
        item.resource_id === resourceId,
    );

    if (duplicate) {
      duplicate.throughput_per_minute = Number(payload.throughputPerMinute ?? duplicate.throughput_per_minute);
      snapshot.transportRoutes = snapshot.transportRoutes.filter((item) => item.id !== routeId);
    } else {
      route.source_system_id = sourceSystemId;
      route.destination_system_id = destinationSystemId;
      route.resource_id = resourceId;
      route.throughput_per_minute = Number(payload.throughputPerMinute ?? route.throughput_per_minute);
    }
  } else if (matchId(url, /^\/api\/ore-veins\/([^/]+)$/) && method === "DELETE") {
    deleteOreVein(snapshot, matchId(url, /^\/api\/ore-veins\/([^/]+)$/)!);
  } else if (matchId(url, /^\/api\/liquids\/([^/]+)$/) && method === "DELETE") {
    snapshot.liquidSites = snapshot.liquidSites.filter((site) => site.id !== matchId(url, /^\/api\/liquids\/([^/]+)$/)!);
  } else if (matchId(url, /^\/api\/oil-extractors\/([^/]+)$/) && method === "DELETE") {
    snapshot.oilExtractors = snapshot.oilExtractors.filter((site) => site.id !== matchId(url, /^\/api\/oil-extractors\/([^/]+)$/)!);
  } else if (matchId(url, /^\/api\/gas-giants\/([^/]+)$/) && method === "DELETE") {
    deleteGasGiantSite(snapshot, matchId(url, /^\/api\/gas-giants\/([^/]+)$/)!);
  } else if (matchId(url, /^\/api\/production-sites\/([^/]+)$/) && method === "DELETE") {
    snapshot.productionSites = snapshot.productionSites.filter(
      (site) => site.id !== matchId(url, /^\/api\/production-sites\/([^/]+)$/)!,
    );
  } else if (matchId(url, /^\/api\/transport-routes\/([^/]+)$/) && method === "DELETE") {
    snapshot.transportRoutes = snapshot.transportRoutes.filter((route) => route.id !== matchId(url, /^\/api\/transport-routes\/([^/]+)$/)!);
  } else if (matchId(url, /^\/api\/ore-veins\/([^/]+)\/location$/) && method === "PATCH") {
    const planetId = String(payload.planetId ?? "");
    ensurePlanetExists(snapshot, planetId, "solid");
    const vein = snapshot.oreVeins.find((item) => item.id === matchId(url, /^\/api\/ore-veins\/([^/]+)\/location$/)!);
    if (vein) {
      vein.planet_id = planetId;
    }
  } else if (matchId(url, /^\/api\/liquids\/([^/]+)\/location$/) && method === "PATCH") {
    const planetId = String(payload.planetId ?? "");
    ensurePlanetExists(snapshot, planetId, "solid");
    const site = snapshot.liquidSites.find((item) => item.id === matchId(url, /^\/api\/liquids\/([^/]+)\/location$/)!);
    if (site) {
      site.planet_id = planetId;
    }
  } else if (matchId(url, /^\/api\/oil-extractors\/([^/]+)\/location$/) && method === "PATCH") {
    const planetId = String(payload.planetId ?? "");
    ensurePlanetExists(snapshot, planetId, "solid");
    const site = snapshot.oilExtractors.find((item) => item.id === matchId(url, /^\/api\/oil-extractors\/([^/]+)\/location$/)!);
    if (site) {
      site.planet_id = planetId;
    }
  } else if (matchId(url, /^\/api\/gas-giants\/([^/]+)\/location$/) && method === "PATCH") {
    const planetId = String(payload.planetId ?? "");
    ensurePlanetExists(snapshot, planetId, "gas_giant");
    const site = snapshot.gasGiantSites.find((item) => item.id === matchId(url, /^\/api\/gas-giants\/([^/]+)\/location$/)!);
    if (site) {
      site.planet_id = planetId;
    }
  } else if (matchId(url, /^\/api\/planets\/([^/]+)$/) && method === "DELETE") {
    deletePlanet(snapshot, matchId(url, /^\/api\/planets\/([^/]+)$/)!);
  } else if (matchId(url, /^\/api\/systems\/([^/]+)$/) && method === "DELETE") {
    deleteSolarSystem(snapshot, matchId(url, /^\/api\/systems\/([^/]+)$/)!);
  } else {
    throw new Error(`Unsupported local API route: ${method} ${url}`);
  }

  await saveSnapshot(snapshot);
  return buildBootstrap(snapshot);
}
