import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import type { BootstrapData } from "../lib/types";
import { appClient } from "./appClient";
import { defaultView, getHashForView, getViewFromHash, type MapSelection, type UndoToast, type ViewKey } from "./appTypes";
import type { StoreCommand } from "./storeCommands";

const UNDO_TOAST_DURATION_MS = 6000;

type AppState = {
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

type AppContextValue = {
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

type AppAction =
  | { type: "loading/set"; loading: boolean }
  | { type: "busy/set"; busy: boolean }
  | { type: "error/set"; error: string }
  | { type: "data/set"; data: BootstrapData | null }
  | { type: "undo/show"; undoToast: UndoToast }
  | { type: "undo/hide" }
  | { type: "undo/tick"; now: number }
  | { type: "view/set"; view: ViewKey }
  | { type: "project/select"; projectId: string }
  | { type: "production/select"; itemKey: string }
  | { type: "map/select"; selection: MapSelection };

const initialState: AppState = {
  data: null,
  loading: true,
  busy: false,
  error: "",
  undoToast: null,
  undoToastNow: Date.now(),
  activeView: typeof window === "undefined" ? defaultView : getViewFromHash(window.location.hash),
  selectedProjectId: typeof window === "undefined" ? "" : window.localStorage.getItem("dsp-resource-sheet:selected-project-id") ?? "",
  selectedProductionItemKey: "",
  selectedMapSelection: { scope: "system", id: "" },
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "loading/set":
      return { ...state, loading: action.loading };
    case "busy/set":
      return { ...state, busy: action.busy };
    case "error/set":
      return { ...state, error: action.error };
    case "data/set":
      return { ...state, data: action.data };
    case "undo/show":
      return { ...state, undoToast: action.undoToast, undoToastNow: Date.now() };
    case "undo/hide":
      return { ...state, undoToast: null };
    case "undo/tick":
      return { ...state, undoToastNow: action.now };
    case "view/set":
      return { ...state, activeView: action.view };
    case "project/select":
      return { ...state, selectedProjectId: action.projectId };
    case "production/select":
      return { ...state, selectedProductionItemKey: action.itemKey };
    case "map/select":
      return { ...state, selectedMapSelection: action.selection };
    default:
      return state;
  }
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  async function refreshBootstrap() {
    dispatch({ type: "loading/set", loading: true });

    try {
      const nextData = await appClient.loadBootstrap();
      dispatch({ type: "data/set", data: nextData });
      dispatch({ type: "error/set", error: "" });
    } catch (requestError) {
      dispatch({
        type: "error/set",
        error: requestError instanceof Error ? requestError.message : "Unable to load the app.",
      });
    } finally {
      dispatch({ type: "loading/set", loading: false });
    }
  }

  function navigateToView(view: ViewKey) {
    dispatch({ type: "view/set", view });
    const nextHash = getHashForView(view);
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }

  async function runCommand(command: StoreCommand, onSuccess?: (payload: BootstrapData) => void) {
    dispatch({ type: "busy/set", busy: true });
    dispatch({ type: "error/set", error: "" });

    try {
      const payload = await appClient.execute(command);
      dispatch({ type: "data/set", data: payload });
      onSuccess?.(payload);
    } catch (requestError) {
      dispatch({
        type: "error/set",
        error: requestError instanceof Error ? requestError.message : "Request failed.",
      });
    } finally {
      dispatch({ type: "busy/set", busy: false });
    }
  }

  function showUndoToast(title: string, snapshot: unknown, description = "Undo available for a few seconds.") {
    dispatch({
      type: "undo/show",
      undoToast: {
        id: crypto.randomUUID(),
        title,
        description,
        snapshot,
        expiresAt: Date.now() + UNDO_TOAST_DURATION_MS,
        durationMs: UNDO_TOAST_DURATION_MS,
      },
    });
  }

  async function runUndoableCommand(
    command: StoreCommand,
    undoTitle: string,
    onSuccess?: (payload: BootstrapData) => void,
    undoDescription?: string,
  ) {
    dispatch({ type: "busy/set", busy: true });
    dispatch({ type: "error/set", error: "" });

    try {
      const previousSnapshot = (await appClient.exportSnapshot()).snapshot;
      const payload = await appClient.execute(command);
      dispatch({ type: "data/set", data: payload });
      onSuccess?.(payload);
      showUndoToast(undoTitle, previousSnapshot, undoDescription);
    } catch (requestError) {
      dispatch({
        type: "error/set",
        error: requestError instanceof Error ? requestError.message : "Request failed.",
      });
    } finally {
      dispatch({ type: "busy/set", busy: false });
    }
  }

  async function restoreSnapshot(snapshot: unknown) {
    dispatch({ type: "undo/hide" });
    dispatch({ type: "busy/set", busy: true });
    dispatch({ type: "error/set", error: "" });

    try {
      const payload = await appClient.importSnapshot(snapshot);
      dispatch({ type: "data/set", data: payload });
    } catch (requestError) {
      dispatch({
        type: "error/set",
        error: requestError instanceof Error ? requestError.message : "Request failed.",
      });
    } finally {
      dispatch({ type: "busy/set", busy: false });
    }
  }

  useEffect(() => {
    void refreshBootstrap();
  }, []);

  useEffect(() => {
    const syncViewFromHash = () => {
      const nextView = getViewFromHash(window.location.hash);
      dispatch({ type: "view/set", view: nextView });
    };

    const canonicalHash = getHashForView(getViewFromHash(window.location.hash));
    if (window.location.hash !== canonicalHash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${canonicalHash}`);
    }

    window.addEventListener("hashchange", syncViewFromHash);
    return () => {
      window.removeEventListener("hashchange", syncViewFromHash);
    };
  }, []);

  useEffect(() => {
    if (!state.data) {
      return;
    }

    if (!state.selectedProjectId || !state.data.projects.some((project) => project.id === state.selectedProjectId)) {
      dispatch({ type: "project/select", projectId: state.data.projects[0]?.id ?? "" });
    }
  }, [state.data, state.selectedProjectId]);

  useEffect(() => {
    if (state.selectedProjectId) {
      window.localStorage.setItem("dsp-resource-sheet:selected-project-id", state.selectedProjectId);
    }
  }, [state.selectedProjectId]);

  useEffect(() => {
    if (!state.data || !state.selectedProjectId) {
      dispatch({ type: "production/select", itemKey: "" });
      return;
    }

    const projectItems = state.data.projectImportedItems.filter((item) => item.project_id === state.selectedProjectId);
    if (!projectItems.some((item) => item.item_key === state.selectedProductionItemKey)) {
      dispatch({ type: "production/select", itemKey: projectItems[0]?.item_key ?? "" });
    }
  }, [state.data, state.selectedProjectId, state.selectedProductionItemKey]);

  useEffect(() => {
    if (!state.undoToast) {
      return;
    }

    dispatch({ type: "undo/tick", now: Date.now() });
    const intervalId = window.setInterval(() => {
      const now = Date.now();
      dispatch({ type: "undo/tick", now });
      if (state.undoToast && now >= state.undoToast.expiresAt) {
        dispatch({ type: "undo/hide" });
      }
    }, 100);

    return () => window.clearInterval(intervalId);
  }, [state.undoToast]);

  const undoToastRemainingMs = state.undoToast ? Math.max(0, state.undoToast.expiresAt - state.undoToastNow) : 0;
  const undoToastSecondsLabel =
    undoToastRemainingMs / 1000 < 1
      ? "<1s remaining"
      : `${Math.ceil(undoToastRemainingMs / 1000)}s remaining`;
  const undoToastProgressWidth = state.undoToast
    ? Math.max(0, Math.min(100, (undoToastRemainingMs / state.undoToast.durationMs) * 100))
    : 0;

  const value = useMemo<AppContextValue>(() => ({
    state,
    navigateToView,
    setSelectedProjectId: (projectId) => dispatch({ type: "project/select", projectId }),
    setSelectedProductionItemKey: (itemKey) => dispatch({ type: "production/select", itemKey }),
    setSelectedMapSelection: (selection) => dispatch({ type: "map/select", selection }),
    refreshBootstrap,
    runCommand,
    runUndoableCommand,
    restoreSnapshot,
    exportSnapshot: appClient.exportSnapshot,
    undoToastSecondsLabel,
    undoToastProgressWidth,
  }), [state, undoToastProgressWidth, undoToastSecondsLabel]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used inside AppProvider.");
  }
  return context;
}
