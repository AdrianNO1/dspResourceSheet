export function roundUpValue(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.ceil(value * factor - 1e-9) / factor;
}

export function normalizeLineDivisibleBy(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isInteger(numericValue) || numericValue < 2) {
    return null;
  }

  return numericValue;
}

export function getAdjustedLineCount(lineCount: number, lineDivisibleBy: number | null = null) {
  if (!(lineCount > 0)) {
    return 1;
  }

  const roundedLineCount = Math.max(1, Math.ceil(lineCount - 1e-9));
  const divisor = normalizeLineDivisibleBy(lineDivisibleBy);
  if (!divisor) {
    return roundedLineCount;
  }

  return Math.ceil(roundedLineCount / divisor) * divisor;
}

export function getExactLineDemand(
  outputBelts: number,
  dependencies: Array<{ requiredBelts: number }>,
) {
  return Math.max(outputBelts, ...dependencies.map((dependency) => dependency.requiredBelts), 0);
}

export function getRoundedMachinePlan(machineCount: number, lineCount: number, outputBelts: number | null = null) {
  if (!(machineCount > 0) || !(lineCount > 0)) {
    return {
      machinesPerLine: 0,
      totalMachineCount: 0,
    };
  }

  const machinesPerLine =
    outputBelts && outputBelts > 0
      ? Math.max(0, Math.ceil(machineCount / outputBelts - 1e-9))
      : Math.max(0, Math.ceil(machineCount / lineCount - 1e-9));

  return {
    machinesPerLine,
    totalMachineCount: machineCount,
  };
}
