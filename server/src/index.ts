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
  res.on("finish", () => {
    const elapsedMs = Date.now() - startedAt;
    if (req.path.startsWith("/api")) {
      writeTimingLog(`[api] ${req.method} ${req.path} ${res.statusCode} ${elapsedMs}ms`);
    }
  });
  next();
});

function respondWithBootstrap(res: express.Response, label: string) {
  const bootstrapStartedAt = Date.now();
  const payload = getBootstrapData();
  const bootstrapElapsedMs = Date.now() - bootstrapStartedAt;
  writeTimingLog(`[bootstrap] ${label} ${bootstrapElapsedMs}ms`);
  return res.json(payload);
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
  res.status(201);
  return respondWithBootstrap(res, "create-resource");
});

app.post("/api/systems", (req, res) => {
  const parsed = createSolarSystemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const systemId = createSolarSystem(parsed.data.name);
  setSetting("currentSolarSystemId", systemId);
  res.status(201);
  return respondWithBootstrap(res, "create-system");
});

app.post("/api/planets", (req, res) => {
  const parsed = createPlanetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const planetId = createPlanet(parsed.data);
  setSetting("currentSolarSystemId", parsed.data.solarSystemId);
  setSetting("currentPlanetId", planetId);
  res.status(201);
  return respondWithBootstrap(res, "create-planet");
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
  res.status(201);
  return respondWithBootstrap(res, "create-project");
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
  res.status(201);
  return respondWithBootstrap(res, "create-ore-vein");
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
  res.status(201);
  return respondWithBootstrap(res, "create-liquid");
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
  res.status(201);
  return respondWithBootstrap(res, "create-oil");
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
  res.status(201);
  return respondWithBootstrap(res, "create-gas-giant");
});

app.delete("/api/ore-veins/:id", (req, res) => {
  const deleteStartedAt = Date.now();
  deleteById("ore_veins", req.params.id);
  writeTimingLog(`[delete] ore-vein ${req.params.id} ${Date.now() - deleteStartedAt}ms`);
  return respondWithBootstrap(res, "delete-ore-vein");
});

app.delete("/api/liquids/:id", (req, res) => {
  const deleteStartedAt = Date.now();
  deleteById("liquid_sites", req.params.id);
  writeTimingLog(`[delete] liquid ${req.params.id} ${Date.now() - deleteStartedAt}ms`);
  return respondWithBootstrap(res, "delete-liquid");
});

app.delete("/api/oil-extractors/:id", (req, res) => {
  const deleteStartedAt = Date.now();
  deleteById("oil_extractors", req.params.id);
  writeTimingLog(`[delete] oil-extractor ${req.params.id} ${Date.now() - deleteStartedAt}ms`);
  return respondWithBootstrap(res, "delete-oil");
});

app.delete("/api/gas-giants/:id", (req, res) => {
  const deleteStartedAt = Date.now();
  deleteById("gas_giant_sites", req.params.id);
  writeTimingLog(`[delete] gas-giant ${req.params.id} ${Date.now() - deleteStartedAt}ms`);
  return respondWithBootstrap(res, "delete-gas-giant");
});

app.delete("/api/planets/:id", (req, res) => {
  const deleteStartedAt = Date.now();
  deletePlanet(req.params.id);
  writeTimingLog(`[delete] planet ${req.params.id} ${Date.now() - deleteStartedAt}ms`);
  return respondWithBootstrap(res, "delete-planet");
});

app.delete("/api/systems/:id", (req, res) => {
  const deleteStartedAt = Date.now();
  deleteSolarSystem(req.params.id);
  writeTimingLog(`[delete] system ${req.params.id} ${Date.now() - deleteStartedAt}ms`);
  return respondWithBootstrap(res, "delete-system");
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
