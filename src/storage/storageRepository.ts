import { exportSnapshotFromStore, getBootstrapFromStore, importSnapshotToStore, mutateStore } from "../lib/localStore";
import type { BootstrapData } from "../lib/types";
import type { StoreCommand } from "../application/storeCommands";

export type StorageRepository = {
  loadBootstrap: () => Promise<BootstrapData>;
  execute: (command: StoreCommand) => Promise<BootstrapData>;
  exportSnapshot: typeof exportSnapshotFromStore;
  importSnapshot: typeof importSnapshotToStore;
};

function executeStoreCommand(command: StoreCommand) {
  switch (command.type) {
    case "resource/create":
      return mutateStore("/api/resources", "POST", { name: command.name, type: command.resourceType });
    case "system/create":
      return mutateStore("/api/systems", "POST", { name: command.name });
    case "system/update":
      return mutateStore(`/api/systems/${command.systemId}`, "PATCH", { name: command.name });
    case "system/delete":
      return mutateStore(`/api/systems/${command.systemId}`, "DELETE");
    case "planet/create":
      return mutateStore("/api/planets", "POST", {
        solarSystemId: command.solarSystemId,
        name: command.name,
        planetType: command.planetType,
      });
    case "planet/update":
      return mutateStore(`/api/planets/${command.planetId}`, "PATCH", {
        name: command.name,
        extractionOutboundIlsCount: command.extractionOutboundIlsCount,
        extractionOutboundIlsOverrides: command.extractionOutboundIlsOverrides,
      });
    case "planet/delete":
      return mutateStore(`/api/planets/${command.planetId}`, "DELETE");
    case "settings/update":
      return mutateStore("/api/settings", "PATCH", command.settings);
    case "cluster/import":
      return mutateStore("/api/cluster/import", "POST", { clusterAddress: command.clusterAddress });
    case "project/create":
      return mutateStore("/api/projects", "POST", {
        name: command.name,
        notes: command.notes,
        goals: command.goals,
        importedItems: command.importedItems,
      });
    case "project/update":
      return mutateStore(`/api/projects/${command.projectId}`, "PATCH", {
        name: command.name,
        notes: command.notes,
        isActive: command.isActive,
        goals: command.goals,
        importedItems: command.importedItems,
      });
    case "project/goals/replace":
      return mutateStore(`/api/projects/${command.projectId}/goals`, "PUT", { goals: command.goals });
    case "production-site/save":
      if (command.productionSiteId) {
        return mutateStore(`/api/production-sites/${command.productionSiteId}`, "PATCH", {
          itemKey: command.itemKey,
          throughputPerMinute: command.throughputPerMinute,
          outboundIlsCount: command.outboundIlsCount,
          isFinished: command.isFinished,
          solarSystemId: command.solarSystemId,
          planetId: command.planetId,
          sameSystemWarpItemKeys: command.sameSystemWarpItemKeys,
        });
      }

      return mutateStore("/api/production-sites", "POST", {
        projectId: command.projectId,
        itemKey: command.itemKey,
        throughputPerMinute: command.throughputPerMinute,
        outboundIlsCount: command.outboundIlsCount,
        isFinished: command.isFinished,
        solarSystemId: command.solarSystemId,
        planetId: command.planetId,
        sameSystemWarpItemKeys: command.sameSystemWarpItemKeys,
      });
    case "production-site/delete":
      return mutateStore(`/api/production-sites/${command.productionSiteId}`, "DELETE");
    case "ore-vein/create":
      return mutateStore("/api/ore-veins", "POST", {
        planetId: command.planetId,
        resourceId: command.resourceId,
        label: command.label,
        miners: command.miners,
      });
    case "liquid/create":
      return mutateStore("/api/liquids", "POST", {
        planetId: command.planetId,
        resourceId: command.resourceId,
        label: command.label,
        pumpCount: command.pumpCount,
      });
    case "oil-extractor/create":
      return mutateStore("/api/oil-extractors", "POST", {
        planetId: command.planetId,
        resourceId: command.resourceId,
        label: command.label,
        oilPerSecond: command.oilPerSecond,
      });
    case "gas-giant/create":
      return mutateStore("/api/gas-giants", "POST", {
        planetId: command.planetId,
        label: command.label,
        collectorCount: command.collectorCount,
        outputs: command.outputs,
      });
    case "transport-route/save":
      if (command.routeId) {
        return mutateStore(`/api/transport-routes/${command.routeId}`, "PATCH", {
          sourceSystemId: command.sourceSystemId,
          destinationSystemId: command.destinationSystemId,
          resourceId: command.resourceId,
          throughputPerMinute: command.throughputPerMinute,
        });
      }

      return mutateStore("/api/transport-routes", "POST", {
        sourceSystemId: command.sourceSystemId,
        destinationSystemId: command.destinationSystemId,
        resourceId: command.resourceId,
        throughputPerMinute: command.throughputPerMinute,
      });
    case "transport-route/delete":
      return mutateStore(`/api/transport-routes/${command.routeId}`, "DELETE");
    case "ore-vein/delete":
      return mutateStore(`/api/ore-veins/${command.oreVeinId}`, "DELETE");
    case "liquid/delete":
      return mutateStore(`/api/liquids/${command.liquidSiteId}`, "DELETE");
    case "oil-extractor/delete":
      return mutateStore(`/api/oil-extractors/${command.oilExtractorId}`, "DELETE");
    case "gas-giant/delete":
      return mutateStore(`/api/gas-giants/${command.gasGiantSiteId}`, "DELETE");
    case "ore-vein/move":
      return mutateStore(`/api/ore-veins/${command.oreVeinId}/location`, "PATCH", { planetId: command.planetId });
    case "liquid/move":
      return mutateStore(`/api/liquids/${command.liquidSiteId}/location`, "PATCH", { planetId: command.planetId });
    case "oil-extractor/move":
      return mutateStore(`/api/oil-extractors/${command.oilExtractorId}/location`, "PATCH", { planetId: command.planetId });
    case "gas-giant/move":
      return mutateStore(`/api/gas-giants/${command.gasGiantSiteId}/location`, "PATCH", { planetId: command.planetId });
  }
}

export const indexedDbStorageRepository: StorageRepository = {
  loadBootstrap: getBootstrapFromStore,
  execute: executeStoreCommand,
  exportSnapshot: exportSnapshotFromStore,
  importSnapshot: importSnapshotToStore,
};
