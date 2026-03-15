export const REGULAR_MINER_RATE_PER_MINUTE = 30;
export const ADVANCED_MINER_RATE_PER_MINUTE = 60;
export const REGULAR_MINER_POWER_MW = 0.42;
export const PUMP_POWER_MW = 0.3;
export const OIL_EXTRACTOR_POWER_MW = 0.84;
export const OIL_OUTPUT_MULTIPLIER = 1.5;
export const ORBITAL_COLLECTOR_INTERNAL_POWER_MW = 30;

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
