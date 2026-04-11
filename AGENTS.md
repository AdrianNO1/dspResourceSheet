# AGENTS.md

## Purpose

This repository contains a static React + Vite app for planning and tracking Dyson Sphere Program extraction, interstellar transport, and project demand.

The app is meant to answer questions like:

- What raw resources are currently logged on each planet and system?
- How much throughput per minute is available from miners, pumps, oil extractors, and gas giants?
- Which planets can satisfy a project's imported-item demand?
- How many source and target ILS stations are needed for the current transport assumptions?
- Where are the current shortages or overbooked logistics points?

There is no backend in active use for the app flow. Working data is stored in the browser and can be imported/exported as a snapshot.

## High-Level Behavior

- The user logs solar systems, planets, extraction sites, and crafted production sites.
- The app builds a bootstrap data model from browser storage.
- Derived views then calculate extraction totals, transport plans, coverage, warnings, and production summaries.
- Most user-facing behavior lives in `client/src/App.tsx`, while reusable math and planning logic live in `client/src/lib`.

## How Core Calculations Work

### Extraction Math

Core extraction formulas are in `client/src/lib/dspMath.ts`.

- Regular miner throughput:
  `coveredNodes * 30 * (miningSpeedPercent / 100)`
- Advanced miner throughput:
  `coveredNodes * 60 * (advancedSpeedPercent / 100) * (miningSpeedPercent / 100)`
- Water / sulfuric acid pumps:
  `pumpCount * 50 * (miningSpeedPercent / 100)`
- Oil extractor output:
  `baseOilPerSecondAt100Percent * 1.5 * (miningSpeedPercent / 100)`
- Oil values entered in the UI are normalized back to 100% mining speed when needed so persisted values stay comparable across settings.
- Orbital collector boost is derived from available fuel heat and mining speed, minus the collector's internal 30 MW draw.

Important constants are also in `dspMath.ts`, including miner rates, power draw, vessel capacity, vessel count per ILS, and ILS storage assumptions.

### Transport Math

Transport planning also lives in `client/src/lib/dspMath.ts`.

- Round trip time:
  `2 * (distance / vesselSpeed) + 2 * dockingSeconds`
- Items per minute per vessel:
  `(vesselCapacity * 60) / roundTripSeconds`
- Required source stations:
  `requiredVessels / 10`
  because one ILS is modeled as supporting 10 vessels.
- Required target stations:
  `throughputPerMinute * (roundTripSeconds / 60) / ilsStorageItems`

`getMultiSourceTransportPlan` allocates requested throughput from the closest complete sources first. Sources with the same distance share demand proportionally by their available supply.

### Production Planning

Production planning is in `client/src/lib/productionPlanner.ts`.

- Raw producers are built from logged ore veins, liquid sites, oil extractors, and gas giant outputs.
- Crafted producers come from placed production sites for imported items.
- Consumers are the dependencies of placed production sites.
- Allocation prefers local supply first, then same-system, then remote supply using cluster distance.
- The planner computes dependency coverage, shortages, line counts, mixed ILS fill, outbound ILS requirements, and overview stats.
- Warning generation checks for:
  - missing extraction ILS capacity
  - overbooked extraction ILS capacity
  - overbooked outbound ILS on production sites
  - dependency shortages

Planets can now have both:

- a default `extraction_outbound_ils_count`
- per-resource `extraction_outbound_ils_overrides`

When a resource-specific override exists, planner warnings and source-capacity checks use the override first.

### Cluster and Distance Logic

`client/src/lib/dspCluster.ts` handles cluster parsing and generated system-distance helpers. `productionPlanner.ts` uses that distance data to evaluate remote allocations.

If you change distance logic, also review:

- transport requirement calculations
- overview transport summaries
- production warning generation

### Local Storage and Data Normalization

`client/src/lib/localStore.ts` is the persistence layer.

- Data is stored in IndexedDB as a single snapshot.
- The file seeds default resources and settings.
- On load, it normalizes arrays, numeric fields, settings, and newer schema additions.
- `buildBootstrap` is where persisted records are converted into the derived bootstrap payload used by the UI.

If you add fields to persisted entities, update:

1. the type definitions in `client/src/lib/types.ts`
2. snapshot normalization in `localStore.ts`
3. mutation handlers in `localStore.ts`
4. any affected derived bootstrap calculations

## Project Structure

### Root

- `package.json`
  workspace entry point; common dev/build/lint commands delegate to the client workspace
- `README.md`
  short project usage notes
- `scripts/`
  utility scripts for importing recipe data and downloading DSP icons
- `data/`
  supporting data files used during development workflows
- `server/`
  currently not part of the main runtime flow; the active app is effectively client-only

### Client App

- `client/src/App.tsx`
  main application shell, view state, form handlers, and rendering
- `client/src/App.css`
  application styling
- `client/src/components/`
  reusable UI pieces like resource icon/select controls
- `client/src/lib/api.ts`
  frontend API wrapper around the local store layer
- `client/src/lib/localStore.ts`
  IndexedDB persistence, snapshot normalization, seeding, and mutation routing
- `client/src/lib/dspMath.ts`
  reusable extraction and transport formulas
- `client/src/lib/productionPlanner.ts`
  supply allocation, site coverage, warnings, and production summaries
- `client/src/lib/projectImport.ts`
  FactorioLab CSV import parsing
- `client/src/lib/factoriolabCatalog.ts`
  recipe/reference helpers used to enrich imported production data
- `client/src/lib/*.generated.ts`
  generated catalog/reference data; avoid hand-editing unless the workflow specifically requires it
- `client/src/lib/types.ts`
  shared domain model types across the client code
- `client/public/icons/`
  game and resource art used in the UI

## Working Conventions For Agents

- Prefer changing calculation logic in the shared lib modules rather than duplicating formulas in `App.tsx`.
- Keep persisted data backward-compatible whenever possible; normalize old snapshots instead of assuming a fresh schema.
- Treat `App.tsx` as orchestration and presentation. If a new rule or formula can live in `lib/`, it usually should.
- Be careful when changing seeded resources, generated catalog files, or persistence schema because they affect existing user snapshots.
- Generated files should only be updated via the appropriate script or a clearly intentional regeneration workflow.
- Never use `git push` unless the user explicitly asks for it.
- Always make a git commit when it makes sense to preserve a coherent, reviewable unit of work.

## Useful Commands

- `npm run dev`
- `npm run build`
- `npm run lint`

Run build or other relevant verification after meaningful changes when feasible.
