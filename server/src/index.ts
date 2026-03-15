import express from "express";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
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

app.use(express.json({ limit: "10mb" }));

app.get("/api/bootstrap", (_req, res) => {
  res.json(getBootstrapData());
});

app.post("/api/resources", (req, res) => {
  const parsed = createResourceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  createResource(parsed.data.name, parsed.data.type);
  return res.status(201).json(getBootstrapData());
});

app.post("/api/systems", (req, res) => {
  const parsed = createSolarSystemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const systemId = createSolarSystem(parsed.data.name);
  setSetting("currentSolarSystemId", systemId);
  return res.status(201).json(getBootstrapData());
});

app.post("/api/planets", (req, res) => {
  const parsed = createPlanetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const planetId = createPlanet(parsed.data);
  setSetting("currentSolarSystemId", parsed.data.solarSystemId);
  setSetting("currentPlanetId", planetId);
  return res.status(201).json(getBootstrapData());
});

app.patch("/api/settings", (req, res) => {
  const parsed = patchSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  for (const [key, value] of Object.entries(parsed.data)) {
    setSetting(key, value === null ? "" : String(value));
  }

  return res.json(getBootstrapData());
});

app.post("/api/projects", (req, res) => {
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  createProject(parsed.data);
  return res.status(201).json(getBootstrapData());
});

app.patch("/api/projects/:projectId", (req, res) => {
  const parsed = updateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  updateProject(req.params.projectId, parsed.data);
  return res.json(getBootstrapData());
});

app.put("/api/projects/:projectId/goals", (req, res) => {
  const parsed = replaceGoalsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  replaceProjectGoals(req.params.projectId, parsed.data.goals);
  return res.json(getBootstrapData());
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
  return res.status(201).json(getBootstrapData());
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
  return res.status(201).json(getBootstrapData());
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
  return res.status(201).json(getBootstrapData());
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
  return res.status(201).json(getBootstrapData());
});

app.delete("/api/ore-veins/:id", (req, res) => {
  deleteById("ore_veins", req.params.id);
  return res.json(getBootstrapData());
});

app.delete("/api/liquids/:id", (req, res) => {
  deleteById("liquid_sites", req.params.id);
  return res.json(getBootstrapData());
});

app.delete("/api/oil-extractors/:id", (req, res) => {
  deleteById("oil_extractors", req.params.id);
  return res.json(getBootstrapData());
});

app.delete("/api/gas-giants/:id", (req, res) => {
  deleteById("gas_giant_sites", req.params.id);
  return res.json(getBootstrapData());
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
  return res.json(getBootstrapData());
});

if (existsSync(clientDistDirectory)) {
  app.use(express.static(clientDistDirectory));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(clientDistDirectory, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`DSP Resource Sheet server listening on http://localhost:${port}`);
});
