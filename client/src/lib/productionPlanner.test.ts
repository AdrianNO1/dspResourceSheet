import { describe, expect, it } from "vitest";
import { buildProductionPlanner } from "./productionPlanner";
import type { BootstrapData, ProjectImportedItem } from "./types";

function createImportedItem(overrides: Partial<ProjectImportedItem>): ProjectImportedItem {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    project_id: overrides.project_id ?? "project-1",
    item_key: overrides.item_key ?? "item-a",
    display_name: overrides.display_name ?? "Item A",
    imported_throughput_per_minute: overrides.imported_throughput_per_minute ?? 60,
    category: overrides.category ?? "crafted",
    machine_count: overrides.machine_count ?? 6,
    machine_label: overrides.machine_label ?? "Assembler",
    belt_label: overrides.belt_label ?? "Belt",
    belt_speed_per_minute: overrides.belt_speed_per_minute ?? 60,
    output_belts: overrides.output_belts ?? 1,
    dependencies: overrides.dependencies ?? [],
    recipe: overrides.recipe ?? "",
    outputs: overrides.outputs ?? "",
    throughput_per_minute: overrides.throughput_per_minute,
    sort_order: overrides.sort_order ?? 1,
  };
}

function createBaseData(): BootstrapData {
  return {
    resources: [],
    solarSystems: [{ id: "system-1", name: "Alpha", generated_x: 0, generated_y: 0, generated_z: 0, generated_name_locked: 0, generated_from_cluster: 0 }],
    systemDistances: [],
    planets: [{ id: "planet-1", solar_system_id: "system-1", name: "Alpha I", planet_type: "solid", extraction_outbound_ils_count: null, extraction_outbound_ils_overrides: [] }],
    projects: [{ id: "project-1", name: "Main", notes: "", is_active: 1, sort_order: 1 }],
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
      currentSolarSystemId: "system-1",
      currentPlanetId: "planet-1",
      miningSpeedPercent: 100,
      vesselCapacityItems: 1000,
      vesselSpeedLyPerSecond: 0.25,
      vesselCruisingSpeedMetersPerSecond: 2000,
      vesselDockingSeconds: 0,
      ilsStorageItems: 10000,
      clusterAddress: "",
      clusterSeed: null,
      clusterStarCount: null,
      clusterResourceCode: null,
      clusterSuffix: null,
    },
    summary: {
      totalResourcesTracked: 0,
      activeProjectCount: 1,
      solarSystemCount: 1,
      planetCount: 1,
      generatedSystemCount: 0,
      resourceSummaries: [],
      productionByProjectId: {},
    },
  };
}

describe("buildProductionPlanner", () => {
  it("does not count inactive crafted sites as available supply", () => {
    const itemA = createImportedItem({
      item_key: "item-a",
      display_name: "Item A",
      imported_throughput_per_minute: 60,
      dependencies: [],
    });
    const itemB = createImportedItem({
      id: "item-b-id",
      item_key: "item-b",
      display_name: "Item B",
      imported_throughput_per_minute: 60,
      dependencies: [{
        item_key: "item-a",
        display_name: "Item A",
        dependency_type: "crafted",
        per_unit_ratio: 1,
        imported_demand_per_minute: 60,
      }],
    });

    const data = createBaseData();
    data.projectImportedItems = [itemA, itemB];
    data.productionSites = [
      {
        id: "site-a",
        project_id: "project-1",
        item_key: "item-a",
        throughput_per_minute: 60,
        solar_system_id: "system-1",
        planet_id: "planet-1",
        outbound_ils_count: 0,
        same_system_warp_item_keys: [],
        is_finished: 0,
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
        same_system_warp_item_keys: [],
        is_finished: 1,
        created_at: "2026-04-18T08:01:00.000Z",
      },
    ];

    const planner = buildProductionPlanner(data, "project-1");
    const siteB = planner.siteViews.find((siteView) => siteView.site.id === "site-b");
    expect(siteB?.dependencies[0]?.coveragePerMinute).toBe(0);
    expect(siteB?.dependencies[0]?.shortagePerMinute).toBe(60);
  });
});
