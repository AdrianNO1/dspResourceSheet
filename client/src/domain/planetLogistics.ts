import type { Planet } from "../lib/types";

export function getPlanetExtractionOutboundIlsCount(planet: Planet, resourceId: string | null) {
  if (resourceId) {
    const override = planet.extraction_outbound_ils_overrides.find((item) => item.resource_id === resourceId);
    if (override) {
      return override.ils_count;
    }
  }

  return planet.extraction_outbound_ils_count;
}
