import type { BootstrapData } from "./types";
import {
  exportSnapshotFromStore,
  getBootstrapFromStore,
  importSnapshotToStore,
  mutateStore,
} from "./localStore";

export function getBootstrap() {
  return getBootstrapFromStore();
}

export function postBootstrap(url: string, body: unknown, method = "POST") {
  return mutateStore(url, method, body);
}

export function patchBootstrap(url: string, body: unknown) {
  return postBootstrap(url, body, "PATCH");
}

export function putBootstrap(url: string, body: unknown) {
  return postBootstrap(url, body, "PUT");
}

export function deleteBootstrap(url: string): Promise<BootstrapData> {
  return mutateStore(url, "DELETE");
}

export function exportSnapshot() {
  return exportSnapshotFromStore();
}

export function importSnapshot(snapshot: unknown) {
  return importSnapshotToStore(snapshot);
}
