import type { BootstrapData, MinerType, ProjectImportedItem, ResourceType } from "../lib/types";

export type SavePlanetPayload = {
  planetId: string;
  name?: string;
  extractionOutboundIlsCount?: number | null | "";
  extractionOutboundIlsOverrides?: Array<{ resourceId: string; ilsCount: number }>;
};

export type SaveProjectPayload = {
  projectId: string;
  name?: string;
  notes?: string;
  isActive?: boolean;
  goals?: Array<{ resourceId: string; quantity: number }>;
  importedItems?: Array<Omit<ProjectImportedItem, "id" | "project_id">>;
};

export type SaveProductionSitePayload = {
  projectId?: string;
  productionSiteId?: string;
  itemKey: string;
  throughputPerMinute: number;
  outboundIlsCount: number;
  isFinished: boolean;
  solarSystemId: string;
  planetId: string;
  sameSystemWarpItemKeys: string[];
};

export type StoreCommand =
  | { type: "resource/create"; name: string; resourceType: ResourceType }
  | { type: "system/create"; name: string }
  | { type: "system/update"; systemId: string; name: string }
  | { type: "system/delete"; systemId: string }
  | { type: "planet/create"; solarSystemId: string; name: string; planetType: "solid" | "gas_giant" }
  | ({ type: "planet/update" } & SavePlanetPayload)
  | { type: "planet/delete"; planetId: string }
  | { type: "settings/update"; settings: Partial<BootstrapData["settings"]> }
  | { type: "cluster/import"; clusterAddress: string }
  | { type: "project/create"; name: string; notes: string; goals?: Array<{ resourceId: string; quantity: number }>; importedItems?: Array<Omit<ProjectImportedItem, "id" | "project_id">> }
  | ({ type: "project/update" } & SaveProjectPayload)
  | { type: "project/goals/replace"; projectId: string; goals: Array<{ resourceId: string; quantity: number }> }
  | ({ type: "production-site/save" } & SaveProductionSitePayload)
  | { type: "production-site/delete"; productionSiteId: string }
  | { type: "ore-vein/create"; planetId: string; resourceId: string; label: string; miners: Array<{ minerType: MinerType; coveredNodes: number; advancedSpeedPercent?: number }> }
  | { type: "liquid/create"; planetId: string; resourceId: string; label: string; pumpCount: number }
  | { type: "oil-extractor/create"; planetId: string; resourceId: string; label: string; oilPerSecond: number }
  | { type: "gas-giant/create"; planetId: string; label: string; collectorCount: number; outputs: Array<{ resourceId: string; ratePerSecond: number }> }
  | { type: "transport-route/save"; routeId?: string; sourceSystemId: string; destinationSystemId: string; resourceId: string; throughputPerMinute: number }
  | { type: "transport-route/delete"; routeId: string }
  | { type: "ore-vein/delete"; oreVeinId: string }
  | { type: "liquid/delete"; liquidSiteId: string }
  | { type: "oil-extractor/delete"; oilExtractorId: string }
  | { type: "gas-giant/delete"; gasGiantSiteId: string }
  | { type: "ore-vein/move"; oreVeinId: string; planetId: string }
  | { type: "liquid/move"; liquidSiteId: string; planetId: string }
  | { type: "oil-extractor/move"; oilExtractorId: string; planetId: string }
  | { type: "gas-giant/move"; gasGiantSiteId: string; planetId: string };
