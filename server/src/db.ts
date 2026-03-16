import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  getAdvancedMinerOutputPerMinute,
  getOilOutputPerSecond,
  getOrbitalCollectorTrueBoost,
  getPumpOutputPerMinute,
  getRegularMinerOutputPerMinute,
} from "./dspMath.js";

export type ResourceType = "ore_vein" | "liquid_pump" | "oil_extractor" | "gas_giant_output";
export type PlanetType = "solid" | "gas_giant";
export type MinerType = "regular" | "advanced";

type ResourceSeed = {
  name: string;
  type: ResourceType;
  sortOrder: number;
  colorStart: string;
  colorEnd: string;
  iconUrl?: string;
  fuelValueMj?: number | null;
};

const dataDirectory = path.resolve(process.cwd(), "..", "data");
mkdirSync(path.join(dataDirectory, "exports"), { recursive: true });

const db = new DatabaseSync(path.join(dataDirectory, "dsp-resource-sheet.sqlite"));
db.exec("PRAGMA foreign_keys = ON");

const seededResources: ResourceSeed[] = [
  { name: "Stalagmite Crystal", type: "ore_vein", sortOrder: 10, colorStart: "#6af7d9", colorEnd: "#127f73", iconUrl: "/icons/resources/stalagmite-crystal.png" },
  { name: "Silicon Ore", type: "ore_vein", sortOrder: 20, colorStart: "#f7e6a6", colorEnd: "#7f6c2b", iconUrl: "/icons/resources/silicon-ore.png" },
  { name: "Iron Ore", type: "ore_vein", sortOrder: 30, colorStart: "#d7dce7", colorEnd: "#4f5e78", iconUrl: "/icons/resources/iron-ore.png" },
  { name: "Grating Crystal", type: "ore_vein", sortOrder: 40, colorStart: "#95f0ff", colorEnd: "#246d96", iconUrl: "/icons/resources/grating-crystal.png" },
  { name: "Coal", type: "ore_vein", sortOrder: 50, colorStart: "#858993", colorEnd: "#252833", iconUrl: "/icons/resources/coal.png" },
  { name: "Copper Ore", type: "ore_vein", sortOrder: 60, colorStart: "#feb375", colorEnd: "#8a3d22", iconUrl: "/icons/resources/copper-ore.png" },
  { name: "Titanium Ore", type: "ore_vein", sortOrder: 70, colorStart: "#d3c4ff", colorEnd: "#6153c5", iconUrl: "/icons/resources/titanium-ore.png" },
  { name: "Stone", type: "ore_vein", sortOrder: 80, colorStart: "#e2dfcf", colorEnd: "#7c725c", iconUrl: "/icons/resources/stone.png" },
  { name: "Kimberlite Ore", type: "ore_vein", sortOrder: 90, colorStart: "#c7f9ff", colorEnd: "#387e95", iconUrl: "/icons/resources/kimberlite-ore.png" },
  { name: "Water", type: "liquid_pump", sortOrder: 100, colorStart: "#89cfff", colorEnd: "#1f5cc6", iconUrl: "/icons/resources/water.png" },
  { name: "Sulfuric Acid", type: "liquid_pump", sortOrder: 110, colorStart: "#f3ff92", colorEnd: "#8b9133", iconUrl: "/icons/resources/sulfuric-acid.png" },
  { name: "Crude Oil", type: "oil_extractor", sortOrder: 120, colorStart: "#e8a065", colorEnd: "#6b2a21", iconUrl: "/icons/resources/crude-oil.png" },
  { name: "Hydrogen", type: "gas_giant_output", sortOrder: 130, colorStart: "#fbfbff", colorEnd: "#87acff", iconUrl: "/icons/resources/hydrogen.png", fuelValueMj: 9 },
  { name: "Deuterium", type: "gas_giant_output", sortOrder: 140, colorStart: "#ffe6a4", colorEnd: "#c28d23", iconUrl: "/icons/resources/deuterium.png", fuelValueMj: 9 },
  { name: "Fire Ice", type: "gas_giant_output", sortOrder: 150, colorStart: "#d8ffff", colorEnd: "#37afdb", iconUrl: "/icons/resources/fire-ice.png", fuelValueMj: 4.8 },
];

function generateId() {
  return randomUUID();
}

function runStatement(sql: string, ...params: unknown[]) {
  db.prepare(sql).run(...params);
}

function readRows<T>(sql: string, ...params: unknown[]) {
  return db.prepare(sql).all(...params) as T[];
}

function readRow<T>(sql: string, ...params: unknown[]) {
  return db.prepare(sql).get(...params) as T | undefined;
}

function ensureColumn(tableName: string, columnName: string, definition: string) {
  const existingColumns = readRows<{ name: string }>(`PRAGMA table_info(${tableName})`);
  if (existingColumns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

export function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS resource_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      icon_url TEXT,
      color_start TEXT NOT NULL,
      color_end TEXT NOT NULL,
      fuel_value_mj REAL,
      is_seeded INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS solar_systems (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS planets (
      id TEXT PRIMARY KEY,
      solar_system_id TEXT NOT NULL,
      name TEXT NOT NULL,
      planet_type TEXT NOT NULL,
      FOREIGN KEY (solar_system_id) REFERENCES solar_systems(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS project_goals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (resource_id) REFERENCES resource_definitions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ore_veins (
      id TEXT PRIMARY KEY,
      planet_id TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (planet_id) REFERENCES planets(id) ON DELETE CASCADE,
      FOREIGN KEY (resource_id) REFERENCES resource_definitions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ore_vein_miners (
      id TEXT PRIMARY KEY,
      ore_vein_id TEXT NOT NULL,
      miner_type TEXT NOT NULL,
      covered_nodes INTEGER NOT NULL,
      advanced_speed_percent INTEGER,
      FOREIGN KEY (ore_vein_id) REFERENCES ore_veins(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS liquid_sites (
      id TEXT PRIMARY KEY,
      planet_id TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      pump_count INTEGER NOT NULL,
      created_at TEXT,
      FOREIGN KEY (planet_id) REFERENCES planets(id) ON DELETE CASCADE,
      FOREIGN KEY (resource_id) REFERENCES resource_definitions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS oil_extractors (
      id TEXT PRIMARY KEY,
      planet_id TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      oil_per_second REAL NOT NULL,
      created_at TEXT,
      FOREIGN KEY (planet_id) REFERENCES planets(id) ON DELETE CASCADE,
      FOREIGN KEY (resource_id) REFERENCES resource_definitions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS gas_giant_sites (
      id TEXT PRIMARY KEY,
      planet_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      collector_count INTEGER NOT NULL,
      created_at TEXT,
      FOREIGN KEY (planet_id) REFERENCES planets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS gas_giant_outputs (
      id TEXT PRIMARY KEY,
      gas_giant_site_id TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      rate_per_second REAL NOT NULL,
      FOREIGN KEY (gas_giant_site_id) REFERENCES gas_giant_sites(id) ON DELETE CASCADE,
      FOREIGN KEY (resource_id) REFERENCES resource_definitions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_planets_solar_system_id ON planets(solar_system_id);
    CREATE INDEX IF NOT EXISTS idx_project_goals_project_id ON project_goals(project_id);
    CREATE INDEX IF NOT EXISTS idx_project_goals_resource_id ON project_goals(resource_id);
    CREATE INDEX IF NOT EXISTS idx_ore_veins_planet_id ON ore_veins(planet_id);
    CREATE INDEX IF NOT EXISTS idx_ore_veins_resource_id ON ore_veins(resource_id);
    CREATE INDEX IF NOT EXISTS idx_ore_vein_miners_ore_vein_id ON ore_vein_miners(ore_vein_id);
    CREATE INDEX IF NOT EXISTS idx_liquid_sites_planet_id ON liquid_sites(planet_id);
    CREATE INDEX IF NOT EXISTS idx_liquid_sites_resource_id ON liquid_sites(resource_id);
    CREATE INDEX IF NOT EXISTS idx_oil_extractors_planet_id ON oil_extractors(planet_id);
    CREATE INDEX IF NOT EXISTS idx_oil_extractors_resource_id ON oil_extractors(resource_id);
    CREATE INDEX IF NOT EXISTS idx_gas_giant_sites_planet_id ON gas_giant_sites(planet_id);
    CREATE INDEX IF NOT EXISTS idx_gas_giant_outputs_site_id ON gas_giant_outputs(gas_giant_site_id);
    CREATE INDEX IF NOT EXISTS idx_gas_giant_outputs_resource_id ON gas_giant_outputs(resource_id);
  `);

  ensureColumn("liquid_sites", "created_at", "TEXT");
  ensureColumn("oil_extractors", "created_at", "TEXT");
  ensureColumn("gas_giant_sites", "created_at", "TEXT");
  db.exec(`
    UPDATE liquid_sites SET created_at = COALESCE(NULLIF(created_at, ''), datetime('now')) WHERE created_at IS NULL OR created_at = '';
    UPDATE oil_extractors SET created_at = COALESCE(NULLIF(created_at, ''), datetime('now')) WHERE created_at IS NULL OR created_at = '';
    UPDATE gas_giant_sites SET created_at = COALESCE(NULLIF(created_at, ''), datetime('now')) WHERE created_at IS NULL OR created_at = '';
  `);

  seedDefaults();
  migrateLiquidGoalsToItemsPerMinute();
}

function seedDefaults() {
  for (const resource of seededResources) {
    runStatement(
      `
        INSERT INTO resource_definitions (
          id,
          name,
          type,
          icon_url,
          color_start,
          color_end,
          fuel_value_mj,
          is_seeded,
          sort_order
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, 1, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM resource_definitions WHERE name = ?
        )
      `,
      generateId(),
      resource.name,
      resource.type,
      resource.iconUrl ?? null,
      resource.colorStart,
      resource.colorEnd,
      resource.fuelValueMj ?? null,
      resource.sortOrder,
      resource.name,
    );

    runStatement(
      `
        UPDATE resource_definitions
        SET
          type = ?,
          icon_url = ?,
          color_start = ?,
          color_end = ?,
          fuel_value_mj = ?,
          is_seeded = 1,
          sort_order = ?
        WHERE name = ?
      `,
      resource.type,
      resource.iconUrl ?? null,
      resource.colorStart,
      resource.colorEnd,
      resource.fuelValueMj ?? null,
      resource.sortOrder,
      resource.name,
    );
  }

  const settingsDefaults = new Map<string, string>([
    ["currentSolarSystemId", ""],
    ["currentPlanetId", ""],
    ["miningResearchBonusPercent", "0"],
  ]);

  for (const [key, value] of settingsDefaults.entries()) {
    runStatement(
      `
        INSERT INTO app_settings (key, value)
        SELECT ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = ?)
      `,
      key,
      value,
      key,
    );
  }

  const hasProjects = readRow<{ count: number }>("SELECT COUNT(*) as count FROM projects");
  if ((hasProjects?.count ?? 0) > 0) {
    return;
  }

  const starterProjectId = generateId();
  runStatement(
    "INSERT INTO projects (id, name, notes, is_active, sort_order) VALUES (?, ?, ?, 1, 1)",
    starterProjectId,
    "Current Factory Plan",
    "Seeded from the current Dyson Sphere Program extraction targets.",
  );

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

  for (const [name, quantity] of starterGoals.entries()) {
    const resource = readRow<{ id: string }>("SELECT id FROM resource_definitions WHERE name = ?", name);
    if (!resource) {
      continue;
    }

    runStatement(
      "INSERT INTO project_goals (id, project_id, resource_id, quantity) VALUES (?, ?, ?, ?)",
      generateId(),
      starterProjectId,
      resource.id,
      quantity,
    );
  }
}

function migrateLiquidGoalsToItemsPerMinute() {
  const migrationKey = "liquidGoalsMigratedToItemsPerMinute";
  const migrationState = readRow<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", migrationKey);
  if (migrationState?.value === "1") {
    return;
  }

  db.exec("BEGIN");

  try {
    runStatement(
      `
        UPDATE project_goals
        SET quantity = quantity * 50
        WHERE resource_id IN (
          SELECT id
          FROM resource_definitions
          WHERE type = 'liquid_pump'
        )
      `,
    );

    setSetting(migrationKey, "1");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function getSettingsRecord() {
  const rows = readRows<{ key: string; value: string }>("SELECT key, value FROM app_settings");
  return rows.reduce<Record<string, string>>((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

export function setSetting(key: string, value: string) {
  runStatement(
    `
      INSERT INTO app_settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `,
    key,
    value,
  );
}

export function getResourceById(id: string) {
  return readRow<{ id: string; type: ResourceType; name: string }>(
    "SELECT id, type, name FROM resource_definitions WHERE id = ?",
    id,
  );
}

export function getPlanetById(id: string) {
  return readRow<{ id: string; planet_type: PlanetType; solar_system_id: string }>(
    "SELECT id, planet_type, solar_system_id FROM planets WHERE id = ?",
    id,
  );
}

export function createResource(name: string, type: ResourceType) {
  const sortOrder =
    readRow<{ nextValue: number }>("SELECT COALESCE(MAX(sort_order), 0) + 10 AS nextValue FROM resource_definitions")
      ?.nextValue ?? 10;

  runStatement(
    `
      INSERT INTO resource_definitions (
        id, name, type, icon_url, color_start, color_end, fuel_value_mj, is_seeded, sort_order
      ) VALUES (?, ?, ?, NULL, ?, ?, NULL, 0, ?)
    `,
    generateId(),
    name,
    type,
    "#8ee5ff",
    "#305f8f",
    sortOrder,
  );
}

export function createSolarSystem(name: string) {
  const id = generateId();
  runStatement("INSERT INTO solar_systems (id, name) VALUES (?, ?)", id, name);
  return id;
}

export function createPlanet(input: { solarSystemId: string; name: string; planetType: PlanetType }) {
  const id = generateId();
  runStatement(
    "INSERT INTO planets (id, solar_system_id, name, planet_type) VALUES (?, ?, ?, ?)",
    id,
    input.solarSystemId,
    input.name,
    input.planetType,
  );
  return id;
}

export function createProject(input: { name: string; notes: string }) {
  const sortOrder = readRow<{ nextValue: number }>("SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextValue FROM projects")
    ?.nextValue ?? 1;
  const id = generateId();
  runStatement(
    "INSERT INTO projects (id, name, notes, is_active, sort_order) VALUES (?, ?, ?, 1, ?)",
    id,
    input.name,
    input.notes,
    sortOrder,
  );
  return id;
}

export function updateProject(projectId: string, input: { name: string; notes: string; isActive: boolean }) {
  runStatement(
    "UPDATE projects SET name = ?, notes = ?, is_active = ? WHERE id = ?",
    input.name,
    input.notes,
    input.isActive ? 1 : 0,
    projectId,
  );
}

export function replaceProjectGoals(projectId: string, goals: Array<{ resourceId: string; quantity: number }>) {
  runStatement("DELETE FROM project_goals WHERE project_id = ?", projectId);

  for (const goal of goals.filter((item) => item.quantity > 0)) {
    runStatement(
      "INSERT INTO project_goals (id, project_id, resource_id, quantity) VALUES (?, ?, ?, ?)",
      generateId(),
      projectId,
      goal.resourceId,
      goal.quantity,
    );
  }
}

export function createOreVein(input: {
  planetId: string;
  resourceId: string;
  label: string;
  miners: Array<{ minerType: MinerType; coveredNodes: number; advancedSpeedPercent?: number }>;
}) {
  const oreVeinId = generateId();
  runStatement(
    "INSERT INTO ore_veins (id, planet_id, resource_id, label, created_at) VALUES (?, ?, ?, ?, ?)",
    oreVeinId,
    input.planetId,
    input.resourceId,
    input.label,
    new Date().toISOString(),
  );

  for (const miner of input.miners) {
    runStatement(
      `
        INSERT INTO ore_vein_miners (id, ore_vein_id, miner_type, covered_nodes, advanced_speed_percent)
        VALUES (?, ?, ?, ?, ?)
      `,
      generateId(),
      oreVeinId,
      miner.minerType,
      miner.coveredNodes,
      miner.minerType === "advanced" ? miner.advancedSpeedPercent ?? 100 : null,
    );
  }
}

export function createLiquidSite(input: {
  planetId: string;
  resourceId: string;
  label: string;
  pumpCount: number;
}) {
  runStatement(
    "INSERT INTO liquid_sites (id, planet_id, resource_id, label, pump_count, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    generateId(),
    input.planetId,
    input.resourceId,
    input.label,
    input.pumpCount,
    new Date().toISOString(),
  );
}

export function createOilExtractor(input: {
  planetId: string;
  resourceId: string;
  label: string;
  oilPerSecond: number;
}) {
  runStatement(
    "INSERT INTO oil_extractors (id, planet_id, resource_id, label, oil_per_second, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    generateId(),
    input.planetId,
    input.resourceId,
    input.label,
    input.oilPerSecond,
    new Date().toISOString(),
  );
}

export function createGasGiantSite(input: {
  planetId: string;
  label: string;
  collectorCount: number;
  outputs: Array<{ resourceId: string; ratePerSecond: number }>;
}) {
  const siteId = generateId();
  runStatement(
    "INSERT INTO gas_giant_sites (id, planet_id, label, collector_count, created_at) VALUES (?, ?, ?, ?, ?)",
    siteId,
    input.planetId,
    input.label,
    input.collectorCount,
    new Date().toISOString(),
  );

  for (const output of input.outputs) {
    runStatement(
      "INSERT INTO gas_giant_outputs (id, gas_giant_site_id, resource_id, rate_per_second) VALUES (?, ?, ?, ?)",
      generateId(),
      siteId,
      output.resourceId,
      output.ratePerSecond,
    );
  }
}

export function deleteById(tableName: string, id: string) {
  runStatement(`DELETE FROM ${tableName} WHERE id = ?`, id);
}

export function moveEntryToPlanet(tableName: "ore_veins" | "liquid_sites" | "oil_extractors" | "gas_giant_sites", id: string, planetId: string) {
  runStatement(`UPDATE ${tableName} SET planet_id = ? WHERE id = ?`, planetId, id);
}

export function deletePlanet(planetId: string) {
  const settings = getSettingsRecord();

  db.exec("BEGIN");

  try {
    runStatement("DELETE FROM planets WHERE id = ?", planetId);

    if (settings.currentPlanetId === planetId) {
      setSetting("currentPlanetId", "");
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function deleteSolarSystem(solarSystemId: string) {
  const settings = getSettingsRecord();

  db.exec("BEGIN");

  try {
    runStatement("DELETE FROM solar_systems WHERE id = ?", solarSystemId);

    if (settings.currentSolarSystemId === solarSystemId) {
      setSetting("currentSolarSystemId", "");
      setSetting("currentPlanetId", "");
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function exportSnapshot() {
  return {
    resources: readRows<Record<string, unknown>>("SELECT * FROM resource_definitions ORDER BY sort_order, name"),
    solarSystems: readRows<Record<string, unknown>>("SELECT * FROM solar_systems ORDER BY name"),
    planets: readRows<Record<string, unknown>>("SELECT * FROM planets ORDER BY name"),
    projects: readRows<Record<string, unknown>>("SELECT * FROM projects ORDER BY sort_order, name"),
    projectGoals: readRows<Record<string, unknown>>("SELECT * FROM project_goals"),
    oreVeins: readRows<Record<string, unknown>>("SELECT * FROM ore_veins ORDER BY created_at DESC"),
    oreVeinMiners: readRows<Record<string, unknown>>("SELECT * FROM ore_vein_miners"),
    liquidSites: readRows<Record<string, unknown>>("SELECT * FROM liquid_sites ORDER BY created_at DESC"),
    oilExtractors: readRows<Record<string, unknown>>("SELECT * FROM oil_extractors ORDER BY created_at DESC"),
    gasGiantSites: readRows<Record<string, unknown>>("SELECT * FROM gas_giant_sites ORDER BY created_at DESC"),
    gasGiantOutputs: readRows<Record<string, unknown>>("SELECT * FROM gas_giant_outputs"),
    settings: getSettingsRecord(),
  };
}

export function importSnapshot(snapshot: ReturnType<typeof exportSnapshot>) {
  db.exec("BEGIN");

  try {
    db.exec(`
      DELETE FROM gas_giant_outputs;
      DELETE FROM gas_giant_sites;
      DELETE FROM oil_extractors;
      DELETE FROM liquid_sites;
      DELETE FROM ore_vein_miners;
      DELETE FROM ore_veins;
      DELETE FROM project_goals;
      DELETE FROM projects;
      DELETE FROM planets;
      DELETE FROM solar_systems;
      DELETE FROM resource_definitions;
      DELETE FROM app_settings;
    `);

    for (const row of snapshot.resources) {
      runStatement(
        `
          INSERT INTO resource_definitions (
            id, name, type, icon_url, color_start, color_end, fuel_value_mj, is_seeded, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        row.id,
        row.name,
        row.type,
        row.icon_url ?? null,
        row.color_start,
        row.color_end,
        row.fuel_value_mj ?? null,
        row.is_seeded,
        row.sort_order,
      );
    }

    for (const row of snapshot.solarSystems) {
      runStatement("INSERT INTO solar_systems (id, name) VALUES (?, ?)", row.id, row.name);
    }

    for (const row of snapshot.planets) {
      runStatement(
        "INSERT INTO planets (id, solar_system_id, name, planet_type) VALUES (?, ?, ?, ?)",
        row.id,
        row.solar_system_id,
        row.name,
        row.planet_type,
      );
    }

    for (const row of snapshot.projects) {
      runStatement(
        "INSERT INTO projects (id, name, notes, is_active, sort_order) VALUES (?, ?, ?, ?, ?)",
        row.id,
        row.name,
        row.notes,
        row.is_active,
        row.sort_order,
      );
    }

    for (const row of snapshot.projectGoals) {
      runStatement(
        "INSERT INTO project_goals (id, project_id, resource_id, quantity) VALUES (?, ?, ?, ?)",
        row.id,
        row.project_id,
        row.resource_id,
        row.quantity,
      );
    }

    for (const row of snapshot.oreVeins) {
      runStatement(
        "INSERT INTO ore_veins (id, planet_id, resource_id, label, created_at) VALUES (?, ?, ?, ?, ?)",
        row.id,
        row.planet_id,
        row.resource_id,
        row.label,
        row.created_at,
      );
    }

    for (const row of snapshot.oreVeinMiners) {
      runStatement(
        `
          INSERT INTO ore_vein_miners (id, ore_vein_id, miner_type, covered_nodes, advanced_speed_percent)
          VALUES (?, ?, ?, ?, ?)
        `,
        row.id,
        row.ore_vein_id,
        row.miner_type,
        row.covered_nodes,
        row.advanced_speed_percent ?? null,
      );
    }

    for (const row of snapshot.liquidSites) {
      runStatement(
        "INSERT INTO liquid_sites (id, planet_id, resource_id, label, pump_count, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        row.id,
        row.planet_id,
        row.resource_id,
        row.label,
        row.pump_count,
        row.created_at ?? new Date().toISOString(),
      );
    }

    for (const row of snapshot.oilExtractors) {
      runStatement(
        "INSERT INTO oil_extractors (id, planet_id, resource_id, label, oil_per_second, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        row.id,
        row.planet_id,
        row.resource_id,
        row.label,
        row.oil_per_second,
        row.created_at ?? new Date().toISOString(),
      );
    }

    for (const row of snapshot.gasGiantSites) {
      runStatement(
        "INSERT INTO gas_giant_sites (id, planet_id, label, collector_count, created_at) VALUES (?, ?, ?, ?, ?)",
        row.id,
        row.planet_id,
        row.label,
        row.collector_count,
        row.created_at ?? new Date().toISOString(),
      );
    }

    for (const row of snapshot.gasGiantOutputs) {
      runStatement(
        "INSERT INTO gas_giant_outputs (id, gas_giant_site_id, resource_id, rate_per_second) VALUES (?, ?, ?, ?)",
        row.id,
        row.gas_giant_site_id,
        row.resource_id,
        row.rate_per_second,
      );
    }

    for (const [key, value] of Object.entries(snapshot.settings)) {
      runStatement("INSERT INTO app_settings (key, value) VALUES (?, ?)", key, String(value ?? ""));
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
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

export function getBootstrapData() {
  const snapshot = exportSnapshot();
  const settings = snapshot.settings;
  const miningResearchBonusPercent = Number(settings.miningResearchBonusPercent ?? "0");

  const oreVeinById = new Map(snapshot.oreVeins.map((item) => [item.id as string, item]));
  const gasSiteById = new Map(snapshot.gasGiantSites.map((item) => [item.id as string, item]));
  const resourceById = new Map(snapshot.resources.map((resource) => [resource.id as string, resource]));
  const activeProjectIds = new Set(
    snapshot.projects.filter((project) => Number(project.is_active) === 1).map((project) => project.id as string),
  );
  const goalTotals = new Map<string, number>();
  const aggregates = new Map(
    snapshot.resources.map((resource) => [
      resource.id as string,
      {
        supplyMetric: 0,
        supplyPerMinute: 0,
        supplyPerSecond: 0,
        placementIds: new Set<string>(),
      },
    ]),
  );

  for (const goal of snapshot.projectGoals) {
    if (!activeProjectIds.has(goal.project_id as string)) {
      continue;
    }

    const currentValue = goalTotals.get(goal.resource_id as string) ?? 0;
    goalTotals.set(goal.resource_id as string, currentValue + Number(goal.quantity));
  }

  for (const miner of snapshot.oreVeinMiners) {
    const parentVein = oreVeinById.get(miner.ore_vein_id as string);
    if (!parentVein) {
      continue;
    }

    const resourceId = parentVein.resource_id as string;
    const aggregate = aggregates.get(resourceId);
    if (!aggregate) {
      continue;
    }

    const supplyPerMinute =
      miner.miner_type === "advanced"
        ? getAdvancedMinerOutputPerMinute(
            Number(miner.covered_nodes),
            Number(miner.advanced_speed_percent ?? 100),
            miningResearchBonusPercent,
          )
        : getRegularMinerOutputPerMinute(Number(miner.covered_nodes), miningResearchBonusPercent);

    aggregate.placementIds.add(parentVein.id as string);
    aggregate.supplyPerMinute += supplyPerMinute;
    aggregate.supplyPerSecond = aggregate.supplyPerMinute / 60;
    aggregate.supplyMetric = aggregate.supplyPerMinute / 30;
  }

  for (const site of snapshot.liquidSites) {
    const resourceId = site.resource_id as string;
    const aggregate = aggregates.get(resourceId);
    if (!aggregate) {
      continue;
    }

    const supplyPerMinute = getPumpOutputPerMinute(Number(site.pump_count), miningResearchBonusPercent);
    aggregate.placementIds.add(site.id as string);
    aggregate.supplyPerMinute += supplyPerMinute;
    aggregate.supplyPerSecond = aggregate.supplyPerMinute / 60;
    aggregate.supplyMetric = aggregate.supplyPerMinute;
  }

  for (const extractor of snapshot.oilExtractors) {
    const resourceId = extractor.resource_id as string;
    const aggregate = aggregates.get(resourceId);
    if (!aggregate) {
      continue;
    }

    aggregate.placementIds.add(extractor.id as string);
    aggregate.supplyPerSecond += getOilOutputPerSecond(Number(extractor.oil_per_second));
    aggregate.supplyPerMinute = aggregate.supplyPerSecond * 60;
    aggregate.supplyMetric = aggregate.supplyPerMinute;
  }

  for (const site of snapshot.gasGiantSites) {
    const siteOutputs = snapshot.gasGiantOutputs.filter((output) => output.gas_giant_site_id === site.id);
    const trueBoost = getOrbitalCollectorTrueBoost(
      siteOutputs.map((output) => ({
        ratePerSecond: Number(output.rate_per_second),
        fuelValueMj: Number(resourceById.get(output.resource_id as string)?.fuel_value_mj ?? 0),
      })),
      miningResearchBonusPercent,
    );

    for (const output of siteOutputs) {
      const parentSite = gasSiteById.get(output.gas_giant_site_id as string);
      if (!parentSite) {
        continue;
      }

      const resourceId = output.resource_id as string;
      const aggregate = aggregates.get(resourceId);
      if (!aggregate) {
        continue;
      }

      const collectorCount = Number(parentSite.collector_count ?? 0);
      aggregate.placementIds.add(parentSite.id as string);
      aggregate.supplyPerSecond += Number(output.rate_per_second) * trueBoost * collectorCount;
      aggregate.supplyPerMinute = aggregate.supplyPerSecond * 60;
      aggregate.supplyMetric = aggregate.supplyPerMinute;
    }
  }

  const resourceSummaries = snapshot.resources.map((resource) => {
    const resourceId = resource.id as string;
    const resourceType = resource.type as ResourceType;
    const aggregate = aggregates.get(resourceId);
    const goalQuantity = goalTotals.get(resourceId) ?? 0;

    return {
      resourceId,
      name: resource.name,
      type: resourceType,
      iconUrl: resource.icon_url,
      colorStart: resource.color_start,
      colorEnd: resource.color_end,
      fuelValueMj: resource.fuel_value_mj,
      goalUnitLabel: resourceGoalUnit(resourceType),
      goalQuantity,
      supplyMetric: aggregate?.supplyMetric ?? 0,
      supplyPerMinute: aggregate?.supplyPerMinute ?? 0,
      supplyPerSecond: aggregate?.supplyPerSecond ?? 0,
      placementCount: aggregate?.placementIds.size ?? 0,
    };
  });

  return {
    ...snapshot,
    settings: {
      currentSolarSystemId: settings.currentSolarSystemId || null,
      currentPlanetId: settings.currentPlanetId || null,
      miningResearchBonusPercent,
    },
    summary: {
      totalResourcesTracked: resourceSummaries.length,
      activeProjectCount: activeProjectIds.size,
      solarSystemCount: snapshot.solarSystems.length,
      planetCount: snapshot.planets.length,
      resourceSummaries,
    },
  };
}
