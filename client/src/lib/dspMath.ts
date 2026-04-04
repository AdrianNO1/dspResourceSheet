export const REGULAR_MINER_RATE_PER_MINUTE = 30;
export const ADVANCED_MINER_RATE_PER_MINUTE = 60;
export const REGULAR_MINER_POWER_MW = 0.42;
export const PUMP_POWER_MW = 0.3;
export const PUMP_OUTPUT_PER_MINUTE = 50;
export const OIL_EXTRACTOR_POWER_MW = 0.84;
export const OIL_OUTPUT_MULTIPLIER = 1.5;
export const ORBITAL_COLLECTOR_INTERNAL_POWER_MW = 30;
export const INTERSTELLAR_LOGISTICS_STATION_VESSEL_CAPACITY = 1000;
export const INTERSTELLAR_LOGISTICS_STATION_VESSEL_COUNT = 10;
export const INTERSTELLAR_LOGISTICS_STATION_STORAGE_CAPACITY = 10000;

export type MultiSourceTransportInput = {
  id: string;
  supplyPerMinute: number;
  distanceLy: number | null;
};

export type MultiSourceTransportRow = {
  id: string;
  supplyPerMinute: number;
  distanceLy: number | null;
  assignedPerMinute: number;
  utilizationPercent: number;
  roundTripSeconds: number | null;
  itemsPerMinutePerVessel: number | null;
  sourceStationsNeeded: number | null;
  targetStationsNeeded: number | null;
  isComplete: boolean;
};

export type MultiSourceTransportPlan = {
  rows: MultiSourceTransportRow[];
  requestedThroughputPerMinute: number;
  assignedThroughputPerMinute: number;
  remainingThroughputPerMinute: number;
  totalTargetStationsNeeded: number;
};

export function getMiningSpeedMultiplier(miningSpeedPercent: number) {
  return miningSpeedPercent / 100;
}

export function getRegularMinerOutputPerMinute(coveredNodes: number, miningSpeedPercent: number) {
  return coveredNodes * REGULAR_MINER_RATE_PER_MINUTE * getMiningSpeedMultiplier(miningSpeedPercent);
}

export function getAdvancedMinerOutputPerMinute(
  coveredNodes: number,
  advancedSpeedPercent: number,
  miningSpeedPercent: number,
) {
  return (
    coveredNodes *
    ADVANCED_MINER_RATE_PER_MINUTE *
    (advancedSpeedPercent / 100) *
    getMiningSpeedMultiplier(miningSpeedPercent)
  );
}

export function getAdvancedMinerPowerMw(advancedSpeedPercent: number) {
  const speedMultiplier = advancedSpeedPercent / 100;
  return 0.15510304 + 2.76993894 * speedMultiplier * speedMultiplier;
}

export function getPumpOutputPerMinute(pumpCount: number, miningSpeedPercent: number) {
  return pumpCount * PUMP_OUTPUT_PER_MINUTE * getMiningSpeedMultiplier(miningSpeedPercent);
}

export function getOilOutputPerSecond(baseOilPerSecond: number) {
  return baseOilPerSecond * OIL_OUTPUT_MULTIPLIER;
}

export function getOrbitalCollectorTrueBoost(
  outputs: Array<{ ratePerSecond: number; fuelValueMj: number | null }>,
  miningSpeedPercent: number,
) {
  const totalHeatMw = outputs.reduce(
    (sum, output) => sum + output.ratePerSecond * (output.fuelValueMj ?? 0),
    0,
  );

  if (totalHeatMw <= 0) {
    return 0;
  }

  const rawBoost = getMiningSpeedMultiplier(miningSpeedPercent) * 8 - ORBITAL_COLLECTOR_INTERNAL_POWER_MW / totalHeatMw;
  return Math.max(0, rawBoost);
}

export function getTransportRoundTripSeconds(
  distanceLy: number,
  vesselSpeedLyPerSecond: number,
  vesselDockingSeconds: number,
) {
  if (distanceLy < 0 || vesselSpeedLyPerSecond <= 0 || vesselDockingSeconds < 0) {
    return null;
  }

  return 2 * (distanceLy / vesselSpeedLyPerSecond) + 2 * vesselDockingSeconds;
}

export function getItemsPerMinutePerVessel(
  vesselCapacityItems: number,
  distanceLy: number,
  vesselSpeedLyPerSecond: number,
  vesselDockingSeconds: number,
) {
  const roundTripSeconds = getTransportRoundTripSeconds(distanceLy, vesselSpeedLyPerSecond, vesselDockingSeconds);
  if (roundTripSeconds === null || roundTripSeconds <= 0 || vesselCapacityItems <= 0) {
    return null;
  }

  return (vesselCapacityItems * 60) / roundTripSeconds;
}

export function getRequiredVessels(
  throughputPerMinute: number,
  vesselCapacityItems: number,
  distanceLy: number,
  vesselSpeedLyPerSecond: number,
  vesselDockingSeconds: number,
) {
  const itemsPerMinutePerVessel = getItemsPerMinutePerVessel(
    vesselCapacityItems,
    distanceLy,
    vesselSpeedLyPerSecond,
    vesselDockingSeconds,
  );
  if (itemsPerMinutePerVessel === null || itemsPerMinutePerVessel <= 0 || throughputPerMinute < 0) {
    return null;
  }

  return throughputPerMinute / itemsPerMinutePerVessel;
}

export function getRequiredStations(
  throughputPerMinute: number,
  vesselCapacityItems: number,
  distanceLy: number,
  vesselSpeedLyPerSecond: number,
  vesselDockingSeconds: number,
) {
  const requiredVessels = getRequiredVessels(
    throughputPerMinute,
    vesselCapacityItems,
    distanceLy,
    vesselSpeedLyPerSecond,
    vesselDockingSeconds,
  );
  if (requiredVessels === null) {
    return null;
  }

  return requiredVessels / INTERSTELLAR_LOGISTICS_STATION_VESSEL_COUNT;
}

export function getTargetStationsNeeded(
  throughputPerMinute: number,
  ilsStorageItems: number,
  distanceLy: number,
  vesselSpeedLyPerSecond: number,
  vesselDockingSeconds: number,
) {
  const roundTripSeconds = getTransportRoundTripSeconds(distanceLy, vesselSpeedLyPerSecond, vesselDockingSeconds);
  if (roundTripSeconds === null || roundTripSeconds <= 0 || throughputPerMinute < 0 || ilsStorageItems <= 0) {
    return null;
  }

  return throughputPerMinute * (roundTripSeconds / 60) / ilsStorageItems;
}

export function getMultiSourceTransportPlan(
  sources: MultiSourceTransportInput[],
  throughputPerMinute: number,
  vesselCapacityItems: number,
  ilsStorageItems: number,
  vesselSpeedLyPerSecond: number,
  vesselDockingSeconds: number,
): MultiSourceTransportPlan {
  const requestedThroughputPerMinute = Math.max(0, throughputPerMinute);
  const completeSources = sources
    .filter((source) => source.supplyPerMinute > 0 && source.distanceLy !== null)
    .sort((left, right) => {
      const distanceDelta = Number(left.distanceLy) - Number(right.distanceLy);
      if (distanceDelta !== 0) {
        return distanceDelta;
      }

      return right.supplyPerMinute - left.supplyPerMinute;
    });

  const assignedById = new Map<string, number>();
  let remainingThroughputPerMinute = requestedThroughputPerMinute;
  let index = 0;

  while (index < completeSources.length) {
    const distanceLy = completeSources[index].distanceLy;
    const group: MultiSourceTransportInput[] = [];

    while (index < completeSources.length && completeSources[index].distanceLy === distanceLy) {
      group.push(completeSources[index]);
      index += 1;
    }

    if (remainingThroughputPerMinute <= 0) {
      group.forEach((source) => assignedById.set(source.id, 0));
      continue;
    }

    const groupSupplyPerMinute = group.reduce((sum, source) => sum + source.supplyPerMinute, 0);

    if (groupSupplyPerMinute <= remainingThroughputPerMinute) {
      group.forEach((source) => assignedById.set(source.id, source.supplyPerMinute));
      remainingThroughputPerMinute -= groupSupplyPerMinute;
      continue;
    }

    group.forEach((source) => {
      const assignedPerMinute =
        groupSupplyPerMinute > 0 ? remainingThroughputPerMinute * (source.supplyPerMinute / groupSupplyPerMinute) : 0;
      assignedById.set(source.id, Math.min(source.supplyPerMinute, assignedPerMinute));
    });
    remainingThroughputPerMinute = 0;
  }

  const rows = sources.map<MultiSourceTransportRow>((source) => {
    const assignedPerMinute = assignedById.get(source.id) ?? 0;
    const isComplete = source.distanceLy !== null;
    const isLocalRoute = source.distanceLy === 0;
    const roundTripSeconds =
      source.distanceLy === null
        ? null
        : getTransportRoundTripSeconds(source.distanceLy, vesselSpeedLyPerSecond, vesselDockingSeconds);
    const itemsPerMinutePerVessel =
      source.distanceLy === null
        ? null
        : getItemsPerMinutePerVessel(
            vesselCapacityItems,
            source.distanceLy,
            vesselSpeedLyPerSecond,
            vesselDockingSeconds,
          );
    const sourceStationsNeeded =
      source.distanceLy === null
        ? null
        : isLocalRoute
          ? 0
        : getRequiredStations(
            assignedPerMinute,
            vesselCapacityItems,
            source.distanceLy,
            vesselSpeedLyPerSecond,
            vesselDockingSeconds,
          );
    const targetStationsNeeded =
      source.distanceLy === null
        ? null
        : isLocalRoute
          ? 0
        : getTargetStationsNeeded(
            assignedPerMinute,
            ilsStorageItems,
            source.distanceLy,
            vesselSpeedLyPerSecond,
            vesselDockingSeconds,
          );

    return {
      id: source.id,
      supplyPerMinute: source.supplyPerMinute,
      distanceLy: source.distanceLy,
      assignedPerMinute,
      utilizationPercent: source.supplyPerMinute > 0 ? (assignedPerMinute / source.supplyPerMinute) * 100 : 0,
      roundTripSeconds,
      itemsPerMinutePerVessel,
      sourceStationsNeeded,
      targetStationsNeeded,
      isComplete,
    };
  });

  const assignedThroughputPerMinute = rows.reduce((sum, row) => sum + row.assignedPerMinute, 0);
  const totalTargetStationsNeeded = rows.reduce((sum, row) => sum + (row.targetStationsNeeded ?? 0), 0);

  return {
    rows,
    requestedThroughputPerMinute,
    assignedThroughputPerMinute,
    remainingThroughputPerMinute: Math.max(0, requestedThroughputPerMinute - assignedThroughputPerMinute),
    totalTargetStationsNeeded,
  };
}
