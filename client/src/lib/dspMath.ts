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

export function getMiningResearchMultiplier(miningResearchBonusPercent: number) {
  return 1 + miningResearchBonusPercent / 100;
}

export function getRegularMinerOutputPerMinute(coveredNodes: number, miningResearchBonusPercent: number) {
  return coveredNodes * REGULAR_MINER_RATE_PER_MINUTE * getMiningResearchMultiplier(miningResearchBonusPercent);
}

export function getAdvancedMinerOutputPerMinute(
  coveredNodes: number,
  advancedSpeedPercent: number,
  miningResearchBonusPercent: number,
) {
  return (
    coveredNodes *
    ADVANCED_MINER_RATE_PER_MINUTE *
    (advancedSpeedPercent / 100) *
    getMiningResearchMultiplier(miningResearchBonusPercent)
  );
}

export function getAdvancedMinerPowerMw(advancedSpeedPercent: number) {
  const speedMultiplier = advancedSpeedPercent / 100;
  return 0.15510304 + 2.76993894 * speedMultiplier * speedMultiplier;
}

export function getPumpOutputPerMinute(pumpCount: number, miningResearchBonusPercent: number) {
  return pumpCount * PUMP_OUTPUT_PER_MINUTE * getMiningResearchMultiplier(miningResearchBonusPercent);
}

export function getOilOutputPerSecond(baseOilPerSecond: number) {
  return baseOilPerSecond * OIL_OUTPUT_MULTIPLIER;
}

export function getOrbitalCollectorTrueBoost(
  outputs: Array<{ ratePerSecond: number; fuelValueMj: number | null }>,
  miningResearchBonusPercent: number,
) {
  const totalHeatMw = outputs.reduce(
    (sum, output) => sum + output.ratePerSecond * (output.fuelValueMj ?? 0),
    0,
  );

  if (totalHeatMw <= 0) {
    return 0;
  }

  const rawBoost = getMiningResearchMultiplier(miningResearchBonusPercent) * 8 - ORBITAL_COLLECTOR_INTERNAL_POWER_MW / totalHeatMw;
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
