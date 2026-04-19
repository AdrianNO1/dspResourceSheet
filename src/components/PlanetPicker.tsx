import { useEffect, useMemo, useRef, useState } from "react";
import { sortPlanetPickerPlanets } from "./planetPickerUtils";

export type PlanetPickerPlanetOption = {
  value: string;
  label: string;
  supportingText?: string;
  searchText?: string;
  sortOrder?: number;
};

export type PlanetPickerSystemOption = {
  value: string;
  label: string;
  searchText?: string;
  planets: PlanetPickerPlanetOption[];
};

type PlanetPickerProps = {
  systems: PlanetPickerSystemOption[];
  value: string;
  onChange: (selection: { planetId: string; systemId: string }) => void;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
};

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase();
}

function findSelectedPlanet(systems: PlanetPickerSystemOption[], value: string) {
  for (const system of systems) {
    const planet = system.planets.find((entry) => entry.value === value);
    if (planet) {
      return { system, planet };
    }
  }

  return null;
}

export function PlanetPicker({
  systems,
  value,
  onChange,
  disabled = false,
  placeholder = "Select planet",
  searchPlaceholder = "Search planets or systems",
  emptyText = "No planets match your search.",
}: PlanetPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeSystemId, setActiveSystemId] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const sortedSystems = useMemo(
    () =>
      systems.map((system) => ({
        ...system,
        planets: sortPlanetPickerPlanets(system.planets),
      })),
    [systems],
  );
  const selected = useMemo(() => findSelectedPlanet(sortedSystems, value), [sortedSystems, value]);

  function closeMenu() {
    setOpen(false);
    setQuery("");
  }

  function openMenu() {
    setQuery("");
    setActiveSystemId(selected?.system.value ?? sortedSystems[0]?.value ?? "");
    setOpen(true);
  }

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        closeMenu();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    searchInputRef.current?.focus();
  }, [open]);

  const filteredSystems = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) {
      return sortedSystems;
    }

    return sortedSystems
      .map((system) => {
        const systemHaystack = normalizeSearchText(`${system.label} ${system.searchText ?? ""}`);
        const systemMatches = systemHaystack.includes(normalizedQuery);
        const matchingPlanets = systemMatches
          ? system.planets
          : system.planets.filter((planet) =>
              normalizeSearchText(`${planet.label} ${planet.supportingText ?? ""} ${planet.searchText ?? ""}`).includes(normalizedQuery),
            );

        if (!systemMatches && matchingPlanets.length === 0) {
          return null;
        }

        return {
          ...system,
          planets: matchingPlanets,
        };
      })
      .filter((system): system is PlanetPickerSystemOption => system !== null);
  }, [query, sortedSystems]);

  const resolvedActiveSystemId = filteredSystems.some((system) => system.value === activeSystemId)
    ? activeSystemId
    : selected?.system.value ?? filteredSystems[0]?.value ?? "";

  const activeSystem =
    filteredSystems.find((system) => system.value === resolvedActiveSystemId) ??
    filteredSystems[0] ??
    null;

  return (
    <div ref={rootRef} className={`planet-picker ${open ? "planet-picker-open" : ""}`}>
      <button
        type="button"
        className="planet-picker-trigger"
        onClick={() => {
          if (disabled) {
            return;
          }

          if (open) {
            closeMenu();
            return;
          }

          openMenu();
        }}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        {selected ? (
          <span className="planet-picker-trigger-copy">
            <span className="planet-picker-trigger-primary">{selected.planet.label}</span>
            <span className="planet-picker-trigger-secondary">
              {selected.system.label}
              {selected.planet.supportingText ? ` | ${selected.planet.supportingText}` : ""}
            </span>
          </span>
        ) : (
          <span className="planet-picker-placeholder">{placeholder}</span>
        )}
        <span className="planet-picker-caret" aria-hidden="true">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="planet-picker-menu" role="dialog" aria-label="Planet picker">
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                closeMenu();
              }
            }}
            className="planet-picker-search"
            placeholder={searchPlaceholder}
          />

          {filteredSystems.length > 0 && activeSystem ? (
            <div className="planet-picker-body">
              <div className="planet-picker-system-list" role="listbox" aria-label="Systems">
                {filteredSystems.map((system) => {
                  const isActive = system.value === activeSystem.value;
                  const hasSelectedPlanet = system.planets.some((planet) => planet.value === value);

                  return (
                    <button
                      key={system.value}
                      type="button"
                      className={`planet-picker-system-row ${isActive ? "planet-picker-system-row-active" : ""} ${hasSelectedPlanet ? "planet-picker-system-row-selected" : ""}`}
                      onMouseEnter={() => setActiveSystemId(system.value)}
                      onFocus={() => setActiveSystemId(system.value)}
                      onClick={() => setActiveSystemId(system.value)}
                    >
                      <span className="planet-picker-system-copy">
                        <span className="planet-picker-system-name">{system.label}</span>
                        <span className="planet-picker-system-meta">
                          {system.planets.length} {system.planets.length === 1 ? "planet" : "planets"}
                        </span>
                      </span>
                      <span className="planet-picker-system-chevron" aria-hidden="true">
                        {">"}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="planet-picker-planet-panel">
                <div className="planet-picker-panel-heading">
                  <strong>{activeSystem.label}</strong>
                  <span>{activeSystem.planets.length} in view</span>
                </div>

                <div className="planet-picker-planet-list" role="listbox" aria-label={`${activeSystem.label} planets`}>
                  {activeSystem.planets.map((planet) => (
                    <button
                      key={planet.value}
                      type="button"
                      className={`planet-picker-planet-row ${planet.value === value ? "planet-picker-planet-row-selected" : ""}`}
                      onClick={() => {
                        onChange({ planetId: planet.value, systemId: activeSystem.value });
                        closeMenu();
                      }}
                    >
                      <span className="planet-picker-planet-copy">
                        <span className="planet-picker-planet-name">{planet.label}</span>
                        {planet.supportingText ? (
                          <span className="planet-picker-planet-meta">{planet.supportingText}</span>
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="planet-picker-empty">{emptyText}</p>
          )}
        </div>
      )}
    </div>
  );
}
