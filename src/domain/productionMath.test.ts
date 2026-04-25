import { describe, expect, it } from "vitest";
import {
  getAdjustedLineCount,
  getExactLineDemand,
  getRoundedMachinePlan,
  normalizeLineDivisibleBy,
  roundUpValue,
} from "./productionMath";

describe("productionMath", () => {
  it("rounds values upward with decimal precision", () => {
    expect(roundUpValue(1.201, 1)).toBe(1.3);
    expect(roundUpValue(2, 1)).toBe(2);
  });

  it("uses the highest belt demand as exact line demand", () => {
    expect(getExactLineDemand(3, [{ requiredBelts: 1.2 }, { requiredBelts: 4.1 }])).toBe(4.1);
  });

  it("normalizes optional line divisibility inputs", () => {
    expect(normalizeLineDivisibleBy("")).toBeNull();
    expect(normalizeLineDivisibleBy("abc")).toBeNull();
    expect(normalizeLineDivisibleBy(1)).toBeNull();
    expect(normalizeLineDivisibleBy(5)).toBe(5);
  });

  it("rounds line counts up to the next requested multiple", () => {
    expect(getAdjustedLineCount(27.4, null)).toBe(28);
    expect(getAdjustedLineCount(28, 4)).toBe(28);
    expect(getAdjustedLineCount(27.4, 5)).toBe(30);
    expect(getAdjustedLineCount(27.4, 1)).toBe(28);
  });

  it("rounds machines per line while keeping the actual total machine count", () => {
    expect(getRoundedMachinePlan(10.2, 3)).toEqual({
      machinesPerLine: 4,
      totalMachineCount: 10.2,
    });
  });

  it("can round machine plans against output belts", () => {
    expect(getRoundedMachinePlan(7.1, 3, 2.1)).toEqual({
      machinesPerLine: 4,
      totalMachineCount: 7.1,
    });
  });

  it("does not inflate total machines for fractional line counts", () => {
    expect(getRoundedMachinePlan(10.2, 3.2)).toEqual({
      machinesPerLine: 4,
      totalMachineCount: 10.2,
    });
  });
});
