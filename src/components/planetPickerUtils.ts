import type { PlanetPickerPlanetOption, PlanetPickerSystemOption } from "./PlanetPicker";
import { sortByRecentId } from "../lib/recentSort";

function comparePlanetPickerPlanets(left: PlanetPickerPlanetOption, right: PlanetPickerPlanetOption) {
  const leftOrder = left.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.sortOrder ?? Number.MAX_SAFE_INTEGER;
  return leftOrder - rightOrder || left.label.localeCompare(right.label);
}

export function sortPlanetPickerPlanets(planets: PlanetPickerPlanetOption[], recentPlanetId?: string | null) {
  return sortByRecentId(planets, recentPlanetId, (planet) => planet.value, comparePlanetPickerPlanets);
}

export function sortPlanetPickerSystems(systems: PlanetPickerSystemOption[], recentSystemId?: string | null) {
  return sortByRecentId(
    systems,
    recentSystemId,
    (system) => system.value,
    (left, right) => left.label.localeCompare(right.label),
  );
}
