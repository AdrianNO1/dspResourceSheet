import { describe, expect, it } from "vitest";
import { OIL_EXTRACTOR_POWER_MW, PUMP_POWER_MW, REGULAR_MINER_POWER_MW } from "../lib/dspMath";
import type { BootstrapData } from "../lib/types";
import {
  buildLedgerView,
  buildMapView,
  buildOverviewView,
  buildProjectsView,
  buildWorkspaceLookups,
} from "./workspaceQueries";

function createBootstrap(): BootstrapData {
  return {
    resources: [
      {
        id: "iron",
        name: "Iron Ore",
        type: "ore_vein",
        icon_url: null,
        color_start: "#111111",
        color_end: "#222222",
        fuel_value_mj: null,
        is_seeded: 1,
        sort_order: 1,
      },
      {
        id: "oil",
        name: "Crude Oil",
        type: "oil_extractor",
        icon_url: null,
        color_start: "#333333",
        color_end: "#444444",
        fuel_value_mj: null,
        is_seeded: 1,
        sort_order: 2,
      },
      {
        id: "water",
        name: "Water",
        type: "liquid_pump",
        icon_url: null,
        color_start: "#555555",
        color_end: "#666666",
        fuel_value_mj: null,
        is_seeded: 1,
        sort_order: 3,
      },
    ],
    solarSystems: [
      {
        id: "alpha",
        name: "Alpha",
        generated_x: 0,
        generated_y: 0,
        generated_z: 0,
        generated_name_locked: 0,
        generated_from_cluster: 1,
      },
      {
        id: "beta",
        name: "Beta",
        generated_x: 3,
        generated_y: 4,
        generated_z: 0,
        generated_name_locked: 0,
        generated_from_cluster: 1,
      },
      {
        id: "gamma",
        name: "Gamma",
        generated_x: null,
        generated_y: null,
        generated_z: null,
        generated_name_locked: 0,
        generated_from_cluster: 0,
      },
    ],
    systemDistances: [],
    planets: [
      {
        id: "alpha-1",
        solar_system_id: "alpha",
        name: "Alpha I",
        planet_type: "solid",
        extraction_outbound_ils_count: 2,
        extraction_outbound_ils_overrides: [],
      },
      {
        id: "beta-1",
        solar_system_id: "beta",
        name: "Beta I",
        planet_type: "solid",
        extraction_outbound_ils_count: 2,
        extraction_outbound_ils_overrides: [],
      },
      {
        id: "gamma-1",
        solar_system_id: "gamma",
        name: "Gamma I",
        planet_type: "solid",
        extraction_outbound_ils_count: null,
        extraction_outbound_ils_overrides: [],
      },
    ],
    projects: [{ id: "project-1", name: "Factory", notes: "", is_active: 1, sort_order: 1 }],
    projectGoals: [],
    projectImportedItems: [
      {
        id: "iron-ingot-template",
        project_id: "project-1",
        item_key: "iron-ingot",
        display_name: "Iron Ingot",
        imported_throughput_per_minute: 60,
        category: "crafted",
        machine_count: 1,
        machine_label: "arc-smelter",
        belt_label: "Conveyor Belt Mk.I",
        belt_speed_per_minute: 360,
        output_belts: 1,
        recipe: "iron-ingot",
        outputs: "Iron Ingot 1",
        dependencies: [],
        sort_order: 1,
      },
    ],
    oreVeins: [
      { id: "vein-alpha", planet_id: "alpha-1", resource_id: "iron", label: "Alpha iron", created_at: "2026-01-01T00:00:00.000Z" },
      { id: "vein-beta", planet_id: "beta-1", resource_id: "iron", label: "Beta iron", created_at: "2026-01-02T00:00:00.000Z" },
      { id: "vein-gamma", planet_id: "gamma-1", resource_id: "iron", label: "Gamma iron", created_at: "2026-01-03T00:00:00.000Z" },
    ],
    oreVeinMiners: [
      { id: "miner-alpha", ore_vein_id: "vein-alpha", miner_type: "regular", covered_nodes: 2, advanced_speed_percent: null },
      { id: "miner-beta", ore_vein_id: "vein-beta", miner_type: "regular", covered_nodes: 3, advanced_speed_percent: null },
      { id: "miner-gamma", ore_vein_id: "vein-gamma", miner_type: "regular", covered_nodes: 4, advanced_speed_percent: null },
    ],
    liquidSites: [
      { id: "water-alpha", planet_id: "alpha-1", resource_id: "water", label: "Water", pump_count: 2, created_at: "2026-01-04T00:00:00.000Z" },
    ],
    oilExtractors: [
      { id: "oil-alpha", planet_id: "alpha-1", resource_id: "oil", label: "Oil", oil_per_second: 1, created_at: "2026-01-05T00:00:00.000Z" },
    ],
    gasGiantSites: [],
    gasGiantOutputs: [],
    productionSites: [
      {
        id: "site-alpha",
        project_id: "project-1",
        item_key: "iron-ingot",
        throughput_per_minute: 60,
        solar_system_id: "alpha",
        planet_id: "alpha-1",
        outbound_ils_count: 0,
        same_system_warp_item_keys: [],
        is_finished: 1,
        created_at: "2026-01-06T00:00:00.000Z",
      },
    ],
    transportRoutes: [],
    settings: {
      currentSolarSystemId: "alpha",
      currentPlanetId: "alpha-1",
      recentSolarSystemId: "beta",
      recentPlanetId: "alpha-1",
      miningSpeedPercent: 100,
      vesselCapacityItems: 1000,
      vesselSpeedLyPerSecond: 1,
      vesselCruisingSpeedMetersPerSecond: 0,
      vesselDockingSeconds: 10,
      ilsStorageItems: 10000,
      clusterAddress: "",
      clusterSeed: null,
      clusterStarCount: null,
      clusterResourceCode: null,
      clusterSuffix: null,
    },
    summary: {
      totalResourcesTracked: 3,
      activeProjectCount: 0,
      solarSystemCount: 3,
      planetCount: 3,
      generatedSystemCount: 2,
      resourceSummaries: [
        {
          resourceId: "iron",
          name: "Iron Ore",
          type: "ore_vein",
          iconUrl: null,
          colorStart: "#111111",
          colorEnd: "#222222",
          fuelValueMj: null,
          goalUnitLabel: "items / min",
          goalQuantity: 0,
          supplyMetric: 9,
          supplyPerMinute: 270,
          supplyPerSecond: 4.5,
          placementCount: 3,
        },
      ],
      productionByProjectId: {},
    },
  };
}

describe("workspaceQueries", () => {
  it("builds overview transport rows with incomplete systems isolated", () => {
    const data = createBootstrap();
    const lookups = buildWorkspaceLookups(data, null);

    const view = buildOverviewView(data, lookups, "iron", "alpha", 180);

    expect(view.overviewTransportSystemRows).toHaveLength(3);
    expect(view.overviewTransportSystemRows.find((row) => row.systemId === "alpha")?.distanceLy).toBe(0);
    expect(view.overviewTransportSystemRows.find((row) => row.systemId === "beta")?.distanceLy).toBe(5);
    expect(view.overviewTransportIncompleteSystemCount).toBe(1);
    expect(view.overviewTransportRows.find((row) => row.systemId === "gamma")?.isComplete).toBe(false);
    expect(view.overviewTransportRows.find((row) => row.systemId === "beta")?.isComplete).toBe(true);
  });

  it("builds map stats from the extracted query layer", () => {
    const data = createBootstrap();
    const lookups = buildWorkspaceLookups(data, null);

    const view = buildMapView(data, lookups, { scope: "system", id: "alpha" });

    expect(view.mapSystemCards[0]?.solarSystem.id).toBe("beta");
    expect(view.mapSystemCards.find((card) => card.solarSystem.id === "alpha")).toMatchObject({
      extractionSiteCount: 3,
      activePlanetCount: 1,
    });
    expect(view.selectedMapExtractionSiteCount).toBe(3);
    expect(view.selectedMapExtraction.resourceRows).toHaveLength(3);
    expect(view.selectedMapTotalPowerDemandMw).toBeCloseTo(
      REGULAR_MINER_POWER_MW + (2 * PUMP_POWER_MW) + OIL_EXTRACTOR_POWER_MW + 0.36,
      6,
    );
  });

  it("builds project goal rows from the centralized query layer", () => {
    const data = createBootstrap();
    data.projects = [{ id: "project-1", name: "Mall", notes: "", is_active: 1, sort_order: 0 }];
    data.projectGoals = [{ id: "goal-1", project_id: "project-1", resource_id: "iron", quantity: 3 }];

    const lookups = buildWorkspaceLookups(data, "project-1");
    const view = buildProjectsView(data, lookups, "project-1");

    expect(view.selectedProjectGoalRows).toEqual([
      {
        id: "goal-1",
        resourceName: "Iron Ore",
        targetPerMinute: 90,
        supplyPerMinute: 270,
        coveragePercent: 100,
      },
    ]);
  });

  it("builds ledger groups and keeps the current planet first", () => {
    const data = createBootstrap();
    const lookups = buildWorkspaceLookups(data, null);

    const view = buildLedgerView(data, lookups, true);

    expect(view.ledgerGroups[0]?.planet.id).toBe("alpha-1");
    expect(view.ledgerGroups[0]?.powerDemandMw).toBeCloseTo(
      REGULAR_MINER_POWER_MW + (2 * PUMP_POWER_MW) + OIL_EXTRACTOR_POWER_MW,
      6,
    );
    expect(view.ledgerGroups.find((group) => group.planet.id === "beta-1")?.items).toHaveLength(1);
  });
});
