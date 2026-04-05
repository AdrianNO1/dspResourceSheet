function normalizeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.'()]/g, "")
    .replace(/&/g, "and")
    .replace(/[_\s/]+/g, "-")
    .replace(/-+/g, "-");
}

const iconAliases = new Map<string, string>([
  ["assembler", "assembling-machine-mki"],
  ["assembling-machine-mk-i", "assembling-machine-mki"],
  ["assembling-machine-mk-ii", "assembling-machine-mkii"],
  ["assembling-machine-mk-iii", "assembling-machine-mkiii"],
  ["assembling-machine-1", "assembling-machine-mki"],
  ["assembling-machine-2", "assembling-machine-mkii"],
  ["assembling-machine-3", "assembling-machine-mkiii"],
  ["smelter", "arc-smelter"],
  ["lab", "matrix-lab"],
  ["research-lab", "matrix-lab"],
  ["particle-collider", "miniature-particle-collider"],
  ["collider", "miniature-particle-collider"],
  ["refinery", "oil-refinery"],
  ["mining-drill", "mining-machine"],
  ["sprayer", "spray-coater"],
  ["proliferator-1", "proliferator-mki"],
  ["proliferator-2", "proliferator-mkii"],
  ["proliferator-3", "proliferator-mkiii"],
]);

export function resolveGameIconPath(name: string) {
  const normalized = normalizeKey(name);
  const resolved = iconAliases.get(normalized) ?? normalized;
  return `icons/game/${resolved}.png`;
}
