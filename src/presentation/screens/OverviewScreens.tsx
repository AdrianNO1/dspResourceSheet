import { ResourceIcon } from "../../components/ResourceIcon";
import { SearchableSelect, type SearchableSelectOption } from "../../components/SearchableSelect";
import type {
  OverviewViewModel,
  ProjectGoalRow,
  ResourceOriginBreakdownRow,
} from "../../application/workspaceQueries";
import type {
  ProductionOverviewStats,
  ProductionWarning,
} from "../../lib/productionPlanner";
import type { Project, ResourceSummary, SolarSystem } from "../../lib/types";

type ProjectOverviewScreenProps = {
  projects: Project[];
  selectedProjectId: string | null;
  selectedProject: Project | null;
  selectedProjectGoalRows: ProjectGoalRow[];
  productionOverview: ProductionOverviewStats;
  productionWarnings: ProductionWarning[];
  onSelectProject: (projectId: string) => void;
  formatValue: (value: number, digits?: number) => string;
  formatFixedValue: (value: number, digits?: number) => string;
};

export function ProjectOverviewScreen({
  projects,
  selectedProjectId,
  selectedProject,
  selectedProjectGoalRows,
  productionOverview,
  productionWarnings,
  onSelectProject,
  formatValue,
  formatFixedValue,
}: ProjectOverviewScreenProps) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Overview</p>
          <h2>{selectedProject ? `${selectedProject.name} progress` : "Project progress"}</h2>
        </div>
        <span className="helper-text">Selected project is shared with the Production and Projects tabs.</span>
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

      {selectedProject ? (
        <>
          <div className="transport-metric-grid">
            <article className="entry-stat">
              <span>Crafted targets</span>
              <strong>{productionOverview.importedCraftedCount}</strong>
              <span>{formatValue(productionOverview.plannedCraftedThroughput)} / min total</span>
            </article>
            <article className="entry-stat">
              <span>Planned lines</span>
              <strong>{productionOverview.plannedLineCount}</strong>
              <span>Imported factory footprint</span>
            </article>
            <article className="entry-stat">
              <span>Placed sites</span>
              <strong>{productionOverview.placedSiteCount}</strong>
              <span>{productionOverview.activeSiteCount} marked active</span>
            </article>
            <article className="entry-stat">
              <span>Raw goals covered</span>
              <strong>{productionOverview.totalRawGoals === 0 ? "None" : `${productionOverview.coveredRawGoals} / ${productionOverview.totalRawGoals}`}</strong>
              <span>{formatFixedValue(productionOverview.rawCoveragePercent, 1)}% coverage</span>
            </article>
          </div>

          <div className="overview-breakdown-grid">
            <section className="overview-breakdown-panel">
              <div className="overview-breakdown-heading">
                <h4>Top raw goals</h4>
                <span>{selectedProjectGoalRows.length} tracked</span>
              </div>
              {selectedProjectGoalRows.length > 0 ? (
                <div className="overview-breakdown-list">
                  {selectedProjectGoalRows.slice(0, 8).map((row) => (
                    <article key={row.id} className="overview-breakdown-row">
                      <div className="overview-breakdown-row-top">
                        <div>
                          <strong>{row.resourceName}</strong>
                          <span>{formatValue(row.supplyPerMinute)} / {formatValue(row.targetPerMinute)} / min</span>
                        </div>
                        <div className="overview-breakdown-values">
                          <strong>{formatFixedValue(row.coveragePercent, 1)}%</strong>
                        </div>
                      </div>
                      <div className="progress-rail overview-breakdown-bar">
                        <span style={{ width: `${Math.min(100, row.coveragePercent)}%` }} />
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty-state">This project has no raw requirements yet.</p>
              )}
            </section>

            <section className="overview-breakdown-panel">
              <div className="overview-breakdown-heading">
                <h4>Warnings</h4>
                <span>{productionWarnings.length}</span>
              </div>
              {productionWarnings.length > 0 ? (
                <div className="overview-breakdown-list">
                  {productionWarnings.map((warning) => (
                    <article key={warning.id} className={`overview-breakdown-row ${warning.severity === "danger" ? "warning-card-danger" : "warning-card-warning"}`}>
                      <div className="overview-breakdown-row-top">
                        <div>
                          <strong>{warning.title}</strong>
                          <span>{warning.detail}</span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty-state">No planner warnings for this project right now.</p>
              )}
            </section>
          </div>
        </>
      ) : (
        <p className="empty-state">Create or select a project to see project-level progress.</p>
      )}
    </section>
  );
}

type RawResourcesScreenProps = {
  solarSystems: SolarSystem[];
  selectedOverviewResourceId: string;
  setSelectedOverviewResourceId: (resourceId: string) => void;
  overviewView: OverviewViewModel;
  miningSpeedPercent: number;
  openOverviewTransportModal: () => void;
  formatValue: (value: number, digits?: number) => string;
  formatFixedValue: (value: number, digits?: number) => string;
  isTargetMet: (currentPerMinute: number, targetPerMinute: number) => boolean;
  getProgressPercent: (summary: ResourceSummary) => number;
  getSummaryTargetPerMinute: (summary: ResourceSummary) => number;
  getRawCardPlanningLabel: (summary: ResourceSummary, miningSpeedPercent: number) => string | null;
  getBreakdownSecondaryText: (summary: ResourceSummary, row: ResourceOriginBreakdownRow) => string;
};

export function RawResourcesScreen({
  solarSystems,
  selectedOverviewResourceId,
  setSelectedOverviewResourceId,
  overviewView,
  miningSpeedPercent,
  openOverviewTransportModal,
  formatValue,
  formatFixedValue,
  isTargetMet,
  getProgressPercent,
  getSummaryTargetPerMinute,
  getRawCardPlanningLabel,
  getBreakdownSecondaryText,
}: RawResourcesScreenProps) {
  const {
    overviewResourceSummaries,
    selectedOverviewSummary,
    selectedOverviewTransportSources,
    selectedOverviewBreakdown,
    combinedTargetPerMinute,
    combinedCappedSupplyPerMinute,
    combinedProgressPercent,
  } = overviewView;

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Live Totals</p>
          <h2>Combined resource progress</h2>
        </div>
        <span className="helper-text">Click any resource to inspect which systems and planets supply it.</span>
      </div>
      <article className="overview-total-card">
        <div className="overview-total-header">
          <div>
            <h3>Total throughput</h3>
            <p>All targeted resources combined, normalized to per-minute output.</p>
          </div>
          <div className={`metric-line metric-line-inline ${isTargetMet(combinedCappedSupplyPerMinute, combinedTargetPerMinute) ? "metric-line-done" : ""}`}>
            <strong>{formatValue(combinedCappedSupplyPerMinute)}</strong>
            <span>/ {formatValue(combinedTargetPerMinute)} / min</span>
          </div>
        </div>
        <div className="progress-rail progress-rail-large">
          <span style={{ width: `${combinedProgressPercent}%` }} />
        </div>
      </article>
      <div className="resource-grid">
        {overviewResourceSummaries.map((summary) => {
          const planningLabel = getRawCardPlanningLabel(summary, miningSpeedPercent);
          return (
            <button
              key={summary.resourceId}
              type="button"
              className={`resource-card resource-card-button ${selectedOverviewResourceId === summary.resourceId ? "resource-card-active" : ""}`}
              onClick={() => setSelectedOverviewResourceId(summary.resourceId)}
            >
              <div className="resource-card-top">
                <div className="resource-title">
                  <ResourceIcon
                    name={summary.name}
                    iconUrl={summary.iconUrl}
                    colorStart={summary.colorStart}
                    colorEnd={summary.colorEnd}
                  />
                  <div>
                    <h3>{summary.name}</h3>
                    <p>Per minute</p>
                  </div>
                </div>
              </div>

              <div className={`metric-line metric-line-inline ${isTargetMet(summary.supplyPerMinute, getSummaryTargetPerMinute(summary)) ? "metric-line-done" : ""}`}>
                <strong>{formatValue(summary.supplyPerMinute)}</strong>
                <span>/ {formatValue(getSummaryTargetPerMinute(summary))} / min</span>
              </div>
              <div className="progress-rail">
                <span style={{ width: `${getProgressPercent(summary)}%` }} />
              </div>
              <div className="resource-meta">
                <span>{summary.placementCount} setups</span>
                {planningLabel ? (
                  <span>{planningLabel}</span>
                ) : (
                  summary.type !== "liquid_pump" && <span>{formatValue(summary.supplyPerMinute)} / min</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {selectedOverviewSummary ? (
        <article className="overview-detail-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Resource origins</p>
              <h3>{selectedOverviewSummary.name}</h3>
            </div>
            <div className="overview-detail-actions">
              <button
                type="button"
                className="primary-button"
                onClick={openOverviewTransportModal}
                disabled={selectedOverviewTransportSources.length === 0 || solarSystems.length === 0}
              >
                Open transport calc
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setSelectedOverviewResourceId("")}
              >
                Close
              </button>
            </div>
          </div>

          <div className="overview-detail-summary">
            <div className="entry-stat">
              <span>Project target</span>
              <strong>{formatValue(getSummaryTargetPerMinute(selectedOverviewSummary))}</strong>
              <span>/ min</span>
            </div>
            <div className="entry-stat">
              <span>Active setups</span>
              <strong>{selectedOverviewSummary.placementCount}</strong>
              <span>Logged locations</span>
            </div>
            <div className="entry-stat">
              <span>Tracked output</span>
              <strong>{formatValue(selectedOverviewSummary.supplyPerMinute)}</strong>
              <span>/ min</span>
            </div>
          </div>

          {selectedOverviewBreakdown && (selectedOverviewBreakdown.systems.length > 0 || selectedOverviewBreakdown.planets.length > 0) ? (
            <div className="overview-breakdown-grid">
              <section className="overview-breakdown-panel">
                <div className="overview-breakdown-heading">
                  <h4>By system</h4>
                  <span>{selectedOverviewBreakdown.systems.length} systems</span>
                </div>
                <div className="overview-breakdown-list">
                  {selectedOverviewBreakdown.systems.map((row) => (
                    <article key={row.id} className="overview-breakdown-row">
                      <div className="overview-breakdown-row-top">
                        <div>
                          <strong>{row.name}</strong>
                        </div>
                        <div className="overview-breakdown-values">
                          <strong>{formatFixedValue(row.percentOfTotal, 1)}%</strong>
                          <span>{formatValue(row.supplyPerMinute)} / min</span>
                        </div>
                      </div>
                      <div className="progress-rail overview-breakdown-bar">
                        <span style={{ width: `${row.percentOfTotal}%` }} />
                      </div>
                      <div className="resource-meta">
                        <span>{getBreakdownSecondaryText(selectedOverviewSummary, row)}</span>
                        <span>{row.placementCount} setups</span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="overview-breakdown-panel">
                <div className="overview-breakdown-heading">
                  <h4>By planet</h4>
                  <span>{selectedOverviewBreakdown.planets.length} planets</span>
                </div>
                <div className="overview-breakdown-list">
                  {selectedOverviewBreakdown.planets.map((row) => (
                    <article key={row.id} className="overview-breakdown-row">
                      <div className="overview-breakdown-row-top">
                        <div>
                          <strong>{row.name}</strong>
                          <span>{row.context}</span>
                        </div>
                        <div className="overview-breakdown-values">
                          <strong>{formatFixedValue(row.percentOfTotal, 1)}%</strong>
                          <span>{formatValue(row.supplyPerMinute)} / min</span>
                        </div>
                      </div>
                      <div className="progress-rail overview-breakdown-bar">
                        <span style={{ width: `${row.percentOfTotal}%` }} />
                      </div>
                      <div className="resource-meta">
                        <span>{getBreakdownSecondaryText(selectedOverviewSummary, row)}</span>
                        <span>{row.placementCount} setups</span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <p className="empty-state">No supply sources are logged for this resource yet.</p>
          )}
        </article>
      ) : (
        <p className="empty-state">Select a resource card to open its planet and system breakdown.</p>
      )}
    </section>
  );
}

type OverviewTransportModalProps = {
  isOpen: boolean;
  selectedOverviewSummary: ResourceSummary | null;
  overviewView: OverviewViewModel;
  solarSystems: SolarSystem[];
  overviewTransportTargetSystemId: string;
  setOverviewTransportTargetSystemId: (systemId: string) => void;
  overviewTransportThroughputPerMinute: number;
  setOverviewTransportThroughputPerMinute: (throughput: number) => void;
  closeOverviewTransportModal: () => void;
  formatValue: (value: number, digits?: number) => string;
  formatFixedValue: (value: number, digits?: number) => string;
};

export function OverviewTransportModal({
  isOpen,
  selectedOverviewSummary,
  overviewView,
  solarSystems,
  overviewTransportTargetSystemId,
  setOverviewTransportTargetSystemId,
  overviewTransportThroughputPerMinute,
  setOverviewTransportThroughputPerMinute,
  closeOverviewTransportModal,
  formatValue,
  formatFixedValue,
}: OverviewTransportModalProps) {
  if (!isOpen || !selectedOverviewSummary) {
    return null;
  }

  const targetSystemOptions: SearchableSelectOption[] = solarSystems.map((solarSystem) => ({
    value: solarSystem.id,
    label: solarSystem.name,
  }));

  const {
    overviewTransportUsesDefault,
    overviewTransportSystemRows,
    overviewTransportPlan,
    overviewTransportRows,
    overviewTransportTotalSupplyPerMinute,
    overviewTransportCoveragePercent,
    overviewTransportIncompleteSystemCount,
  } = overviewView;

  return (
    <div className="modal-backdrop" onClick={closeOverviewTransportModal}>
      <section
        className="modal-card overview-transport-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Resource transport</p>
            <h2>{selectedOverviewSummary.name}</h2>
          </div>
          <button type="button" className="ghost-button" onClick={closeOverviewTransportModal}>
            Close
          </button>
        </div>

        <p className="helper-text">
          Closest systems fill first. Sources at the same distance split the remaining demand proportionally to their tracked output.
        </p>

        <div className="overview-transport-controls">
          <label className="field">
            <span>Target system</span>
            <SearchableSelect
              options={targetSystemOptions}
              value={overviewTransportTargetSystemId}
              onChange={setOverviewTransportTargetSystemId}
              placeholder="Select system"
              searchPlaceholder="Search systems"
              emptyText="No systems match your search."
            />
          </label>

          <label className="field">
            <span>Throughput needed / min</span>
            <div className="input-with-hint">
              <input
                type="number"
                min={0}
                step="any"
                value={overviewTransportThroughputPerMinute}
                onChange={(event) => setOverviewTransportThroughputPerMinute(Number(event.target.value))}
                className={overviewTransportUsesDefault ? "input-with-inline-tag" : ""}
              />
              {overviewTransportUsesDefault && <span className="input-inline-hint">(default)</span>}
            </div>
          </label>
        </div>

        <div className="overview-transport-stat-grid">
          <div className="entry-stat">
            <span>Requested</span>
            <strong>{formatValue(overviewTransportPlan.requestedThroughputPerMinute)}</strong>
            <span>/ min</span>
          </div>
          <div className="entry-stat">
            <span>Assigned</span>
            <strong>{formatValue(overviewTransportPlan.assignedThroughputPerMinute)}</strong>
            <span>{formatFixedValue(overviewTransportCoveragePercent, 1)}% coverage</span>
          </div>
          <div className="entry-stat">
            <span>Target ILS needed</span>
            <strong>{formatFixedValue(overviewTransportPlan.totalTargetStationsNeeded, 1)}</strong>
            <span>Raw requirement</span>
          </div>
          <div className="entry-stat">
            <span>Total tracked supply</span>
            <strong>{formatValue(overviewTransportTotalSupplyPerMinute)}</strong>
            <span>{overviewTransportIncompleteSystemCount} systems missing cluster coordinates</span>
          </div>
        </div>

        {(overviewTransportIncompleteSystemCount > 0 || overviewTransportPlan.remainingThroughputPerMinute > 0) && (
          <div className="overview-transport-alerts">
            {overviewTransportIncompleteSystemCount > 0 && (
              <div className="overview-transport-alert">
                <strong>Missing coordinates</strong>
                <span>Import cluster systems in Settings to include every source system in the calculation.</span>
              </div>
            )}
            {overviewTransportPlan.remainingThroughputPerMinute > 0 && (
              <div className="overview-transport-alert">
                <strong>Uncovered demand</strong>
                <span>{formatValue(overviewTransportPlan.remainingThroughputPerMinute)} / min is still uncovered after the current closest-first allocation.</span>
              </div>
            )}
          </div>
        )}

        <div className="overview-transport-grid">
          <section className="overview-breakdown-panel">
            <div className="overview-breakdown-heading">
              <h4>Source systems</h4>
              <span>{overviewTransportSystemRows.length} source systems</span>
            </div>

            {overviewTransportSystemRows.length > 0 ? (
              <div className="overview-transport-system-list">
                {overviewTransportSystemRows.map((row) => {
                  const isTargetSystem = row.systemId === overviewTransportTargetSystemId;

                  return (
                    <article key={row.systemId} className="overview-transport-system-row">
                      <div className="overview-transport-system-copy">
                        <strong>{row.systemName}</strong>
                        <span>{row.planetCount} planets | {formatValue(row.supplyPerMinute)} / min tracked</span>
                      </div>

                      {isTargetSystem ? (
                        <span className="context-chip">Local route (0 ly)</span>
                      ) : row.distanceLy === null ? (
                        <span className="context-chip">Cluster import needed</span>
                      ) : (
                        <span className="context-chip">{formatFixedValue(row.distanceLy, 1)} ly</span>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="empty-state">No supply planets are logged for this resource yet.</p>
            )}
          </section>

          <section className="overview-breakdown-panel">
            <div className="overview-breakdown-heading">
              <h4>Source planets</h4>
              <span>{overviewTransportRows.length} planets</span>
            </div>

            {overviewTransportRows.length > 0 ? (
              <div className="overview-breakdown-list">
                {overviewTransportRows.map((row) => (
                  <article
                    key={row.id}
                    className={`overview-breakdown-row ${row.isComplete ? "" : "overview-transport-row-incomplete"}`}
                  >
                    <div className="overview-breakdown-row-top">
                      <div>
                        <strong>{row.name}</strong>
                        <span>{row.context}</span>
                      </div>
                      <div className="overview-breakdown-values">
                        <strong>{formatFixedValue(row.utilizationPercent, 1)}%</strong>
                        <span>{formatValue(row.assignedPerMinute)} / {formatValue(row.supplyPerMinute)} / min</span>
                      </div>
                    </div>

                    <div className="progress-rail overview-breakdown-bar">
                      <span style={{ width: `${Math.min(100, row.utilizationPercent)}%` }} />
                    </div>

                    {row.isComplete ? (
                      <div className="resource-meta overview-transport-row-meta">
                        <span>
                          {row.distanceLy === 0
                            ? "Local route"
                            : `${formatFixedValue(row.distanceLy ?? 0, 1)} ly | ${formatFixedValue(row.roundTripSeconds ?? 0, 1)} s round trip`}
                        </span>
                        <span>Source ILS {row.sourceStationsNeeded === null ? "Incomplete" : formatFixedValue(row.sourceStationsNeeded, 1)}</span>
                      </div>
                    ) : (
                      <div className="resource-meta overview-transport-row-meta">
                        <span className="transport-warning">Import cluster systems to include {row.systemName} in this calculation.</span>
                        <span>{formatValue(row.supplyPerMinute)} / min tracked</span>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-state">No source planets are available for this transport calculation.</p>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
