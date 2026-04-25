import { describe, expect, it } from "vitest";
import { generateClusterCatalog, parseClusterAddress } from "./dspCluster";
import { buildBootstrap, normalizeSnapshot } from "./localStore";

function romanToInteger(value: string) {
  const values = new Map<string, number>([
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
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const current = values.get(value[index]?.toUpperCase() ?? "");
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

describe("normalizeSnapshot", () => {
  it("preserves backward compatibility by seeding defaults and normalizing missing fields", () => {
    const snapshot = normalizeSnapshot({
      resources: [],
      solarSystems: [{ id: "system-1", name: "Alpha" }],
      planets: [{ id: "planet-1", solar_system_id: "system-1", name: "Alpha I", planet_type: "solid" }],
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
    });

    expect(snapshot.resources.length).toBeGreaterThan(0);
    expect(snapshot.settings.miningSpeedPercent).toBe("100");
    expect(snapshot.planets[0]?.extraction_outbound_ils_count).toBeNull();
    expect(snapshot.planets[0]?.extraction_outbound_ils_overrides).toEqual([]);
  });

  it("deduplicates and validates extraction ILS overrides", () => {
    const snapshot = normalizeSnapshot({
      resources: [],
      solarSystems: [{ id: "system-1", name: "Alpha" }],
      planets: [{
        id: "planet-1",
        solar_system_id: "system-1",
        name: "Alpha I",
        planet_type: "solid",
        extraction_outbound_ils_overrides: [
          { resource_id: "ore-1", ils_count: 2 },
          { resource_id: "ore-1", ils_count: 5 },
          { resource_id: "", ils_count: 3 },
        ],
      }],
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
    });

    expect(snapshot.planets[0]?.extraction_outbound_ils_overrides).toEqual([
      { resource_id: "ore-1", ils_count: 5 },
    ]);
  });

  it("normalizes persisted production site line divisibility", () => {
    const snapshot = normalizeSnapshot({
      resources: [],
      solarSystems: [{ id: "system-1", name: "Alpha" }],
      planets: [{ id: "planet-1", solar_system_id: "system-1", name: "Alpha I", planet_type: "solid" }],
      projects: [{ id: "project-1", name: "Main", notes: "", is_active: 1, sort_order: 1 }],
      projectGoals: [],
      projectImportedItems: [],
      oreVeins: [],
      oreVeinMiners: [],
      liquidSites: [],
      oilExtractors: [],
      gasGiantSites: [],
      gasGiantOutputs: [],
      productionSites: [
        {
          id: "site-a",
          project_id: "project-1",
          item_key: "item-a",
          throughput_per_minute: 60,
          solar_system_id: "system-1",
          planet_id: "planet-1",
          outbound_ils_count: 0,
          same_system_warp_item_keys: [],
          is_finished: 1,
          created_at: "2026-04-18T08:00:00.000Z",
        },
        {
          id: "site-b",
          project_id: "project-1",
          item_key: "item-b",
          throughput_per_minute: 60,
          solar_system_id: "system-1",
          planet_id: "planet-1",
          outbound_ils_count: 0,
          line_divisible_by: 5,
          same_system_warp_item_keys: [],
          is_finished: 1,
          created_at: "2026-04-18T08:01:00.000Z",
        },
        {
          id: "site-c",
          project_id: "project-1",
          item_key: "item-c",
          throughput_per_minute: 60,
          solar_system_id: "system-1",
          planet_id: "planet-1",
          outbound_ils_count: 0,
          line_divisible_by: 1,
          same_system_warp_item_keys: [],
          is_finished: 1,
          created_at: "2026-04-18T08:02:00.000Z",
        },
      ],
      transportRoutes: [],
      settings: {},
    });

    expect(snapshot.productionSites.map((site) => site.line_divisible_by)).toEqual([null, 5, null]);
    expect(buildBootstrap(snapshot).productionSites[1]?.line_divisible_by).toBe(5);
  });

  it("surfaces a validation error when saved systems and planets do not match the imported seed", () => {
    const snapshot = normalizeSnapshot({
      resources: [],
      solarSystems: [{ id: "system-1", name: "Manual Alpha" }],
      planets: [{ id: "planet-1", solar_system_id: "system-1", name: "Manual Alpha I", planet_type: "solid" }],
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
      settings: {
        clusterAddress: "07198444-64-Z99-10",
      },
    });

    const bootstrap = buildBootstrap(snapshot);

    expect(bootstrap.summary.seedValidationError).toContain("07198444-64-Z99-10");
  });

  it("reports generated planet counts when the saved seed catalog matches", () => {
    const parsed = parseClusterAddress("07198444-64-Z99-10");
    const catalog = generateClusterCatalog(parsed);
    const solarSystems = catalog.map((system, index) => ({
      id: `system-${index}`,
      name: system.name,
      generated_x: system.x,
      generated_y: system.y,
      generated_z: system.z,
      generated_name_locked: 1,
      generated_from_cluster: 1,
    }));
    const systemIdByName = new Map(solarSystems.map((system) => [system.name, system.id]));
    const planets = catalog.flatMap((system) =>
      system.planets.map((planet, index) => ({
        id: `${system.name}-${index}`,
        solar_system_id: systemIdByName.get(system.name) ?? "",
        name: planet.name,
        planet_type: planet.planetType,
        extraction_outbound_ils_count: null,
        extraction_outbound_ils_overrides: [],
      })),
    );

    const snapshot = normalizeSnapshot({
      resources: [],
      solarSystems,
      planets,
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
      settings: {
        clusterAddress: parsed.clusterAddress,
      },
    });

    const bootstrap = buildBootstrap(snapshot);

    expect(bootstrap.summary.seedValidationError).toBeNull();
    expect(bootstrap.summary.generatedPlanetCount).toBeGreaterThan(0);
  });

  it("upgrades old saved planet names into the generated seed catalog on load", () => {
    const parsed = parseClusterAddress("07198444-64-Z99-10");
    const catalog = generateClusterCatalog(parsed);
    const birthSystem = catalog[0]!;
    const birthPlanet = birthSystem.planets[0]!;
    const displayedOrdinal = romanToInteger(birthPlanet.name.replace(`${birthSystem.name} `, "")) ?? 1;

    const snapshot = normalizeSnapshot({
      resources: [],
      solarSystems: [{ id: "system-1", name: birthSystem.name }],
      planets: [{
        id: "planet-1",
        solar_system_id: "system-1",
        name: `${birthSystem.name} ${displayedOrdinal}`,
        planet_type: "solid",
      }],
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
      settings: {
        clusterAddress: parsed.clusterAddress,
      },
    });

    const bootstrap = buildBootstrap(snapshot);

    expect(bootstrap.planets.some((planet) => planet.name === birthPlanet.name)).toBe(true);
    expect(bootstrap.summary.seedValidationError).toBeNull();
    expect(bootstrap.summary.generatedPlanetCount).toBeGreaterThan(0);
  });
});
