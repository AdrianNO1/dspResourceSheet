export type ViewKey = "log" | "overview" | "raw" | "map" | "production" | "projects" | "settings";

export const viewTabs: Array<{ key: ViewKey; label: string }> = [
  { key: "log", label: "Logging" },
  { key: "overview", label: "Overview" },
  { key: "raw", label: "Raw" },
  { key: "map", label: "Map" },
  { key: "production", label: "Production" },
  { key: "projects", label: "Projects" },
  { key: "settings", label: "Settings" },
];

export const defaultView: ViewKey = "log";

export function getViewFromHash(hash: string): ViewKey {
  const view = hash.replace(/^#\/?/, "").replace(/\/+$/, "").toLowerCase();
  return viewTabs.some((tab) => tab.key === view) ? (view as ViewKey) : defaultView;
}

export function getHashForView(view: ViewKey) {
  return `#/${view}`;
}

export type MapSelection = {
  scope: "system" | "planet";
  id: string;
};

export type UndoToast = {
  id: string;
  title: string;
  description: string;
  snapshot: unknown;
  expiresAt: number;
  durationMs: number;
};
