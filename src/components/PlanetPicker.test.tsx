import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PlanetPicker, type PlanetPickerSystemOption } from "./PlanetPicker";
import { sortPlanetPickerPlanets, sortPlanetPickerSystems } from "./planetPickerUtils";

const systems: PlanetPickerSystemOption[] = [
  {
    value: "haris",
    label: "Haris",
    planets: [
      { value: "haris-3", label: "Haris III", supportingText: "Solid planet", sortOrder: 3 },
      { value: "haris-1", label: "Haris I", supportingText: "Solid planet", sortOrder: 1 },
      { value: "haris-2", label: "Haris II", supportingText: "Gas giant", sortOrder: 2 },
    ],
  },
  {
    value: "chertan",
    label: "Chertan",
    planets: [
      { value: "chertan-2", label: "Chertan II", supportingText: "Solid planet", sortOrder: 2, searchText: "iron" },
      { value: "chertan-1", label: "Chertan I", supportingText: "Gas giant", sortOrder: 1, searchText: "hydrogen" },
    ],
  },
];

describe("PlanetPicker", () => {
  it("sorts planets by sort order before label", () => {
    expect(sortPlanetPickerPlanets(systems[0].planets).map((planet) => planet.label)).toEqual([
      "Haris I",
      "Haris II",
      "Haris III",
    ]);
  });

  it("floats the most recently used system and planet to the top", () => {
    expect(sortPlanetPickerSystems(systems, "haris").map((system) => system.label)).toEqual([
      "Haris",
      "Chertan",
    ]);
    expect(sortPlanetPickerPlanets(systems[0].planets, "haris-3").map((planet) => planet.label)).toEqual([
      "Haris III",
      "Haris I",
      "Haris II",
    ]);
  });

  it("filters by system name and returns both planet and system ids on selection", () => {
    const handleChange = vi.fn();

    render(
      <PlanetPicker
        systems={systems}
        value=""
        onChange={handleChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /select planet/i }));
    fireEvent.change(screen.getByPlaceholderText("Search planets or systems"), { target: { value: "chertan" } });
    fireEvent.click(screen.getByRole("button", { name: /chertan ii/i }));

    expect(handleChange).toHaveBeenCalledWith({ planetId: "chertan-2", systemId: "chertan" });
  });

  it("switches the planet panel on hover and keeps planets in order", () => {
    const { container } = render(
      <PlanetPicker
        systems={systems}
        value=""
        onChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /select planet/i }));
    fireEvent.mouseEnter(screen.getAllByRole("button", { name: /chertan/i })[0]!);

    const panel = screen.getByLabelText("Chertan planets");
    expect(within(panel).getAllByRole("button")).toHaveLength(2);

    const labels = Array.from(container.querySelectorAll(".planet-picker-planet-name")).map((entry) => entry.textContent);
    expect(labels).toEqual(["Chertan I", "Chertan II"]);
  });
});
