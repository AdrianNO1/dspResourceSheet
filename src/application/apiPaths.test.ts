import { describe, expect, it } from "vitest";
import { parseApiEntityPath } from "./apiPaths";

describe("parseApiEntityPath", () => {
  it("reads collection and id from delete paths", () => {
    expect(parseApiEntityPath("/api/ore-veins/c49e29dd-8399-4186-9c09-ea28693d0e1f")).toEqual({
      collection: "ore-veins",
      id: "c49e29dd-8399-4186-9c09-ea28693d0e1f",
    });
  });

  it("reads collection and id from move paths", () => {
    expect(parseApiEntityPath("/api/ore-veins/c49e29dd-8399-4186-9c09-ea28693d0e1f/location")).toEqual({
      collection: "ore-veins",
      id: "c49e29dd-8399-4186-9c09-ea28693d0e1f",
    });
  });
});
