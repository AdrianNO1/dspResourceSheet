import { describe, expect, it } from "vitest";
import { getPlanetExtractionOutboundIlsCount } from "./planetLogistics";

describe("planetLogistics", () => {
  it("prefers a resource-specific override over the planet default", () => {
    expect(getPlanetExtractionOutboundIlsCount({
      id: "planet-1",
      solar_system_id: "system-1",
      name: "Alpha I",
      planet_type: "solid",
      extraction_outbound_ils_count: 2,
      extraction_outbound_ils_overrides: [{ resource_id: "ore-1", ils_count: 5 }],
    }, "ore-1")).toBe(5);
  });

  it("falls back to the planet default when no override exists", () => {
    expect(getPlanetExtractionOutboundIlsCount({
      id: "planet-1",
      solar_system_id: "system-1",
      name: "Alpha I",
      planet_type: "solid",
      extraction_outbound_ils_count: 2,
      extraction_outbound_ils_overrides: [{ resource_id: "ore-1", ils_count: 5 }],
    }, "ore-2")).toBe(2);
  });
});
