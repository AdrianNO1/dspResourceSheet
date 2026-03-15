import { z } from "zod";

export const resourceTypeSchema = z.enum([
  "ore_vein",
  "liquid_pump",
  "oil_extractor",
  "gas_giant_output",
]);

export const planetTypeSchema = z.enum(["solid", "gas_giant"]);
export const minerTypeSchema = z.enum(["regular", "advanced"]);

export const createResourceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: resourceTypeSchema,
});

export const createSolarSystemSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const createPlanetSchema = z.object({
  solarSystemId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  planetType: planetTypeSchema,
});

export const patchSettingsSchema = z.object({
  currentSolarSystemId: z.string().uuid().nullable().optional(),
  currentPlanetId: z.string().uuid().nullable().optional(),
  miningResearchBonusPercent: z.number().min(0).max(500).optional(),
});

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  notes: z.string().trim().max(500).default(""),
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  notes: z.string().trim().max(500).default(""),
  isActive: z.boolean(),
  goals: z
    .array(
      z.object({
        resourceId: z.string().uuid(),
        quantity: z.number().min(0),
      }),
    )
    .optional(),
});

export const replaceGoalsSchema = z.object({
  goals: z.array(
    z.object({
      resourceId: z.string().uuid(),
      quantity: z.number().min(0),
    }),
  ),
});

const minerSchema = z
  .object({
    minerType: minerTypeSchema,
    coveredNodes: z.number().int().min(1),
    advancedSpeedPercent: z.number().int().min(100).max(300).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.minerType === "advanced" && value.advancedSpeedPercent === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["advancedSpeedPercent"],
        message: "Advanced miners require a speed setting.",
      });
    }
  });

export const createOreVeinSchema = z.object({
  planetId: z.string().uuid(),
  resourceId: z.string().uuid(),
  label: z.string().trim().max(80).default(""),
  miners: z.array(minerSchema).min(1),
});

export const createLiquidSiteSchema = z.object({
  planetId: z.string().uuid(),
  resourceId: z.string().uuid(),
  label: z.string().trim().max(80).default(""),
  pumpCount: z.number().int().min(1).max(999),
});

export const createOilExtractorSchema = z.object({
  planetId: z.string().uuid(),
  resourceId: z.string().uuid(),
  label: z.string().trim().max(80).default(""),
  oilPerSecond: z.number().positive().max(30),
});

export const createGasGiantSchema = z.object({
  planetId: z.string().uuid(),
  label: z.string().trim().max(80).default(""),
  collectorCount: z.number().int().min(0).max(40),
  outputs: z
    .array(
      z.object({
        resourceId: z.string().uuid(),
        ratePerSecond: z.number().positive().max(9999),
      }),
    )
    .min(1),
});

export const importSnapshotSchema = z.object({
  resources: z.array(z.record(z.string(), z.any())),
  solarSystems: z.array(z.record(z.string(), z.any())),
  planets: z.array(z.record(z.string(), z.any())),
  projects: z.array(z.record(z.string(), z.any())),
  projectGoals: z.array(z.record(z.string(), z.any())),
  oreVeins: z.array(z.record(z.string(), z.any())),
  oreVeinMiners: z.array(z.record(z.string(), z.any())),
  liquidSites: z.array(z.record(z.string(), z.any())),
  oilExtractors: z.array(z.record(z.string(), z.any())),
  gasGiantSites: z.array(z.record(z.string(), z.any())),
  gasGiantOutputs: z.array(z.record(z.string(), z.any())),
  settings: z.record(z.string(), z.any()),
});
