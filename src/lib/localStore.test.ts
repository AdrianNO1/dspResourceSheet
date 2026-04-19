import { describe, expect, it } from "vitest";
import { generateClusterCatalog, parseClusterAddress } from "./dspCluster";
import { buildBootstrap, normalizeSnapshot } from "./localStore";

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
});
