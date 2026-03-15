import express from "express";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createGasGiantSchema,
  createLiquidSiteSchema,
  createOilExtractorSchema,
  createOreVeinSchema,
  createPlanetSchema,
  createProjectSchema,
  createResourceSchema,
  createSolarSystemSchema,
  importSnapshotSchema,
  moveEntrySchema,
  patchSettingsSchema,
  replaceGoalsSchema,
  updateProjectSchema,
} from "./schemas.js";
import {
  createGasGiantSite,
  createLiquidSite,
  createOilExtractor,
  createOreVein,
  createPlanet,
  createProject,
  createResource,
  createSolarSystem,
  deleteById,
  deletePlanet,
  deleteSolarSystem,
  exportSnapshot,
  getBootstrapData,
  getPlanetById,
  getResourceById,
  importSnapshot,
  initializeDatabase,
  moveEntryToPlanet,
  replaceProjectGoals,
  setSetting,
  updateProject,
} from "./db.js";

initializeDatabase();

const app = express();
const port = Number(process.env.PORT ?? "3001");
const clientDistDirectory = path.resolve(process.cwd(), "..", "client", "dist");
const timingLogPath = fileURLToPath(new URL("../../data/api-timings.log", import.meta.url));
mkdirSync(path.dirname(timingLogPath), { recursive: true });

function writeTimingLog(line: string) {
  appendFileSync(timingLogPath, `${new Date().toISOString()} ${line}\n`, "utf8");
}

app.use(express.json({ limit: "10mb" }));
app.use((req, res, next) => {
  const startedAt = Date.now();
  if (req.path.startsWith("/api")) {
    writeTimingLog(`[request-start] ${req.method} ${req.path}`);
  }
  res.on("finish", () => {
    const elapsedMs = Date.now() - startedAt;
    if (req.path.startsWith("/api")) {
      writeTimingLog(`[api] ${req.method} ${req.path} ${res.statusCode} ${elapsedMs}ms`);
    }
  });
  next();
});

function respondWithBootstrap(res: express.Response, label: string) {
  writeTimingLog(`[bootstrap-start] ${label}`);
  const bootstrapStartedAt = Date.now();
  const payload = getBootstrapData();
  const bootstrapElapsedMs = Date.now() - bootstrapStartedAt;
  writeTimingLog(`[bootstrap] ${label} ${bootstrapElapsedMs}ms`);
  return res.json(payload);
}

function respondWithCreatedBootstrap(res: express.Response, label: string) {
  res.status(201);
  return respondWithBootstrap(res, label);
}

function respondAfterDelete(
  res: express.Response,
  operationLabel: string,
  entityLabel: string,
  id: string,
  action: () => void,
) {
  const startedAt = Date.now();
  action();
  writeTimingLog(`[delete] ${entityLabel} ${id} ${Date.now() - startedAt}ms`);
  return respondWithBootstrap(res, operationLabel);
}

function moveEntry(
  req: express.Request<{ id: string }>,
  res: express.Response,
  tableName: "ore_veins" | "liquid_sites" | "oil_extractors" | "gas_giant_sites",
  operationLabel: string,
  requiredPlanetType: "solid" | "gas_giant",
) {
  const parsed = moveEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const planet = getPlanetById(parsed.data.planetId);
  if (!planet || planet.planet_type !== requiredPlanetType) {
    return res.status(400).json({ error: `Target planet must be a ${requiredPlanetType === "gas_giant" ? "gas giant" : "solid planet"}.` });
  }

  moveEntryToPlanet(tableName, req.params.id, parsed.data.planetId);
  return respondWithBootstrap(res, operationLabel);
}

app.get("/api/bootstrap", (_req, res) => {
  respondWithBootstrap(res, "bootstrap");
});

app.post("/api/resources", (req, res) => {
  const parsed = createResourceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  createResource(parsed.data.name, parsed.data.type);
  return respondWithCreatedBootstrap(res, "create-resource");
});

app.post("/api/systems", (req, res) => {
  const parsed = createSolarSystemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const systemId = createSolarSystem(parsed.data.name);
  setSetting("currentSolarSystemId", systemId);
  return respondWithCreatedBootstrap(res, "create-system");
});

app.post("/api/planets", (req, res) => {
  const parsed = createPlanetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const planetId = createPlanet(parsed.data);
  setSetting("currentSolarSystemId", parsed.data.solarSystemId);
  setSetting("currentPlanetId", planetId);
  return respondWithCreatedBootstrap(res, "create-planet");
});

app.patch("/api/settings", (req, res) => {
  const parsed = patchSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  for (const [key, value] of Object.entries(parsed.data)) {
    setSetting(key, value === null ? "" : String(value));
  }

  return respondWithBootstrap(res, "patch-settings");
});

app.post("/api/projects", (req, res) => {
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  createProject(parsed.data);
  return respondWithCreatedBootstrap(res, "create-project");
});

app.patch("/api/projects/:projectId", (req, res) => {
  const parsed = updateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  updateProject(req.params.projectId, parsed.data);
  if (parsed.data.goals) {
    replaceProjectGoals(req.params.projectId, parsed.data.goals);
  }
  return respondWithBootstrap(res, "update-project");
});

app.put("/api/projects/:projectId/goals", (req, res) => {
  const parsed = replaceGoalsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  replaceProjectGoals(req.params.projectId, parsed.data.goals);
  return respondWithBootstrap(res, "replace-goals");
});

app.post("/api/ore-veins", (req, res) => {
  const parsed = createOreVeinSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const planet = getPlanetById(parsed.data.planetId);
  const resource = getResourceById(parsed.data.resourceId);

  if (!planet || planet.planet_type !== "solid") {
    return res.status(400).json({ error: "Ore veins can only be logged on solid planets." });
  }

  if (!resource || resource.type !== "ore_vein") {
    return res.status(400).json({ error: "Selected resource is not an ore vein resource." });
  }

  createOreVein(parsed.data);
  return respondWithCreatedBootstrap(res, "create-ore-vein");
});

app.post("/api/liquids", (req, res) => {
  const parsed = createLiquidSiteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const planet = getPlanetById(parsed.data.planetId);
  const resource = getResourceById(parsed.data.resourceId);

  if (!planet || planet.planet_type !== "solid") {
    return res.status(400).json({ error: "Water pumps can only be logged on solid planets." });
  }

  if (!resource || resource.type !== "liquid_pump") {
    return res.status(400).json({ error: "Selected resource is not a liquid pump resource." });
  }

  createLiquidSite(parsed.data);
  return respondWithCreatedBootstrap(res, "create-liquid");
});

app.post("/api/oil-extractors", (req, res) => {
  const parsed = createOilExtractorSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const planet = getPlanetById(parsed.data.planetId);
  const resource = getResourceById(parsed.data.resourceId);

  if (!planet || planet.planet_type !== "solid") {
    return res.status(400).json({ error: "Oil extractors can only be logged on solid planets." });
  }

  if (!resource || resource.type !== "oil_extractor") {
    return res.status(400).json({ error: "Selected resource is not an oil resource." });
  }

  createOilExtractor(parsed.data);
  return respondWithCreatedBootstrap(res, "create-oil");
});

app.post("/api/gas-giants", (req, res) => {
  const parsed = createGasGiantSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const planet = getPlanetById(parsed.data.planetId);
  if (!planet || planet.planet_type !== "gas_giant") {
    return res.status(400).json({ error: "Gas giant setups can only be logged on gas giant planets." });
  }

  for (const output of parsed.data.outputs) {
    const resource = getResourceById(output.resourceId);
    if (!resource || resource.type !== "gas_giant_output") {
      return res.status(400).json({ error: "Gas giant outputs must be Hydrogen, Deuterium, or Fire Ice." });
    }
  }

  createGasGiantSite(parsed.data);
  return respondWithCreatedBootstrap(res, "create-gas-giant");
});

app.delete("/api/ore-veins/:id", (req, res) => {
  return respondAfterDelete(res, "delete-ore-vein", "ore-vein", req.params.id, () => {
    deleteById("ore_veins", req.params.id);
  });
});

app.patch("/api/ore-veins/:id/location", (req, res) => {
  return moveEntry(req, res, "ore_veins", "move-ore-vein", "solid");
});

app.delete("/api/liquids/:id", (req, res) => {
  return respondAfterDelete(res, "delete-liquid", "liquid", req.params.id, () => {
    deleteById("liquid_sites", req.params.id);
  });
});

app.patch("/api/liquids/:id/location", (req, res) => {
  return moveEntry(req, res, "liquid_sites", "move-liquid", "solid");
});

app.delete("/api/oil-extractors/:id", (req, res) => {
  return respondAfterDelete(res, "delete-oil", "oil-extractor", req.params.id, () => {
    deleteById("oil_extractors", req.params.id);
  });
});

app.patch("/api/oil-extractors/:id/location", (req, res) => {
  return moveEntry(req, res, "oil_extractors", "move-oil", "solid");
});

app.delete("/api/gas-giants/:id", (req, res) => {
  return respondAfterDelete(res, "delete-gas-giant", "gas-giant", req.params.id, () => {
    deleteById("gas_giant_sites", req.params.id);
  });
});

app.patch("/api/gas-giants/:id/location", (req, res) => {
  return moveEntry(req, res, "gas_giant_sites", "move-gas-giant", "gas_giant");
});

app.delete("/api/planets/:id", (req, res) => {
  return respondAfterDelete(res, "delete-planet", "planet", req.params.id, () => {
    deletePlanet(req.params.id);
  });
});

app.delete("/api/systems/:id", (req, res) => {
  return respondAfterDelete(res, "delete-system", "system", req.params.id, () => {
    deleteSolarSystem(req.params.id);
  });
});

app.get("/api/export", (_req, res) => {
  const snapshot = exportSnapshot();
  const exportDirectory = path.resolve(process.cwd(), "..", "data", "exports");
  const exportName = `dsp-resource-sheet-${new Date().toISOString().replaceAll(":", "-")}.json`;
  const exportPath = path.join(exportDirectory, exportName);
  writeFileSync(exportPath, JSON.stringify(snapshot, null, 2), "utf8");
  return res.json({ exportPath, snapshot });
});

app.post("/api/import", (req, res) => {
  const parsed = importSnapshotSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  importSnapshot(parsed.data);
  return respondWithBootstrap(res, "import");
});

if (existsSync(clientDistDirectory)) {
  app.use(express.static(clientDistDirectory));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(clientDistDirectory, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`DSP Resource Sheet server listening on http://localhost:${port}`);
  console.log(`Timing log file: ${timingLogPath}`);
  writeTimingLog(`[startup] server listening on http://localhost:${port}`);
});
