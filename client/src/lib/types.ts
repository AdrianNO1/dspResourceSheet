export type ResourceType = "ore_vein" | "liquid_pump" | "oil_extractor" | "gas_giant_output";
export type PlanetType = "solid" | "gas_giant";
export type MinerType = "regular" | "advanced";

export type ResourceDefinition = {
  id: string;
  name: string;
  type: ResourceType;
  icon_url: string | null;
  color_start: string;
  color_end: string;
  fuel_value_mj: number | null;
  is_seeded: number;
  sort_order: number;
};

export type SolarSystem = {
  id: string;
  name: string;
};

export type SystemDistance = {
  id: string;
  system_a_id: string;
  system_b_id: string;
  distance_ly: number;
};

export type Planet = {
  id: string;
  solar_system_id: string;
  name: string;
  planet_type: PlanetType;
};

export type Project = {
  id: string;
  name: string;
  notes: string;
  is_active: number;
  sort_order: number;
};

export type ProjectGoal = {
  id: string;
  project_id: string;
  resource_id: string;
  quantity: number;
};

export type OreVein = {
  id: string;
  planet_id: string;
  resource_id: string;
  label: string;
  created_at: string;
};

export type OreVeinMiner = {
  id: string;
  ore_vein_id: string;
  miner_type: MinerType;
  covered_nodes: number;
  advanced_speed_percent: number | null;
};

export type LiquidSite = {
  id: string;
  planet_id: string;
  resource_id: string;
  label: string;
  pump_count: number;
  created_at: string;
};

export type OilExtractor = {
  id: string;
  planet_id: string;
  resource_id: string;
  label: string;
  oil_per_second: number;
  created_at: string;
};

export type GasGiantSite = {
  id: string;
  planet_id: string;
  label: string;
  collector_count: number;
  created_at: string;
};

export type GasGiantOutput = {
  id: string;
  gas_giant_site_id: string;
  resource_id: string;
  rate_per_second: number;
};

export type TransportRoute = {
  id: string;
  source_system_id: string;
  destination_system_id: string;
  resource_id: string;
  throughput_per_minute: number;
  created_at: string;
};

export type ResourceSummary = {
  resourceId: string;
  name: string;
  type: ResourceType;
  iconUrl: string | null;
  colorStart: string;
  colorEnd: string;
  fuelValueMj: number | null;
  goalUnitLabel: string;
  goalQuantity: number;
  supplyMetric: number;
  supplyPerMinute: number;
  supplyPerSecond: number;
  placementCount: number;
};

export type BootstrapData = {
  resources: ResourceDefinition[];
  solarSystems: SolarSystem[];
  systemDistances: SystemDistance[];
  planets: Planet[];
  projects: Project[];
  projectGoals: ProjectGoal[];
  oreVeins: OreVein[];
  oreVeinMiners: OreVeinMiner[];
  liquidSites: LiquidSite[];
  oilExtractors: OilExtractor[];
  gasGiantSites: GasGiantSite[];
  gasGiantOutputs: GasGiantOutput[];
  transportRoutes: TransportRoute[];
  settings: {
    currentSolarSystemId: string | null;
    currentPlanetId: string | null;
    miningSpeedPercent: number;
    vesselCapacityItems: number;
    vesselSpeedLyPerSecond: number;
    vesselDockingSeconds: number;
    ilsStorageItems: number;
  };
  summary: {
    totalResourcesTracked: number;
    activeProjectCount: number;
    solarSystemCount: number;
    planetCount: number;
    resourceSummaries: ResourceSummary[];
  };
};
