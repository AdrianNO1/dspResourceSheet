import { createContext, useContext } from "react";
import type { BootstrapData } from "../lib/types";
import type { StoreCommand } from "./storeCommands";
import type { MapSelection, UndoToast, ViewKey } from "./appTypes";
import { appClient } from "./appClient";

export type AppState = {
  data: BootstrapData | null;
  loading: boolean;
  busy: boolean;
  error: string;
  undoToast: UndoToast | null;
  undoToastNow: number;
  activeView: ViewKey;
  selectedProjectId: string;
  selectedProductionItemKey: string;
  selectedMapSelection: MapSelection;
};

export type AppContextValue = {
  state: AppState;
  navigateToView: (view: ViewKey) => void;
  setSelectedProjectId: (projectId: string) => void;
  setSelectedProductionItemKey: (itemKey: string) => void;
  setSelectedMapSelection: (selection: MapSelection) => void;
  refreshBootstrap: () => Promise<void>;
  runCommand: (command: StoreCommand, onSuccess?: (payload: BootstrapData) => void) => Promise<void>;
  runUndoableCommand: (
    command: StoreCommand,
    undoTitle: string,
    onSuccess?: (payload: BootstrapData) => void,
    undoDescription?: string,
  ) => Promise<void>;
  restoreSnapshot: (snapshot: unknown) => Promise<void>;
  exportSnapshot: typeof appClient.exportSnapshot;
  undoToastSecondsLabel: string;
  undoToastProgressWidth: number;
};

export const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used inside AppProvider.");
  }
  return context;
}
