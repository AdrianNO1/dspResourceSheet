import { ResourceIcon } from "../../components/ResourceIcon";
import type { Project, ResourceType } from "../../lib/types";
import { AutoGrowTextarea, FileDropInput } from "../components/FormControls";

type ProjectGoalInputRow = {
  id: string;
  name: string;
  iconUrl: string | null;
  colorStart: string;
  colorEnd: string;
  unitLabel: string;
  step: number;
};

type ProjectsScreenProps = {
  busy: boolean;
  projects: Project[];
  selectedProjectId: string | null;
  selectedProject: Project | null;
  projectNameDraft: string;
  projectNotesDraft: string;
  projectActiveDraft: boolean;
  goalDrafts: Record<string, number>;
  goalInputRows: ProjectGoalInputRow[];
  newProjectName: string;
  newProjectNotes: string;
  onSelectProject: (projectId: string) => void;
  onProjectNameChange: (value: string) => void;
  onProjectNotesChange: (value: string) => void;
  onProjectActiveChange: (value: boolean) => void;
  onGoalChange: (resourceId: string, value: number) => void;
  onSaveProject: () => void;
  onExistingProjectCsvImport: (file: File | undefined) => void;
  onNewProjectNameChange: (value: string) => void;
  onNewProjectNotesChange: (value: string) => void;
  onCreateProject: () => void;
  onProjectCsvImport: (file: File | undefined) => void;
};

export function ProjectsScreen({
  busy,
  projects,
  selectedProjectId,
  selectedProject,
  projectNameDraft,
  projectNotesDraft,
  projectActiveDraft,
  goalDrafts,
  goalInputRows,
  newProjectName,
  newProjectNotes,
  onSelectProject,
  onProjectNameChange,
  onProjectNotesChange,
  onProjectActiveChange,
  onGoalChange,
  onSaveProject,
  onExistingProjectCsvImport,
  onNewProjectNameChange,
  onNewProjectNotesChange,
  onCreateProject,
  onProjectCsvImport,
}: ProjectsScreenProps) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Projects</p>
          <h2>Demand editor</h2>
        </div>
      </div>

      <div className="project-pills">
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            className={`project-pill ${project.id === selectedProjectId ? "project-pill-active" : ""}`}
            onClick={() => onSelectProject(project.id)}
          >
            {project.name}
            <span>{project.is_active === 1 ? "Active" : "Archived"}</span>
          </button>
        ))}
      </div>

      {selectedProject && (
        <>
          <label className="field">
            <span>Name</span>
            <input value={projectNameDraft} onChange={(event) => onProjectNameChange(event.target.value)} />
          </label>
          <label className="field">
            <span>Notes</span>
            <AutoGrowTextarea value={projectNotesDraft} onChange={(event) => onProjectNotesChange(event.target.value)} rows={3} />
          </label>
          <label className="toggle-field">
            <input type="checkbox" checked={projectActiveDraft} onChange={(event) => onProjectActiveChange(event.target.checked)} />
            <span>Counts toward combined demand</span>
          </label>
          <div className="goal-list">
            {goalInputRows.map((resource) => (
              <label key={resource.id} className="goal-row">
                <div className="goal-row-title">
                  <ResourceIcon
                    name={resource.name}
                    iconUrl={resource.iconUrl}
                    colorStart={resource.colorStart}
                    colorEnd={resource.colorEnd}
                    size="sm"
                  />
                  <div>
                    <strong>{resource.name}</strong>
                    <span>{resource.unitLabel}</span>
                  </div>
                </div>
                <input
                  type="number"
                  min={0}
                  step={resource.step}
                  value={goalDrafts[resource.id] ?? 0}
                  onChange={(event) => onGoalChange(resource.id, Number(event.target.value))}
                />
              </label>
            ))}
          </div>
          <button type="button" className="primary-button full-width" onClick={onSaveProject} disabled={busy}>
            Save project
          </button>

          <div className="divider" />

          <div className="section-heading compact-section-heading">
            <div>
              <p className="eyebrow">Import</p>
              <h3>Replace from CSV</h3>
            </div>
          </div>
          <FileDropInput
            accept=".csv,text/csv"
            description="Drop a FactorioLab CSV here to replace this project's raw goals and crafted-item production catalog."
            disabled={busy}
            label="Existing project CSV"
            onSelect={onExistingProjectCsvImport}
          />
        </>
      )}

      <div className="divider" />

      <label className="field">
        <span>New project name</span>
        <input value={newProjectName} onChange={(event) => onNewProjectNameChange(event.target.value)} placeholder="Mall expansion" />
      </label>
      <label className="field">
        <span>Notes</span>
        <AutoGrowTextarea value={newProjectNotes} onChange={(event) => onNewProjectNotesChange(event.target.value)} rows={2} />
      </label>
      <button type="button" className="ghost-button full-width" onClick={onCreateProject} disabled={busy}>
        Create project
      </button>

      <div className="divider" />

      <div className="section-heading compact-section-heading">
        <div>
          <p className="eyebrow">Import</p>
          <h3>New project from CSV</h3>
        </div>
      </div>
      <FileDropInput
        accept=".csv,text/csv"
        description="Drop a FactorioLab CSV here to create a project with raw goals and a crafted-item production catalog."
        disabled={busy}
        label="Project CSV"
        onSelect={onProjectCsvImport}
      />
    </section>
  );
}

type SettingsScreenProps = {
  busy: boolean;
  clusterAddressDraft: string;
  clusterHelperText: string;
  canImportCluster: boolean;
  onClusterAddressChange: (value: string) => void;
  onImportCluster: () => void;
  miningSpeedPercent: number;
  onMiningSpeedChange: (value: number) => void;
  onMiningSpeedIncrement: () => void;
  vesselCapacityItems: number;
  onVesselCapacityChange: (value: number) => void;
  onVesselCapacityIncrement: () => void;
  ilsStorageItems: number;
  onIlsStorageChange: (value: number) => void;
  onIlsStorageIncrement: () => void;
  vesselSpeedLyPerSecond: number;
  onVesselSpeedChange: (value: number) => void;
  vesselCruisingSpeedMetersPerSecond: number;
  onVesselCruisingSpeedChange: (value: number) => void;
  vesselDockingSeconds: number;
  onVesselDockingSecondsChange: (value: number) => void;
  quickCalcDistanceLy: number;
  onQuickCalcDistanceChange: (value: number) => void;
  quickCalcThroughputPerMinute: number;
  onQuickCalcThroughputChange: (value: number) => void;
  quickCalcRoundTripLabel: string;
  quickCalcPerVesselLabel: string;
  quickCalcRequiredIlsLabel: string;
  quickCalcTargetIlsLabel: string;
  newResourceName: string;
  onNewResourceNameChange: (value: string) => void;
  newResourceType: ResourceType;
  onNewResourceTypeChange: (value: ResourceType) => void;
  canCreateResource: boolean;
  onCreateResource: () => void;
  onExport: () => void;
  onImport: (file: File | undefined) => void;
};

export function SettingsScreen({
  busy,
  clusterAddressDraft,
  clusterHelperText,
  canImportCluster,
  onClusterAddressChange,
  onImportCluster,
  miningSpeedPercent,
  onMiningSpeedChange,
  onMiningSpeedIncrement,
  vesselCapacityItems,
  onVesselCapacityChange,
  onVesselCapacityIncrement,
  ilsStorageItems,
  onIlsStorageChange,
  onIlsStorageIncrement,
  vesselSpeedLyPerSecond,
  onVesselSpeedChange,
  vesselCruisingSpeedMetersPerSecond,
  onVesselCruisingSpeedChange,
  vesselDockingSeconds,
  onVesselDockingSecondsChange,
  quickCalcDistanceLy,
  onQuickCalcDistanceChange,
  quickCalcThroughputPerMinute,
  onQuickCalcThroughputChange,
  quickCalcRoundTripLabel,
  quickCalcPerVesselLabel,
  quickCalcRequiredIlsLabel,
  quickCalcTargetIlsLabel,
  newResourceName,
  onNewResourceNameChange,
  newResourceType,
  onNewResourceTypeChange,
  canCreateResource,
  onCreateResource,
  onExport,
  onImport,
}: SettingsScreenProps) {
  return (
    <>
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Cluster</p>
            <h2>Cluster address</h2>
          </div>
        </div>
        <label className="field">
          <span>Cluster address</span>
          <input value={clusterAddressDraft} onChange={(event) => onClusterAddressChange(event.target.value)} placeholder="07198444-64-799-10" />
        </label>
        <p className="helper-text">{clusterHelperText}</p>
        <button type="button" className="primary-button full-width" onClick={onImportCluster} disabled={busy || !canImportCluster}>
          Import cluster systems
        </button>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Configuration</p>
            <h2>Mining speed</h2>
          </div>
        </div>
        <label className="field">
          <span>Mining speed %</span>
          <input type="number" min={1} max={500} value={miningSpeedPercent} onChange={(event) => onMiningSpeedChange(Number(event.target.value))} />
        </label>
        <div className="action-row">
          <button type="button" className="ghost-button" onClick={onMiningSpeedIncrement}>
            +10%
          </button>
          <span className="helper-text">100% is base speed. Applied to ore miners, pumps, and orbital collectors.</span>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Transportation</p>
            <h2>Vessel settings</h2>
          </div>
        </div>
        <label className="field">
          <span>Vessel capacity</span>
          <input type="number" min={1} max={100000} value={vesselCapacityItems} onChange={(event) => onVesselCapacityChange(Number(event.target.value))} />
        </label>
        <div className="action-row">
          <button type="button" className="ghost-button" onClick={onVesselCapacityIncrement}>
            +200
          </button>
        </div>
        <label className="field">
          <span>ILS storage</span>
          <input type="number" min={1} max={1000000} value={ilsStorageItems} onChange={(event) => onIlsStorageChange(Number(event.target.value))} />
        </label>
        <div className="action-row">
          <button type="button" className="ghost-button" onClick={onIlsStorageIncrement}>
            +2000
          </button>
        </div>
        <label className="field">
          <span>Vessel speed (ly / sec)</span>
          <input type="number" min={0.001} step="any" value={vesselSpeedLyPerSecond} onChange={(event) => onVesselSpeedChange(Number(event.target.value))} />
        </label>
        <label className="field">
          <span>Cruising speed (m / sec)</span>
          <input
            type="number"
            min={1}
            step="any"
            value={vesselCruisingSpeedMetersPerSecond}
            onChange={(event) => onVesselCruisingSpeedChange(Number(event.target.value))}
          />
        </label>
        <label className="field">
          <span>Dock / undock seconds per leg</span>
          <input type="number" min={0} step="any" value={vesselDockingSeconds} onChange={(event) => onVesselDockingSecondsChange(Number(event.target.value))} />
        </label>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Transport</p>
            <h2>Quick calc</h2>
          </div>
        </div>
        <div className="transport-form-grid transport-form-grid-compact">
          <label className="field">
            <span>Distance (ly)</span>
            <input type="number" min={0} step="any" value={quickCalcDistanceLy} onChange={(event) => onQuickCalcDistanceChange(Number(event.target.value))} />
          </label>

          <label className="field">
            <span>Throughput / min</span>
            <input
              type="number"
              min={0}
              step="any"
              value={quickCalcThroughputPerMinute}
              onChange={(event) => onQuickCalcThroughputChange(Number(event.target.value))}
            />
          </label>
        </div>
        <div className="transport-metric-grid">
          <div className="entry-stat">
            <span>Round trip</span>
            <strong>{quickCalcRoundTripLabel}</strong>
          </div>
          <div className="entry-stat">
            <span>Per vessel</span>
            <strong>{quickCalcPerVesselLabel}</strong>
          </div>
          <div className="entry-stat">
            <span>Required ILS</span>
            <strong>{quickCalcRequiredIlsLabel}</strong>
          </div>
          <div className="entry-stat">
            <span>Target ILS</span>
            <strong>{quickCalcTargetIlsLabel}</strong>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Catalog</p>
            <h2>Custom resources</h2>
          </div>
        </div>
        <label className="field">
          <span>Resource name</span>
          <input value={newResourceName} onChange={(event) => onNewResourceNameChange(event.target.value)} placeholder="Optical ore" />
        </label>
        <label className="field">
          <span>Type</span>
          <select value={newResourceType} onChange={(event) => onNewResourceTypeChange(event.target.value as ResourceType)}>
            <option value="ore_vein">Ore vein</option>
            <option value="liquid_pump">Liquid pump</option>
            <option value="oil_extractor">Oil extractor</option>
            <option value="gas_giant_output">Gas giant output</option>
          </select>
        </label>
        <button type="button" className="ghost-button full-width" onClick={onCreateResource} disabled={busy || !canCreateResource}>
          Add resource
        </button>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Backups</p>
            <h2>Import / export</h2>
          </div>
        </div>
        <button type="button" className="primary-button full-width" onClick={onExport} disabled={busy}>
          Export JSON snapshot
        </button>
        <FileDropInput
          accept=".json,application/json"
          description="Drop a snapshot backup here to replace the current local dataset."
          disabled={busy}
          label="Snapshot JSON"
          onSelect={onImport}
        />
      </section>
    </>
  );
}
