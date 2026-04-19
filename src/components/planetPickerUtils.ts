import type { PlanetPickerPlanetOption } from "./PlanetPicker";

export function sortPlanetPickerPlanets(planets: PlanetPickerPlanetOption[]) {
  return planets.slice().sort((left, right) => {
    const leftOrder = left.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.sortOrder ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.label.localeCompare(right.label);
  });
}
