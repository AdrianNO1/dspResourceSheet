import { indexedDbStorageRepository, type StorageRepository } from "../storage/storageRepository";

export type AppCommands = {
  loadBootstrap: StorageRepository["loadBootstrap"];
  execute: StorageRepository["execute"];
  exportSnapshot: StorageRepository["exportSnapshot"];
  importSnapshot: StorageRepository["importSnapshot"];
};

export const appClient: AppCommands = {
  loadBootstrap: indexedDbStorageRepository.loadBootstrap,
  execute: indexedDbStorageRepository.execute,
  exportSnapshot: indexedDbStorageRepository.exportSnapshot,
  importSnapshot: indexedDbStorageRepository.importSnapshot,
};
