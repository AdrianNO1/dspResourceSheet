import { describe, expect, it } from "vitest";
import { getExactLineDemand, getRoundedMachinePlan, roundUpValue } from "./productionMath";

describe("productionMath", () => {
  it("rounds values upward with decimal precision", () => {
    expect(roundUpValue(1.201, 1)).toBe(1.3);
    expect(roundUpValue(2, 1)).toBe(2);
  });

  it("uses the highest belt demand as exact line demand", () => {
    expect(getExactLineDemand(3, [{ requiredBelts: 1.2 }, { requiredBelts: 4.1 }])).toBe(4.1);
  });

  it("builds rounded machine plans by line count", () => {
    expect(getRoundedMachinePlan(10.2, 3)).toEqual({
      machinesPerLine: 4,
      totalMachineCount: 12,
    });
  });

  it("can round machine plans against output belts", () => {
    expect(getRoundedMachinePlan(7.1, 3, 2.1)).toEqual({
      machinesPerLine: 4,
      totalMachineCount: 12,
    });
  });
});
