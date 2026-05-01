import { describe, expect, it } from "vitest";
import { getOilOutputPerSecond, normalizeOilPerSecondTo100Percent } from "./dspMath";

describe("oil extractor math", () => {
  it("treats the seep tooltip rate as the stored base rate and scales it by mining speed", () => {
    const enteredOilPerSecond = 3.3974;
    const miningSpeedPercent = 190;

    const normalizedBaseRate = normalizeOilPerSecondTo100Percent(enteredOilPerSecond);

    expect(normalizedBaseRate).toBeCloseTo(enteredOilPerSecond, 6);
    expect(getOilOutputPerSecond(normalizedBaseRate, miningSpeedPercent)).toBeCloseTo(3.3974 * 1.9, 6);
  });
});
