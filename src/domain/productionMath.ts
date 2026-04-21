export function roundUpValue(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.ceil(value * factor - 1e-9) / factor;
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
