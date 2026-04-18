import { describe, expect, it } from "vitest";
import { normalizeSnapshot } from "./localStore";

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
});
