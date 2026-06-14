import {
  Link,
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import {
  Activity,
  Boxes,
  ClipboardCheck,
  FileText,
  Plus,
  RefreshCcw,
  Settings,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  AutomationDueSlot,
  AutomationJob,
  AutomationRun,
  DoctorResult,
  HostedImportCandidate,
  Project,
  ProjectDetail,
  ProjectState,
  ReportDetail,
  ReportSummary,
  UpPlan,
  ValidationIssue,
  ValidationResult,
} from "../../domain";
import {
  type AutomationJobConfigInput,
  type AutomationJobConfigPlan,
  type AutomationPayload,
  type HeraklesEvent,
  type LocalArchiveResult,
  type LocalPromotionResult,
  type ProjectConfigPlan,
  type ProjectConfigValues,
  type ProjectDiscoveryRefreshResult,
  type StatusPayload,
  type UpRunResult,
  getAutomations,
  getConfigToml,
  getDoctor,
  getHostedImportCandidates,
  getProjectDetail,
  getProjects,
  getReport,
  getReports,
  getStatus,
  getUpPlan,
  postAddProject,
  postAutomationJobApply,
  postAutomationJobPlan,
  postAutomationRun,
  postAutomationTick,
  postConfigToml,
  postImportProjects,
  postLocalArchive,
  postLocalPromotion,
  postLocalPromotionPlan,
  postProjectConfigApply,
  postProjectConfigPlan,
  postProjectUp,
  postProjectsRefresh,
  postRemoveProject,
  postReportNote,
  postUp,
  postValidate,
  subscribeToEvents,
} from "./api";
import { latestAutomationRuns, nextDueSlots } from "./dashboardData";
import { reportIdFromPath } from "./reportPaths";

type Loadable<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: T };

function useResource<T>(loader: () => Promise<T>): [Loadable<T>, () => void] {
  const [state, setState] = useState<Loadable<T>>({ status: "loading" });
  const refresh = () => {
    setState({ status: "loading" });
    loader()
      .then((data) => setState({ status: "ready", data }))
      .catch((error) => setState({ status: "error", error: String(error) }));
  };
  useEffect(refresh, []);
  return [state, refresh];
}

function useEventStreamStatus(): HeraklesEvent | undefined {
  const [latest, setLatest] = useState<HeraklesEvent>();
  useEffect(
    () =>
      subscribeToEvents((event) => {
        setLatest(event);
        window.dispatchEvent(new CustomEvent("herakles-event", { detail: event }));
      }),
    [],
  );
  return latest;
}

function useRefreshOnEvents(refresh: () => void, types: HeraklesEvent["type"][]) {
  const key = types.join("|");
  useEffect(() => {
    const allowed = new Set(key.split("|") as HeraklesEvent["type"][]);
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<HeraklesEvent>).detail;
      if (allowed.has(detail.type)) refresh();
    };
    window.addEventListener("herakles-event", handler);
    return () => window.removeEventListener("herakles-event", handler);
  }, [refresh, key]);
}

function Shell() {
  const latestEvent = useEventStreamStatus();
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Boxes size={24} aria-hidden />
          <div>
            <strong>Herakles</strong>
            <span>Workspace control</span>
          </div>
        </div>
        <nav aria-label="Primary navigation">
          <Link to="/" activeProps={{ className: "active" }}>
            <Activity size={18} aria-hidden />
            Dashboard
          </Link>
          <Link to="/projects" activeProps={{ className: "active" }}>
            <Boxes size={18} aria-hidden />
            Projects
          </Link>
          <Link to="/reports" activeProps={{ className: "active" }}>
            <FileText size={18} aria-hidden />
            Reports
          </Link>
          <Link to="/automation" activeProps={{ className: "active" }}>
            <ClipboardCheck size={18} aria-hidden />
            Automation
          </Link>
          <Link to="/settings" activeProps={{ className: "active" }}>
            <Settings size={18} aria-hidden />
            Settings
          </Link>
        </nav>
      </aside>
      <section className="content">
        {latestEvent && <EventBanner event={latestEvent} />}
        <Outlet />
      </section>
    </main>
  );
}

function EventBanner({ event }: { event: HeraklesEvent }) {
  return (
    <output className="event-banner">
      <span>{event.type}</span>
      <strong>{event.message}</strong>
      <time>{new Date(event.generatedAt).toLocaleTimeString()}</time>
    </output>
  );
}

function Dashboard() {
  const [status, refresh] = useResource(getStatus);
  const [projects, refreshProjects] = useResource(getProjects);
  const [automation, refreshAutomation] = useResource(getAutomations);
  const [doctor, refreshDoctor] = useResource(getDoctor);
  useRefreshOnEvents(refresh, [
    "projects-refresh-finished",
    "up-finished",
    "validation-updated",
    "automation-finished",
  ]);
  useRefreshOnEvents(refreshProjects, ["projects-refresh-finished", "up-finished"]);
  useRefreshOnEvents(refreshAutomation, ["automation-log", "automation-finished"]);
  useRefreshOnEvents(refreshDoctor, [
    "projects-refresh-finished",
    "up-finished",
    "validation-updated",
  ]);
  if (status.status !== "ready") return <LoadState state={status} />;
  const topProjects = projects.status === "ready" ? projects.data.slice(0, 8) : [];
  return (
    <Screen
      title="Dashboard"
      actions={<IconButton label="Refresh" onClick={refresh} icon={<RefreshCcw size={16} />} />}
    >
      <div className="metrics">
        <Metric label="Projects" value={status.data.projectCount} />
        <Metric label="Hosted repositories" value={status.data.hostedCount} />
        <Metric label="Hosted clones" value={status.data.hostedCloneCount} />
        <Metric label="Local experiments" value={status.data.localExperimentCount} />
        <Metric label="Validation issues" value={status.data.validation.issues.length} />
      </div>
      <div className="split">
        <WorkspacePanel status={status.data} />
        {doctor.status === "ready" ? (
          <DoctorPanel data={doctor.data} title="Config Health" />
        ) : (
          <section className="panel">
            <h2>Config Health</h2>
            <LoadState state={doctor} />
          </section>
        )}
      </div>
      <ValidationResultPanel result={status.data.validation} title="Validation" />
      <section className="panel">
        <h2>Lifecycle</h2>
        <div className="state-grid">
          {Object.entries(status.data.counts).map(([state, count]) => (
            <div className="state-row" key={state}>
              <span>{state}</span>
              <strong>{count}</strong>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Recent Projects</h2>
        <ProjectTable projects={topProjects} compact />
      </section>
      <div className="split">
        <section className="panel">
          <h2>Next Automations</h2>
          {automation.status === "ready" ? (
            <DashboardDueSlots automation={automation.data} />
          ) : (
            <LoadState state={automation} />
          )}
        </section>
        <section className="panel">
          <h2>Recent Automation Runs</h2>
          {automation.status === "ready" ? (
            <DashboardAutomationRuns automation={automation.data} />
          ) : (
            <LoadState state={automation} />
          )}
        </section>
      </div>
    </Screen>
  );
}

function DashboardDueSlots({ automation }: { automation: AutomationPayload }) {
  const dueSlots = nextDueSlots(automation.due);
  if (dueSlots.length === 0) return <p className="empty">No due automation slots.</p>;
  return (
    <div className="list">
      {dueSlots.map((slot) => (
        <DueSlotRow className="dashboard-automation-row" key={slot.slotId} slot={slot} />
      ))}
    </div>
  );
}

function DueSlotRow({ slot, className = "" }: { slot: AutomationDueSlot; className?: string }) {
  return (
    <article className={`list-row ${className}`.trim()}>
      <div>
        <strong>{slot.jobId}</strong>
        <span>{slot.slotId}</span>
      </div>
      <time>{new Date(slot.dueAt).toLocaleString()}</time>
    </article>
  );
}

function DashboardAutomationRuns({ automation }: { automation: AutomationPayload }) {
  const runs = latestAutomationRuns(automation.runs);
  if (runs.length === 0) return <p className="empty">No automation runs yet.</p>;
  return (
    <div className="list">
      {runs.map((run) => (
        <article
          className="list-row dashboard-automation-row"
          key={`${run.jobId}-${run.slotId}-${run.startedAt}`}
        >
          <div>
            <strong>{run.jobId}</strong>
            <span>{run.message}</span>
            <time>{automationRunTime(run)}</time>
          </div>
          <span className={`badge ${run.status}`}>{run.status}</span>
        </article>
      ))}
    </div>
  );
}

function automationRunTime(run: AutomationRun) {
  return new Date(run.finishedAt ?? run.startedAt).toLocaleString();
}

function Projects() {
  const [projects, refresh] = useResource(getProjects);
  const [upPlan, refreshUpPlan] = useResource(getUpPlan);
  const [query, setQuery] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const refreshProjects = () => {
    refresh();
    refreshUpPlan();
  };
  useRefreshOnEvents(refresh, ["projects-refresh-finished", "up-finished", "validation-updated"]);
  useRefreshOnEvents(refreshUpPlan, [
    "projects-refresh-finished",
    "up-finished",
    "validation-updated",
  ]);
  const filtered = useMemo(() => {
    if (projects.status !== "ready") return [];
    const needle = query.toLowerCase();
    return projects.data.filter((project) =>
      [project.slug, project.state, project.source, project.visibility ?? ""].some((value) =>
        value.toLowerCase().includes(needle),
      ),
    );
  }, [projects, query]);
  return (
    <Screen
      title="Projects"
      actions={
        <>
          <button type="button" onClick={() => setImportOpen(true)}>
            Import from GitHub
          </button>
          <IconButton label="Refresh" onClick={refreshProjects} icon={<RefreshCcw size={16} />} />
        </>
      }
    >
      <AddProjectPanel onChanged={refreshProjects} />
      {upPlan.status === "ready" ? (
        <WorkspaceDriftPanel result={upPlan.data} onChanged={refreshProjects} />
      ) : null}
      {importOpen && (
        <Modal title="Import from GitHub" onClose={() => setImportOpen(false)}>
          <GitHubImportPanel
            onChanged={() => {
              refreshProjects();
              setImportOpen(false);
            }}
          />
        </Modal>
      )}
      <label className="search">
        <span>Search</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      {projects.status === "ready" ? (
        <>
          <ProjectTable
            projects={filtered}
            selectedProjectId={selectedProjectId}
            onSelectProject={setSelectedProjectId}
            onRemove={refreshProjects}
          />
          <ProjectSettingsPanel
            projects={projects.data}
            selectedProjectId={selectedProjectId}
            onApplied={() => {
              refreshProjects();
              setSelectedProjectId("");
            }}
          />
        </>
      ) : (
        <LoadState state={projects} />
      )}
    </Screen>
  );
}

function AddProjectPanel({ onChanged }: { onChanged: () => void }) {
  const [source, setSource] = useState<"github" | "local">("github");
  const [repo, setRepo] = useState("");
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [tags, setTags] = useState("");
  const [message, setMessage] = useState("");
  const add = async () => {
    setMessage("");
    try {
      const tagList = splitTags(tags);
      const result = await postAddProject({
        source,
        ...(source === "github" ? { repo } : {}),
        ...(source === "local" ? { name } : {}),
        ...(group.trim() ? { group: group.trim() } : {}),
        ...(tagList.length > 0 ? { tags: tagList } : {}),
      });
      if (source === "github") {
        assertProjectUpSucceeded(await postProjectUp(result.projectId));
      }
      setMessage(source === "github" ? "Project added and workspace updated." : "Project added.");
      setRepo("");
      setName("");
      setGroup("");
      setTags("");
      onChanged();
    } catch (error) {
      setMessage(String(error));
    }
  };
  return (
    <section className="panel">
      <h2>Add Project</h2>
      <div className="form-grid">
        <label>
          <span>Source</span>
          <select
            value={source}
            onChange={(event) => setSource(event.target.value as typeof source)}
          >
            <option value="github">GitHub</option>
            <option value="local">Local</option>
          </select>
        </label>
        {source === "github" ? (
          <label>
            <span>Repository</span>
            <input
              value={repo}
              onChange={(event) => setRepo(event.target.value)}
              placeholder="owner/name"
            />
          </label>
        ) : (
          <label>
            <span>Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="local-spike"
            />
          </label>
        )}
        <label>
          <span>Group</span>
          <input value={group} onChange={(event) => setGroup(event.target.value)} />
        </label>
        <label>
          <span>Tags</span>
          <input value={tags} onChange={(event) => setTags(event.target.value)} />
        </label>
      </div>
      <button type="button" onClick={add}>
        <Plus size={16} aria-hidden /> Add Project
      </button>
      {message && <p className={message.includes("added") ? "success" : "error"}>{message}</p>}
    </section>
  );
}

function WorkspaceDriftPanel({ result, onChanged }: { result: UpPlan; onChanged: () => void }) {
  const [ignoredPlanAt, setIgnoredPlanAt] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [upResult, setUpResult] = useState<UpRunResult>();
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [busy, setBusy] = useState(false);
  const driftItems = result.items.filter((item) => item.action !== "skip");
  const ignored = ignoredPlanAt === result.generatedAt;
  const primaryAction = shouldScaffoldFromConfiguration(driftItems)
    ? "Scaffold from Configuration"
    : "Sync Workspace";

  if (ignored || driftItems.length === 0) return null;

  const runUp = async () => {
    setBusy(true);
    setMessage("");
    try {
      setUpResult(await postUp());
      setMessageKind("success");
      setMessage("Workspace up complete.");
      onChanged();
    } catch (error) {
      setMessageKind("error");
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Workspace Drift" onClose={() => setIgnoredPlanAt(result.generatedAt)}>
      <div className="panel-heading-row">
        <div>
          <p className="muted">
            Configuration expects {driftItems.length} workspace item
            {driftItems.length === 1 ? "" : "s"} that do not fully match disk.
          </p>
        </div>
        <div className="row-actions">
          <button type="button" onClick={runUp} disabled={busy}>
            {primaryAction}
          </button>
          <button type="button" className="small-button" onClick={() => setReviewing(!reviewing)}>
            {reviewing ? "Hide Dry Run" : "Review Dry Run"}
          </button>
          <button
            type="button"
            className="small-button"
            onClick={() => setIgnoredPlanAt(result.generatedAt)}
          >
            Ignore
          </button>
        </div>
      </div>
      {reviewing && (
        <div className="list">
          {driftItems.map((item) => (
            <article className="list-row" key={`${item.project.id}-${item.action}`}>
              <div>
                <strong>{item.project.repo}</strong>
                <span>{item.reason}</span>
                <span className="mono">{item.project.path}</span>
              </div>
              <span className="badge">{item.action}</span>
            </article>
          ))}
        </div>
      )}
      {upResult && <UpResultList result={upResult} />}
      {message && <p className={messageKind}>{message}</p>}
    </Modal>
  );
}

function GitHubImportPanel({ onChanged }: { onChanged: () => void }) {
  const [candidates, refresh] = useResource(getHostedImportCandidates);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [states, setStates] = useState<Record<string, ProjectState>>({});
  const [groups, setGroups] = useState<Record<string, string>>({});
  const [tags, setTags] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("all");
  const [message, setMessage] = useState("");
  const rows = candidates.status === "ready" ? candidates.data : [];
  const owners = Array.from(new Set(rows.map((candidate) => candidate.owner))).sort();
  const filteredRows = rows.filter((candidate) => importCandidateMatches(candidate, query, owner));
  const importSelected = async () => {
    const projects = filteredRows
      .filter((candidate) => selected[candidate.repo])
      .map((candidate) => {
        const group = groups[candidate.repo]?.trim();
        const tagList = splitTags(tags[candidate.repo] ?? "");
        return {
          repo: candidate.repo,
          state: states[candidate.repo] ?? candidate.suggestedState,
          ...(group ? { group } : {}),
          ...(tagList.length > 0 ? { tags: tagList } : {}),
        };
      });
    if (projects.length === 0) {
      setMessage("Select at least one repository.");
      return;
    }
    try {
      const imported = await postImportProjects(projects);
      const up = await Promise.all(imported.map((project) => postProjectUp(project.projectId)));
      for (const result of up) assertProjectUpSucceeded(result);
      setSelected({});
      setMessage(
        `Imported and updated ${projects.length} project${projects.length === 1 ? "" : "s"}.`,
      );
      refresh();
      onChanged();
    } catch (error) {
      setMessage(String(error));
    }
  };
  return (
    <section>
      {candidates.status === "ready" && (
        <ImportCandidateFilters
          query={query}
          owner={owner}
          owners={owners}
          shown={filteredRows.length}
          total={rows.length}
          onQuery={setQuery}
          onOwner={setOwner}
        />
      )}
      {candidates.status === "ready" ? (
        <div className="table-wrap compact-table">
          <table>
            <tbody>
              {filteredRows.map((candidate) => (
                <ImportCandidateRow
                  key={candidate.repo}
                  candidate={candidate}
                  checked={selected[candidate.repo] === true}
                  group={groups[candidate.repo] ?? ""}
                  state={states[candidate.repo] ?? candidate.suggestedState}
                  tags={tags[candidate.repo] ?? ""}
                  onChecked={(checked) => setSelected({ ...selected, [candidate.repo]: checked })}
                  onGroup={(next) => setGroups({ ...groups, [candidate.repo]: next })}
                  onState={(next) => setStates({ ...states, [candidate.repo]: next })}
                  onTags={(next) => setTags({ ...tags, [candidate.repo]: next })}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <LoadState state={candidates} />
      )}
      <button type="button" onClick={importSelected}>
        Import Selected
      </button>
      {message && <p className={message.startsWith("Imported") ? "success" : "error"}>{message}</p>}
    </section>
  );
}

function assertProjectUpSucceeded(results: UpRunResult) {
  const failed = results.find((result) => result.status === "failed");
  if (!failed) return;
  throw new Error(`${failed.item.project.repo}: ${failed.message}`);
}

function ImportCandidateFilters({
  query,
  owner,
  owners,
  shown,
  total,
  onQuery,
  onOwner,
}: {
  query: string;
  owner: string;
  owners: string[];
  shown: number;
  total: number;
  onQuery: (query: string) => void;
  onOwner: (owner: string) => void;
}) {
  return (
    <div className="import-filters">
      <label>
        <span>Search repositories</span>
        <input value={query} onChange={(event) => onQuery(event.target.value)} />
      </label>
      <label>
        <span>Owner</span>
        <select value={owner} onChange={(event) => onOwner(event.target.value)}>
          <option value="all">All owners</option>
          {owners.map((candidateOwner) => (
            <option key={candidateOwner} value={candidateOwner}>
              {candidateOwner}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        Showing {shown} of {total}
      </p>
    </div>
  );
}

function importCandidateMatches(candidate: HostedImportCandidate, query: string, owner: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const ownerMatches = owner === "all" || candidate.owner === owner;
  if (!ownerMatches) return false;
  if (!normalizedQuery) return true;
  return [candidate.repo, candidate.name, candidate.description ?? ""].some((value) =>
    value.toLowerCase().includes(normalizedQuery),
  );
}

function ImportCandidateRow({
  candidate,
  checked,
  group,
  state,
  tags,
  onChecked,
  onGroup,
  onState,
  onTags,
}: {
  candidate: HostedImportCandidate;
  checked: boolean;
  group: string;
  state: ProjectState;
  tags: string;
  onChecked: (checked: boolean) => void;
  onGroup: (group: string) => void;
  onState: (state: ProjectState) => void;
  onTags: (tags: string) => void;
}) {
  return (
    <tr>
      <td>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChecked(event.target.checked)}
        />
      </td>
      <td>
        <strong>{candidate.repo}</strong>
        <span>
          {candidate.visibility}
          {candidate.archived ? " archived" : ""}
        </span>
      </td>
      <td>
        <StateSelect value={state} onChange={onState} />
      </td>
      <td>
        <input value={group} onChange={(event) => onGroup(event.target.value)} />
      </td>
      <td>
        <input value={tags} onChange={(event) => onTags(event.target.value)} />
      </td>
    </tr>
  );
}

function Modal({
  title,
  children,
  onClose,
}: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <dialog
        open
        className="modal-dialog"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="small-button" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </dialog>
    </div>
  );
}

function StateSelect({
  id,
  value,
  onChange,
}: { id?: string; value: ProjectState; onChange: (state: ProjectState) => void }) {
  return (
    <select
      {...(id === undefined ? {} : { id })}
      value={value}
      onChange={(event) => onChange(event.target.value as ProjectState)}
    >
      <option value="experiment">experiment</option>
      <option value="candidate">candidate</option>
      <option value="commercial">commercial</option>
      <option value="open-source">open-source</option>
      <option value="archived">archived</option>
    </select>
  );
}

function splitTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function ProjectDetailScreen() {
  const { projectId } = projectsDetailRoute.useParams();
  const [detail, refresh] = useResource(() => getProjectDetail(projectId));
  useRefreshOnEvents(refresh, [
    "projects-refresh-finished",
    "up-finished",
    "validation-updated",
    "report-created",
  ]);
  return (
    <Screen
      title="Project"
      actions={<IconButton label="Refresh" onClick={refresh} icon={<RefreshCcw size={16} />} />}
    >
      {detail.status === "ready" ? (
        <ProjectDetailPanel detail={detail.data} />
      ) : (
        <LoadState state={detail} />
      )}
    </Screen>
  );
}

function Reports() {
  const [reports, refresh] = useResource(getReports);
  useRefreshOnEvents(refresh, ["report-created", "automation-finished"]);
  return (
    <Screen
      title="Reports"
      actions={<IconButton label="Refresh" onClick={refresh} icon={<RefreshCcw size={16} />} />}
    >
      {reports.status === "ready" ? (
        <>
          <ReportNotePanel onCreated={refresh} />
          <ReportList reports={reports.data} />
        </>
      ) : (
        <LoadState state={reports} />
      )}
    </Screen>
  );
}

function ReportList({ reports }: { reports: ReportSummary[] }) {
  return (
    <div className="list">
      {reports.map((report) => (
        <article className="list-row" key={report.id}>
          <div>
            <strong>
              <ReportLink report={report} />
            </strong>
            <span>{report.kind}</span>
          </div>
          <time>{new Date(report.updatedAt).toLocaleString()}</time>
        </article>
      ))}
    </div>
  );
}

function ReportNotePanel({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [body, setBody] = useState("");
  const [created, setCreated] = useState<ReportDetail>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setMessage("");
    setCreated(undefined);
    try {
      const note = await postReportNote({
        title,
        body,
        ...(projectId ? { projectId } : {}),
      });
      setCreated(note);
      setTitle("");
      setProjectId("");
      setBody("");
      setMessage("Note created.");
      onCreated();
    } catch (error) {
      setCreated(undefined);
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel report-note-panel">
      <h2>New Note</h2>
      <div className="report-note-controls">
        <label>
          <span>Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          <span>Project</span>
          <input value={projectId} onChange={(event) => setProjectId(event.target.value)} />
        </label>
      </div>
      <label className="report-note-body">
        <span>Body</span>
        <textarea value={body} onChange={(event) => setBody(event.target.value)} />
      </label>
      <button type="button" onClick={create} disabled={busy || !title || !body}>
        Create Note
      </button>
      {created && (
        <p className="success">
          Created <ReportLink report={created} />
        </p>
      )}
      {message && <p className={created ? "success" : "error"}>{message}</p>}
    </section>
  );
}

function ReportDetailScreen() {
  const { _splat: reportId } = reportsDetailRoute.useParams();
  const [report, refresh] = useResource(() => {
    if (!reportId) throw new Error("Missing report id.");
    return getReport(reportId);
  });
  useRefreshOnEvents(refresh, ["report-created"]);
  return (
    <Screen
      title="Report"
      actions={<IconButton label="Refresh" onClick={refresh} icon={<RefreshCcw size={16} />} />}
    >
      {report.status === "ready" ? (
        <ReportDetailPanel report={report.data} />
      ) : (
        <LoadState state={report} />
      )}
    </Screen>
  );
}

function ReportDetailPanel({ report }: { report: ReportDetail }) {
  return (
    <>
      <section className="panel detail-panel">
        <h2>{report.title}</h2>
        <div className="detail-grid">
          <DetailItem label="Kind" value={report.kind} />
          <DetailItem label="Updated" value={new Date(report.updatedAt).toLocaleString()} />
          <DetailItem label="Path" value={report.path} mono />
          <DetailItem label="ID" value={report.id} mono />
        </div>
      </section>
      <section className="panel">
        <h2>Content</h2>
        <pre className="report-content">{report.content}</pre>
      </section>
    </>
  );
}

function ReportLink({ report }: { report: ReportSummary }) {
  return (
    <Link to="/reports/$" params={{ _splat: report.id }} className="inline-link">
      {report.title}
    </Link>
  );
}

function Automation() {
  const [automation, refresh] = useResource(getAutomations);
  const [busy, setBusy] = useState(false);
  const [busyJobId, setBusyJobId] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  useRefreshOnEvents(refresh, ["automation-log", "automation-finished"]);
  const tick = async () => {
    setBusy(true);
    setMessage("");
    try {
      await postAutomationTick();
      setMessageKind("success");
      setMessage("Automation tick complete.");
      refresh();
    } catch (error) {
      setMessageKind("error");
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  const runJob = async (jobId: string) => {
    setBusyJobId(jobId);
    setMessage("");
    try {
      const run = await postAutomationRun(jobId);
      setMessageKind(run.status === "failed" ? "error" : "success");
      setMessage(`${run.jobId}: ${run.message}`);
      refresh();
    } catch (error) {
      setMessageKind("error");
      setMessage(String(error));
    } finally {
      setBusyJobId("");
    }
  };
  return (
    <Screen
      title="Automation"
      actions={
        <button type="button" onClick={tick} disabled={busy}>
          Run Tick
        </button>
      }
    >
      {message && <p className={messageKind}>{message}</p>}
      {automation.status === "ready" ? (
        <>
          <AutomationJobEditor
            jobs={automation.data.jobs}
            selectedJobId={selectedJobId}
            onSaved={() => {
              refresh();
              setMessageKind("success");
              setMessage("Automation saved.");
            }}
            onSelectJob={setSelectedJobId}
          />
          <AutomationPanel
            data={automation.data}
            busyJobId={busyJobId}
            selectedJobId={selectedJobId}
            onRunJob={runJob}
            onSelectJob={setSelectedJobId}
          />
        </>
      ) : (
        <LoadState state={automation} />
      )}
    </Screen>
  );
}

function SettingsScreen() {
  const [status, refreshStatus] = useResource(getStatus);
  const [doctor, refreshDoctor] = useResource(getDoctor);
  const [busy, setBusy] = useState(false);
  const [projectDiscoveryResult, setProjectDiscoveryResult] =
    useState<ProjectDiscoveryRefreshResult>();
  const [validationResult, setValidationResult] = useState<ValidationResult>();
  const [upResult, setUpResult] = useState<UpRunResult>();
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  useRefreshOnEvents(refreshStatus, [
    "projects-refresh-finished",
    "up-finished",
    "validation-updated",
  ]);
  const refreshProjects = async () => {
    setBusy(true);
    setMessage("");
    try {
      setProjectDiscoveryResult(await postProjectsRefresh());
      refreshStatus();
      refreshDoctor();
      setMessageKind("success");
      setMessage("Projects refreshed.");
    } catch (error) {
      setMessageKind("error");
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  const validate = async (strict: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      setValidationResult(await postValidate({ strict }));
      refreshStatus();
      setMessageKind("success");
      setMessage(strict ? "Strict validation complete." : "Validation complete.");
    } catch (error) {
      setMessageKind("error");
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  const runUp = async (dryRun: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      setUpResult(await postUp({ dryRun }));
      refreshStatus();
      refreshDoctor();
      setMessageKind("success");
      setMessage(dryRun ? "Workspace up dry run complete." : "Workspace up complete.");
    } catch (error) {
      setMessageKind("error");
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen
      title="Settings"
      actions={
        <>
          <button type="button" onClick={refreshProjects} disabled={busy}>
            Refresh Projects
          </button>
          <button type="button" onClick={() => runUp(true)} disabled={busy}>
            Dry Run
          </button>
          <button type="button" onClick={() => runUp(false)} disabled={busy}>
            Sync Workspace
          </button>
          <button type="button" onClick={() => validate(false)} disabled={busy}>
            Validate
          </button>
          <button type="button" onClick={() => validate(true)} disabled={busy}>
            Strict Validate
          </button>
        </>
      }
    >
      {message && <p className={messageKind}>{message}</p>}
      {status.status === "ready" && <WorkspacePanel status={status.data} />}
      <ConfigExchangePanel
        onApplied={() => {
          refreshStatus();
          refreshDoctor();
        }}
      />
      {projectDiscoveryResult && <ProjectDiscoveryResultPanel result={projectDiscoveryResult} />}
      {upResult && <UpResultPanel result={upResult} />}
      {validationResult && <ValidationResultPanel result={validationResult} />}
      {doctor.status === "ready" ? (
        <DoctorPanel data={doctor.data} />
      ) : (
        <LoadState state={doctor} />
      )}
    </Screen>
  );
}

function UpResultPanel({ result }: { result: UpRunResult }) {
  return (
    <section className="panel">
      <h2>Workspace Up</h2>
      {result.length === 0 ? (
        <p className="empty">No eligible hosted projects.</p>
      ) : (
        <UpResultList result={result} />
      )}
    </section>
  );
}

function UpResultList({ result }: { result: UpRunResult }) {
  return (
    <div className="list">
      {result.map((item) => (
        <article
          className="list-row"
          key={`${item.item.project.id}-${item.item.action}-${item.status}`}
        >
          <div>
            <strong>{item.item.project.repo}</strong>
            <span>{item.message}</span>
          </div>
          <span className={`badge ${item.status}`}>{item.status}</span>
        </article>
      ))}
    </div>
  );
}

function shouldScaffoldFromConfiguration(items: UpPlan["items"]): boolean {
  return items.length > 0 && items.every((item) => item.action === "clone");
}

function ConfigExchangePanel({ onApplied }: { onApplied: () => void }) {
  const [loaded, refresh] = useResource(getConfigToml);
  const [toml, setToml] = useState("");
  const [validation, setValidation] = useState<ValidationResult>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loaded.status === "ready") setToml(loaded.data.toml);
  }, [loaded]);

  const run = async (apply: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      const result = await postConfigToml(toml, { apply });
      setValidation(result.validation);
      setMessage(result.applied ? "Configuration applied." : "Configuration parsed.");
      if (result.applied) {
        refresh();
        onApplied();
      }
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2>Config Exchange</h2>
      {loaded.status === "ready" ? (
        <>
          <p className="mono">{loaded.data.path}</p>
          <textarea
            className="config-editor"
            value={toml}
            onChange={(event) => setToml(event.target.value)}
          />
          <div className="actions">
            <button type="button" onClick={() => run(false)} disabled={busy}>
              Validate
            </button>
            <button type="button" onClick={() => run(true)} disabled={busy}>
              Apply
            </button>
          </div>
        </>
      ) : (
        <LoadState state={loaded} />
      )}
      {validation && <ValidationResultPanel result={validation} title="Config Parse" />}
      {message && <p className={message.includes("applied") ? "success" : "error"}>{message}</p>}
    </section>
  );
}

function WorkspacePanel({ status }: { status: StatusPayload }) {
  return (
    <section className="panel">
      <h2>Workspace</h2>
      <div className="detail-grid">
        <DetailItem label="Root" value={status.root} mono />
        <DetailItem label="Synced config" value={status.config.syncedConfigPath} mono />
      </div>
    </section>
  );
}

function ProjectDiscoveryResultPanel({ result }: { result: ProjectDiscoveryRefreshResult }) {
  return (
    <section className="panel">
      <h2>Project Discovery</h2>
      <div className="state-grid">
        <div className="state-row">
          <span>Remote repositories</span>
          <strong>{result.hosted.length}</strong>
        </div>
        <div className="state-row">
          <span>Hosted clones</span>
          <strong>{result.hostedClones.length}</strong>
        </div>
        <div className="state-row">
          <span>Local experiments</span>
          <strong>{result.local.length}</strong>
        </div>
      </div>
      <p className="mono">{result.path}</p>
    </section>
  );
}

function ValidationResultPanel({
  result,
  title = "Validation Result",
}: { result: ValidationResult; title?: string }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      <ValidationIssueList issues={result.issues} />
    </section>
  );
}

function ValidationSummary({
  validation,
  label,
}: {
  validation: ValidationResult;
  label: string;
}) {
  return (
    <section className="inline-validation">
      <h3>{label}</h3>
      <ValidationIssueList issues={validation.issues} />
    </section>
  );
}

function DataTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Screen({
  title,
  actions,
  children,
}: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <header className="screen-header">
        <div>
          <p>Herakles</p>
          <h1>{title}</h1>
        </div>
        <div className="actions">{actions}</div>
      </header>
      {children}
    </>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

type ProjectTableProps =
  | {
      projects: Project[];
      compact: true;
    }
  | {
      projects: Project[];
      compact?: false;
      selectedProjectId: string;
      onSelectProject: (id: string) => void;
      onRemove: () => void;
    };

function ProjectTable(props: ProjectTableProps) {
  if (props.projects.length === 0) return <p className="empty">No projects.</p>;
  return props.compact === true ? (
    <CompactProjectTable projects={props.projects} />
  ) : (
    <FullProjectTable {...props} />
  );
}

function CompactProjectTable({ projects }: { projects: Project[] }) {
  return (
    <ProjectTableShell
      header={
        <tr>
          <th>Project</th>
          <th>State</th>
          <th>Workspace up</th>
        </tr>
      }
    >
      {projects.map((project) => (
        <CompactProjectRow key={project.id} project={project} />
      ))}
    </ProjectTableShell>
  );
}

function CompactProjectRow({ project }: { project: Project }) {
  return (
    <tr>
      <ProjectIdentityCell project={project} />
      <td>{project.state}</td>
      <td>{yesNo(project.up)}</td>
    </tr>
  );
}

function FullProjectTable({
  projects,
  selectedProjectId,
  onSelectProject,
  onRemove,
}: {
  projects: Project[];
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
  onRemove: () => void;
}) {
  return (
    <ProjectTableShell
      header={
        <tr>
          <th>Project</th>
          <th>Source</th>
          <th>State</th>
          <th>Workspace up</th>
          <th>Settings</th>
          <th>Path</th>
          <th>Tracking</th>
        </tr>
      }
    >
      {projects.map((project) => (
        <FullProjectTableRow
          key={project.id}
          onRemove={onRemove}
          onSelectProject={onSelectProject}
          project={project}
          selectedProjectId={selectedProjectId}
        />
      ))}
    </ProjectTableShell>
  );
}

function ProjectTableShell({
  header,
  children,
}: {
  header: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>{header}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function FullProjectTableRow({
  onRemove,
  onSelectProject,
  project,
  selectedProjectId,
}: {
  onRemove: () => void;
  onSelectProject: (id: string) => void;
  project: Project;
  selectedProjectId: string;
}) {
  return (
    <tr>
      <ProjectIdentityCell project={project} />
      <td>{project.source}</td>
      <td>{project.state}</td>
      <td>{yesNo(project.up)}</td>
      <ProjectSettingsCell
        onSelectProject={onSelectProject}
        project={project}
        selectedProjectId={selectedProjectId}
      />
      <td className="mono">{project.path}</td>
      <ProjectRemoveCell onRemove={onRemove} project={project} />
    </tr>
  );
}

function ProjectIdentityCell({ project }: { project: Project }) {
  return (
    <td>
      <strong>
        <Link to="/projects/$projectId" params={{ projectId: project.id }} className="inline-link">
          {projectName(project)}
        </Link>
      </strong>
      <span>{project.visibility ?? "local"}</span>
    </td>
  );
}

function yesNo(value: boolean) {
  return value ? "yes" : "no";
}

function projectName(project: Project) {
  return project.repo;
}

function ProjectSettingsCell({
  onSelectProject,
  project,
  selectedProjectId,
}: {
  onSelectProject: (id: string) => void;
  project: Project;
  selectedProjectId: string | undefined;
}) {
  const selected = selectedProjectId === project.id;
  return (
    <td>
      <button
        type="button"
        className="small-button"
        aria-pressed={selected}
        onClick={() => onSelectProject(selected ? "" : project.id)}
      >
        {selected ? "Selected" : "Plan"}
      </button>
    </td>
  );
}

function ProjectRemoveCell({ onRemove, project }: { onRemove: () => void; project: Project }) {
  const remove = async () => {
    if (!confirmStopTracking(project)) return;
    await postRemoveProject(project.slug);
    onRemove();
  };
  return (
    <td>
      <button type="button" className="small-button" onClick={remove}>
        Remove
      </button>
    </td>
  );
}

function confirmStopTracking(project: Project) {
  return confirm(
    `Stop tracking ${project.slug}? This will not delete files or hosted repositories.`,
  );
}

function ProjectDetailPanel({ detail }: { detail: ProjectDetail }) {
  const project = detail.project;
  return (
    <>
      <ProjectMetadataPanel project={project} />
      <ProjectValidationPanel issues={detail.validationIssues} />
      <ProjectReportsPanel reports={detail.reports} />
    </>
  );
}

function ProjectMetadataPanel({ project }: { project: Project }) {
  const items = projectDetailItems(project);
  return (
    <section className="panel detail-panel">
      <h2>{projectName(project)}</h2>
      <div className="detail-grid">
        {items.map((item) => (
          <DetailItem
            key={item.label}
            label={item.label}
            value={item.value}
            mono={item.mono === true}
          />
        ))}
      </div>
      <ProjectExternalLink url={project.url} />
    </section>
  );
}

type DetailItemModel = {
  label: string;
  value: string;
  mono?: boolean;
};

function projectDetailItems(project: Project): DetailItemModel[] {
  const items: DetailItemModel[] = [
    { label: "Source", value: project.source },
    { label: "State", value: project.state },
    { label: "Visibility", value: project.visibility ?? "local" },
    { label: "Workspace up", value: project.up ? "yes" : "no" },
    { label: "Automation", value: project.automationEnabled ? "yes" : "no" },
    { label: "Path", value: project.path, mono: true },
  ];
  addDetailItem(items, "Remote", project.remote, true);
  addDetailItem(items, "Default branch", project.defaultBranchRef);
  addDetailItem(items, "Primary language", project.primaryLanguage);
  addDetailItem(items, "Learning", project.learningPath, true);
  addDetailItem(items, "Archive note", project.archiveNote);
  return items;
}

function addDetailItem(
  items: DetailItemModel[],
  label: string,
  value: string | undefined,
  mono?: boolean,
) {
  if (!value) return;
  items.push(mono === true ? { label, value, mono } : { label, value });
}

function ProjectExternalLink({ url }: { url: string | undefined }) {
  if (!url) return null;
  return (
    <a className="external-link" href={url}>
      Open on GitHub
    </a>
  );
}

function ProjectValidationPanel({
  issues,
}: {
  issues: ProjectDetail["validationIssues"];
}) {
  return (
    <section className="panel">
      <h2>Validation</h2>
      <ValidationIssueList issues={issues} />
    </section>
  );
}

function ValidationIssueList({ issues }: { issues: readonly ValidationIssue[] }) {
  if (issues.length === 0) return <p className="empty">No validation issues.</p>;
  return (
    <div className="list">
      {issues.map((issue) => (
        <article
          className="list-row"
          key={`${issue.code}-${issue.projectId ?? ""}-${issue.message}`}
        >
          <div>
            <strong>{issue.code}</strong>
            <span>{issue.message}</span>
          </div>
          <span className={`badge ${issue.severity === "error" ? "fail" : "warn"}`}>
            {issue.severity}
          </span>
        </article>
      ))}
    </div>
  );
}

function ProjectReportsPanel({ reports }: { reports: ReportSummary[] }) {
  return (
    <section className="panel">
      <h2>Related Reports</h2>
      {reports.length === 0 ? (
        <p className="empty">No related reports.</p>
      ) : (
        <div className="list">
          {reports.map((report) => (
            <article className="list-row" key={report.id}>
              <div>
                <strong>
                  <ReportLink report={report} />
                </strong>
                <span>{report.id}</span>
              </div>
              <time>{new Date(report.updatedAt).toLocaleString()}</time>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function DetailItem({
  label,
  value,
  mono = false,
}: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <strong className={mono ? "mono" : undefined}>{value}</strong>
    </div>
  );
}

function ProjectSettingsPanel({
  projects,
  selectedProjectId,
  onApplied,
}: {
  projects: Project[];
  selectedProjectId: string;
  onApplied: () => void;
}) {
  const project = projects.find((candidate) => candidate.id === selectedProjectId);
  if (!project) return null;

  return (
    <section className="panel project-settings-panel">
      <h2>Project Settings</h2>
      <ProjectStateControls key={`state-${project.id}`} project={project} onApplied={onApplied} />
      {project.source === "local" && (
        <>
          <LocalArchivePanel projects={[project]} onArchived={onApplied} />
          <LocalPromotionPanel projects={[project]} onPromoted={onApplied} />
        </>
      )}
    </section>
  );
}

function ProjectStateControls({ project, onApplied }: { project: Project; onApplied: () => void }) {
  const [state, setState] = useState(project.state);
  const [group, setGroup] = useState(project.group ?? "");
  const [tags, setTags] = useState(project.tags.join(", "));
  const [force, setForce] = useState(false);
  const [plan, setPlan] = useState<ProjectConfigPlan | undefined>();
  const [previewKey, setPreviewKey] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPlan(undefined);
    setPreviewKey("");
    setMessage("");
    setState(project.state);
    setGroup(project.group ?? "");
    setTags(project.tags.join(", "));
    setForce(false);
  }, [project.state, project.group, project.tags]);

  const currentKey = projectConfigPreviewKey(project.id, state, group, tags, force);
  const canApply = plan !== undefined && previewKey === currentKey;

  const run = async (apply: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      const changes: ProjectConfigValues = {
        state,
        group: group.trim(),
        tags: splitTags(tags),
      };
      const nextPlan = apply
        ? await postProjectConfigApply(project.id, changes, { force })
        : await postProjectConfigPlan(project.id, changes, { force });
      setPlan(nextPlan);
      setPreviewKey(currentKey);
      if (apply) {
        setMessage("Applied");
        onApplied();
      }
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <ProjectStateForm
        busy={busy}
        canApply={canApply}
        force={force}
        group={group}
        project={project}
        state={state}
        tags={tags}
        onApply={() => run(true)}
        onForceChange={(nextForce) => {
          setForce(nextForce);
          setPreviewKey("");
        }}
        onGroupChange={(nextGroup) => {
          setGroup(nextGroup);
          setPreviewKey("");
        }}
        onPreview={() => run(false)}
        onStateChange={(nextState) => {
          setState(nextState);
          setPreviewKey("");
        }}
        onTagsChange={(nextTags) => {
          setTags(nextTags);
          setPreviewKey("");
        }}
      />
      <ProjectConfigPlanPreview plan={plan} />
      {message && <p className={message === "Applied" ? "success" : "error"}>{message}</p>}
    </>
  );
}

function projectConfigPreviewKey(
  projectId: string,
  state: Project["state"],
  group: string,
  tags: string,
  force: boolean,
) {
  return `${projectId}:${state}:${group}:${tags}:${force ? "force" : "normal"}`;
}

function ProjectStateForm({
  busy,
  canApply,
  force,
  group,
  project,
  state,
  tags,
  onApply,
  onForceChange,
  onGroupChange,
  onPreview,
  onStateChange,
  onTagsChange,
}: {
  busy: boolean;
  canApply: boolean;
  force: boolean;
  group: string;
  project: Project;
  state: Project["state"];
  tags: string;
  onApply: () => void;
  onForceChange: (force: boolean) => void;
  onGroupChange: (group: string) => void;
  onPreview: () => void;
  onStateChange: (state: Project["state"]) => void;
  onTagsChange: (tags: string) => void;
}) {
  return (
    <div className="project-settings-controls">
      <div>
        <strong>{projectName(project)}</strong>
        <span>
          {project.source === "github" && project.owner
            ? `${project.owner}/${project.repo}`
            : project.source}
        </span>
      </div>
      <label>
        <span>State</span>
        <select
          value={state}
          onChange={(event) => onStateChange(event.target.value as Project["state"])}
        >
          {["experiment", "candidate", "commercial", "open-source", "archived"].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Group</span>
        <input value={group} onChange={(event) => onGroupChange(event.target.value)} />
      </label>
      <label>
        <span>Tags</span>
        <input value={tags} onChange={(event) => onTagsChange(event.target.value)} />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={force}
          onChange={(event) => onForceChange(event.target.checked)}
        />
        <span>Force transition</span>
      </label>
      <button type="button" onClick={onPreview} disabled={busy}>
        Preview
      </button>
      <button type="button" onClick={onApply} disabled={busy || !canApply}>
        Apply
      </button>
    </div>
  );
}

function ProjectConfigPlanPreview({ plan }: { plan: ProjectConfigPlan | undefined }) {
  if (!plan) return null;
  const validationLabel = plan.validation?.valid
    ? "Projected validation: valid"
    : "Projected validation issues";
  return (
    <>
      {plan.transition && (
        <p className={plan.transition.forced ? "warning" : "success"}>
          {plan.transition.from} {"->"} {plan.transition.to}
          {plan.transition.forced ? " forced" : " allowed"}
        </p>
      )}
      <pre className="toml-preview">{plan.diff}</pre>
      {plan.validation && (
        <ValidationSummary validation={plan.validation} label={validationLabel} />
      )}
    </>
  );
}

function LocalPromotionPanel({
  projects,
  onPromoted,
}: { projects: Project[]; onPromoted: () => void }) {
  const [selectedId, setSelectedId] = useState(projects[0]?.id ?? "");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState(projects[0]?.repo ?? "");
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [plan, setPlan] = useState("");
  const [result, setResult] = useState<LocalPromotionResult>();
  const [message, setMessage] = useState<PromotionMessage>({ kind: "success", text: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSelectedId(projects[0]?.id ?? "");
    setRepo(projects[0]?.repo ?? "");
    setPlan("");
    setResult(undefined);
    setMessage({ kind: "success", text: "" });
  }, [projects]);

  if (projects.length === 0) return null;

  const options = () => ({
    ...(owner ? { owner } : {}),
    ...(repo ? { repo } : {}),
    visibility,
  });

  const run = async (apply: boolean) => {
    setBusy(true);
    setMessage({ kind: "success", text: "" });
    setResult(undefined);
    try {
      if (apply) {
        const nextResult = await postLocalPromotion(selectedId, options());
        setResult(nextResult);
        setPlan(nextResult.plan.command.join(" "));
        setMessage({
          kind: nextResult.status === "promoted" ? "success" : "error",
          text: nextResult.message,
        });
        if (nextResult.status === "promoted") onPromoted();
        return;
      }
      const nextPlan = await postLocalPromotionPlan(selectedId, options());
      setPlan(nextPlan.command.join(" "));
    } catch (error) {
      setMessage({ kind: "error", text: String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel project-settings-panel">
      <h2>Promotion</h2>
      <LocalPromotionControls
        busy={busy}
        owner={owner}
        projects={projects}
        repo={repo}
        selectedId={selectedId}
        visibility={visibility}
        onOwnerChange={setOwner}
        onPreview={() => run(false)}
        onPromote={() => run(true)}
        onRepoChange={setRepo}
        onSelect={(id, project) => {
          setSelectedId(id);
          setRepo(project?.repo ?? "");
        }}
        onVisibilityChange={setVisibility}
      />
      <LocalPromotionOutput message={message} plan={plan} result={result} />
    </section>
  );
}

function LocalPromotionControls({
  busy,
  owner,
  projects,
  repo,
  selectedId,
  visibility,
  onOwnerChange,
  onPreview,
  onPromote,
  onRepoChange,
  onSelect,
  onVisibilityChange,
}: {
  busy: boolean;
  owner: string;
  projects: Project[];
  repo: string;
  selectedId: string;
  visibility: "public" | "private";
  onOwnerChange: (owner: string) => void;
  onPreview: () => void;
  onPromote: () => void;
  onRepoChange: (repo: string) => void;
  onSelect: (id: string, project: Project | undefined) => void;
  onVisibilityChange: (visibility: "public" | "private") => void;
}) {
  return (
    <div className="promotion-controls">
      <LocalProjectSelect projects={projects} selectedId={selectedId} onSelect={onSelect} />
      <label>
        <span>Owner</span>
        <input value={owner} onChange={(event) => onOwnerChange(event.target.value)} />
      </label>
      <label>
        <span>Repo</span>
        <input value={repo} onChange={(event) => onRepoChange(event.target.value)} />
      </label>
      <label>
        <span>Visibility</span>
        <select
          value={visibility}
          onChange={(event) => onVisibilityChange(event.target.value as "public" | "private")}
        >
          <option value="private">private</option>
          <option value="public">public</option>
        </select>
      </label>
      <button type="button" onClick={onPreview} disabled={busy || !selectedId}>
        Preview
      </button>
      <button type="button" onClick={onPromote} disabled={busy || !selectedId}>
        Promote
      </button>
    </div>
  );
}

function LocalPromotionOutput({
  message,
  plan,
  result,
}: {
  message: PromotionMessage;
  plan: string;
  result: LocalPromotionResult | undefined;
}) {
  return (
    <>
      {plan && <pre className="toml-preview">{plan}</pre>}
      {result && <pre className="toml-preview">{JSON.stringify(result, null, 2)}</pre>}
      {message.text && <p className={message.kind}>{message.text}</p>}
    </>
  );
}

type PromotionMessage = { kind: "success" | "error"; text: string };

function LocalProjectSelect({
  projects,
  selectedId,
  onSelect,
}: {
  projects: Project[];
  selectedId: string;
  onSelect: (id: string, project: Project | undefined) => void;
}) {
  return (
    <label>
      <span>Project</span>
      <select
        value={selectedId}
        onChange={(event) => {
          const nextId = event.target.value;
          onSelect(
            nextId,
            projects.find((project) => project.id === nextId),
          );
        }}
      >
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.slug}
          </option>
        ))}
      </select>
    </label>
  );
}

function LocalArchivePanel({
  projects,
  onArchived,
}: { projects: Project[]; onArchived: () => void }) {
  const [selectedId, setSelectedId] = useState(projects[0]?.id ?? "");
  const [learning, setLearning] = useState("LEARNING.md");
  const [result, setResult] = useState<LocalArchiveResult>();
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSelectedId(projects[0]?.id ?? "");
    setLearning("LEARNING.md");
    setResult(undefined);
    setMessage("");
  }, [projects]);

  if (projects.length === 0) return null;

  const archive = async () => {
    setBusy(true);
    setMessage("");
    setResult(undefined);
    try {
      const next = await postLocalArchive(selectedId, learning);
      setResult(next);
      setMessageKind("success");
      setMessage("Local project archived.");
      onArchived();
    } catch (error) {
      setMessageKind("error");
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel project-settings-panel">
      <h2>Local Archive</h2>
      <div className="local-archive-controls">
        <LocalProjectSelect
          projects={projects}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
        />
        <label>
          <span>Learning file</span>
          <input value={learning} onChange={(event) => setLearning(event.target.value)} />
        </label>
        <button type="button" onClick={archive} disabled={busy || !selectedId || !learning}>
          Archive
        </button>
      </div>
      {result && <pre className="toml-preview">{JSON.stringify(result, null, 2)}</pre>}
      {message && <p className={messageKind}>{message}</p>}
    </section>
  );
}

function AutomationPanel({
  data,
  busyJobId,
  selectedJobId,
  onRunJob,
  onSelectJob,
}: {
  data: AutomationPayload;
  busyJobId: string;
  selectedJobId: string;
  onRunJob: (jobId: string) => void;
  onSelectJob: (jobId: string) => void;
}) {
  return (
    <>
      <div className="split">
        <section className="panel">
          <h2>Jobs</h2>
          <div className="list">
            {data.jobs.map((job) => (
              <article className="list-row" key={job.id}>
                <div>
                  <strong>{job.id}</strong>
                  <span>{humanSchedule(job.schedule)}</span>
                  <span>{automationJobDescription(job)}</span>
                  {job.prompt && <span>{job.prompt.slice(0, 120)}</span>}
                </div>
                <div className="row-actions">
                  <code>{job.schedule}</code>
                  <button
                    type="button"
                    className="small-button"
                    aria-pressed={selectedJobId === job.id}
                    onClick={() => onSelectJob(selectedJobId === job.id ? "" : job.id)}
                  >
                    {selectedJobId === job.id ? "Editing" : "Edit"}
                  </button>
                  <button
                    type="button"
                    className="small-button"
                    disabled={!job.enabled || busyJobId === job.id}
                    onClick={() => onRunJob(job.id)}
                  >
                    Run
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2>Due Slots</h2>
          <div className="list">
            {data.due.map((slot) => (
              <DueSlotRow key={slot.slotId} slot={slot} />
            ))}
          </div>
        </section>
      </div>
      <section className="panel">
        <h2>Recent Runs</h2>
        <div className="list">
          {data.runs.map((run) => (
            <article className="list-row" key={`${run.slotId}-${run.startedAt}`}>
              <div>
                <strong>{run.jobId}</strong>
                <span>{run.message}</span>
              </div>
              <span className={`badge ${run.status}`}>{run.status}</span>
            </article>
          ))}
          {data.runs.length === 0 && <p className="empty">No runs yet.</p>}
        </div>
      </section>
      <section className="panel">
        <h2>Current Locks</h2>
        <div className="list">
          {data.locks.map((lock) => (
            <article className="list-row" key={`${lock.jobId}-${lock.slotId}-${lock.machine}`}>
              <div>
                <strong>{lock.jobId}</strong>
                <span>{lock.slotId}</span>
              </div>
              <div className="lock-meta">
                <span>{lock.machine}</span>
                <time>{new Date(lock.expiresAt).toLocaleString()}</time>
                <span className="badge">{lock.backend}</span>
              </div>
            </article>
          ))}
          {data.locks.length === 0 && <p className="empty">No active locks.</p>}
        </div>
      </section>
    </>
  );
}

function AutomationJobEditor({
  jobs,
  selectedJobId,
  onSaved,
  onSelectJob,
}: {
  jobs: AutomationJob[];
  selectedJobId: string;
  onSaved: () => void;
  onSelectJob: (jobId: string) => void;
}) {
  const selected = jobs.find((job) => job.id === selectedJobId);
  const controller = useAutomationJobEditor(selected, onSaved);
  return (
    <section className="panel automation-editor">
      <AutomationEditorHeader selected={Boolean(selected)} onNew={() => onSelectJob("")} />
      <AutomationJobFields
        form={controller.form}
        jobIdLocked={Boolean(selected)}
        onUpdate={controller.update}
      />
      <AutomationEditorActions
        busy={controller.busy}
        jobId={controller.form.jobId}
        onPreview={controller.preview}
        onSave={controller.save}
      />
      <AutomationEditorFeedback plan={controller.plan} message={controller.message} />
    </section>
  );
}

function useAutomationJobEditor(selected: AutomationJob | undefined, onSaved: () => void) {
  const [form, setForm] = useState<AutomationJobConfigInput>(() => automationJobInput(selected));
  const [plan, setPlan] = useState<AutomationJobConfigPlan>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(automationJobInput(selected));
    setPlan(undefined);
    setMessage("");
  }, [selected]);

  const update = (changes: Partial<AutomationJobConfigInput>) => {
    setForm((current) => ({ ...current, ...changes }));
    setPlan(undefined);
  };

  const preview = () =>
    runAutomationJobConfigAction(form, setBusy, setMessage, setPlan, onSaved, false);
  const save = () =>
    runAutomationJobConfigAction(form, setBusy, setMessage, setPlan, onSaved, true);
  return { form, plan, message, busy, update, preview, save };
}

async function runAutomationJobConfigAction(
  form: AutomationJobConfigInput,
  setBusy: (busy: boolean) => void,
  setMessage: (message: string) => void,
  setPlan: (plan: AutomationJobConfigPlan) => void,
  onSaved: () => void,
  apply: boolean,
) {
  setBusy(true);
  setMessage("");
  try {
    const payload = normalizeAutomationJobInput(form);
    const nextPlan = apply
      ? await postAutomationJobApply(payload)
      : await postAutomationJobPlan(payload);
    setPlan(nextPlan);
    if (apply) onSaved();
  } catch (error) {
    setMessage(String(error));
  } finally {
    setBusy(false);
  }
}

function AutomationEditorHeader({
  selected,
  onNew,
}: {
  selected: boolean;
  onNew: () => void;
}) {
  return (
    <div className="panel-heading-row">
      <h2>{selected ? "Edit Automation" : "New Automation"}</h2>
      {selected && (
        <button type="button" className="small-button" onClick={onNew}>
          New
        </button>
      )}
    </div>
  );
}

function AutomationJobFields({
  form,
  jobIdLocked,
  onUpdate,
}: {
  form: AutomationJobConfigInput;
  jobIdLocked: boolean;
  onUpdate: (changes: Partial<AutomationJobConfigInput>) => void;
}) {
  return (
    <div className="automation-form">
      <label>
        <span>Job id</span>
        <input
          value={form.jobId}
          onChange={(event) => onUpdate({ jobId: event.target.value })}
          disabled={jobIdLocked}
        />
      </label>
      <label>
        <span>Schedule</span>
        <input
          value={form.schedule}
          onChange={(event) => onUpdate({ schedule: event.target.value })}
        />
      </label>
      <label>
        <span>Agent Runtime</span>
        <input
          value={form.runtime}
          onChange={(event) => onUpdate({ runtime: event.target.value })}
        />
      </label>
      <label>
        <span>Output</span>
        <input
          value={form.output ?? ""}
          onChange={(event) => onUpdate({ output: event.target.value })}
        />
      </label>
      <label>
        <span>Repo filter</span>
        <input
          value={form.repoFilter ?? ""}
          onChange={(event) => onUpdate({ repoFilter: event.target.value })}
        />
      </label>
      <label>
        <span>Include tags</span>
        <input
          value={(form.includeTags ?? []).join(", ")}
          onChange={(event) => onUpdate({ includeTags: splitCsv(event.target.value) })}
        />
      </label>
      <label>
        <span>Exclude tags</span>
        <input
          value={(form.excludeTags ?? []).join(", ")}
          onChange={(event) => onUpdate({ excludeTags: splitCsv(event.target.value) })}
        />
      </label>
      <label>
        <span>Issue labels</span>
        <input
          value={(form.issueLabels ?? []).join(", ")}
          onChange={(event) => onUpdate({ issueLabels: splitCsv(event.target.value) })}
        />
      </label>
      <label>
        <span>Skill</span>
        <input
          value={form.skill ?? ""}
          onChange={(event) => onUpdate({ skill: event.target.value })}
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={form.enabled !== false}
          onChange={(event) => onUpdate({ enabled: event.target.checked })}
        />
        <span>Enabled</span>
      </label>
      <label className="automation-prompt">
        <span>Prompt</span>
        <textarea
          value={form.prompt ?? ""}
          onChange={(event) => onUpdate({ prompt: event.target.value })}
        />
      </label>
    </div>
  );
}

function AutomationEditorActions({
  busy,
  jobId,
  onPreview,
  onSave,
}: {
  busy: boolean;
  jobId: string;
  onPreview: () => void;
  onSave: () => void;
}) {
  const disabled = busy || !jobId;
  return (
    <div className="row-actions">
      <button type="button" onClick={onPreview} disabled={disabled}>
        Preview TOML
      </button>
      <button type="button" onClick={onSave} disabled={disabled}>
        Save Automation
      </button>
    </div>
  );
}

function AutomationEditorFeedback({
  plan,
  message,
}: {
  plan: AutomationJobConfigPlan | undefined;
  message: string;
}) {
  return (
    <>
      {plan && <pre className="toml-preview">{plan.diff}</pre>}
      {message && <p className="error">{message}</p>}
    </>
  );
}

function automationJobInput(job: AutomationJob | undefined): AutomationJobConfigInput {
  if (!job) {
    return {
      jobId: "",
      schedule: "0 9 * * 1-5",
      runtime: "codex",
      prompt: "",
      output: "automation/{date}.md",
      repoFilter: "not archived",
      includeTags: [],
      excludeTags: [],
      issueLabels: [],
      enabled: true,
    };
  }
  return {
    jobId: job.id,
    schedule: job.schedule,
    runtime: job.runtime,
    prompt: job.prompt ?? "",
    output: job.output ?? "",
    repoFilter: job.repoFilter ?? "",
    includeTags: job.includeTags,
    excludeTags: job.excludeTags,
    issueLabels: job.issueLabels,
    skill: job.skill ?? "",
    enabled: job.enabled,
  };
}

function normalizeAutomationJobInput(input: AutomationJobConfigInput): AutomationJobConfigInput {
  return {
    jobId: input.jobId.trim(),
    schedule: input.schedule.trim(),
    runtime: input.runtime.trim(),
    ...optionalText("prompt", input.prompt),
    ...optionalText("output", input.output),
    ...optionalText("repoFilter", input.repoFilter),
    ...optionalList("includeTags", input.includeTags),
    ...optionalList("excludeTags", input.excludeTags),
    ...optionalList("issueLabels", input.issueLabels),
    ...optionalText("skill", input.skill),
    enabled: input.enabled !== false,
  };
}

function optionalText<K extends keyof AutomationJobConfigInput>(
  key: K,
  value: string | undefined,
): Partial<AutomationJobConfigInput> {
  const trimmed = value?.trim();
  return trimmed ? ({ [key]: trimmed } as Partial<AutomationJobConfigInput>) : {};
}

function optionalList<K extends keyof AutomationJobConfigInput>(
  key: K,
  value: string[] | undefined,
): Partial<AutomationJobConfigInput> {
  return value?.length ? ({ [key]: value } as Partial<AutomationJobConfigInput>) : {};
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function automationJobDescription(job: AutomationPayload["jobs"][number]) {
  const parts = [`runtime ${job.runtime}`];
  if (job.skill) parts.push(`skill ${job.skill}`);
  if (job.includeTags.length) parts.push(`include tags ${job.includeTags.join(", ")}`);
  if (job.excludeTags.length) parts.push(`exclude tags ${job.excludeTags.join(", ")}`);
  if (job.issueLabels.length) parts.push(`labels ${job.issueLabels.join(", ")}`);
  if (job.repoFilter) parts.push(`filter ${job.repoFilter.replace(/\s+/g, " ").trim()}`);
  return parts.join(" / ");
}

function humanSchedule(schedule: string) {
  const fields = cronFields(schedule);
  return fields ? (scheduleSummary(fields) ?? "Custom schedule") : "Custom schedule";
}

type CronFields = {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
};

function cronFields(schedule: string): CronFields | undefined {
  const [minute, hour, dayOfMonth, month, dayOfWeek, extra] = schedule.trim().split(/\s+/);
  if (extra || !minute || !hour || !dayOfMonth || !month || !dayOfWeek) return undefined;
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

function scheduleSummary(fields: CronFields): string | undefined {
  return [everyNHoursSummary, fixedTimeSummary]
    .map((summarize) => summarize(fields))
    .find((summary): summary is string => Boolean(summary));
}

function everyNHoursSummary(fields: CronFields): string | undefined {
  return fields.minute === "0" &&
    fields.hour.startsWith("*/") &&
    fields.dayOfMonth === "*" &&
    fields.month === "*" &&
    fields.dayOfWeek === "*"
    ? `Every ${fields.hour.slice(2)} hours`
    : undefined;
}

function fixedTimeSummary(fields: CronFields): string | undefined {
  const time = cronTime(fields.minute, fields.hour);
  if (!time || fields.dayOfMonth !== "*" || fields.month !== "*") return undefined;
  return fixedTimeDaySummary(fields.dayOfWeek, time);
}

function fixedTimeDaySummary(dayOfWeek: string, time: string): string | undefined {
  const weekday = cronWeekday(dayOfWeek);
  const summaries: Record<string, string> = {
    "*": `Daily at ${time}`,
    "1-5": `Weekdays at ${time}`,
    "MON-FRI": `Weekdays at ${time}`,
  };
  return summaries[dayOfWeek.toUpperCase()] ?? (weekday ? `${weekday}s at ${time}` : undefined);
}

function cronTime(minute: string, hour: string): string | undefined {
  if (!isCronNumber(minute, 59) || !isCronNumber(hour, 23)) return undefined;
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function isCronNumber(value: string, max: number) {
  return /^\d{1,2}$/.test(value) && Number(value) <= max;
}

function cronWeekday(value: string): string | undefined {
  const weekdays: Record<string, string> = {
    "0": "Sunday",
    "1": "Monday",
    "2": "Tuesday",
    "3": "Wednesday",
    "4": "Thursday",
    "5": "Friday",
    "6": "Saturday",
    SUN: "Sunday",
    MON: "Monday",
    TUE: "Tuesday",
    WED: "Wednesday",
    THU: "Thursday",
    FRI: "Friday",
    SAT: "Saturday",
  };
  return weekdays[value.toUpperCase()];
}

function DoctorPanel({ data, title = "Doctor" }: { data: DoctorResult; title?: string }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      <div className="list">
        {data.checks.map((check) => (
          <article className="list-row" key={check.name}>
            <div>
              <strong>{check.name}</strong>
              <span>{check.message}</span>
            </div>
            <span className={`badge ${check.status}`}>{check.status}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function LoadState<T>({ state }: { state: Loadable<T> }) {
  if (state.status === "error") return <p className="error">{state.error}</p>;
  return <p className="loading">Loading...</p>;
}

function IconButton({
  label,
  icon,
  onClick,
  disabled = false,
}: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="icon-button"
    >
      {icon}
    </button>
  );
}

const rootRoute = createRootRoute({ component: Shell });
const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Dashboard,
});
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  component: Projects,
});
const projectsDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId",
  component: ProjectDetailScreen,
});
const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports",
  component: Reports,
});
const reportsDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports/$",
  component: ReportDetailScreen,
});
const automationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/automation",
  component: Automation,
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsScreen,
});

const router = createRouter({
  routeTree: rootRoute.addChildren([
    dashboardRoute,
    projectsRoute,
    projectsDetailRoute,
    reportsRoute,
    reportsDetailRoute,
    automationRoute,
    settingsRoute,
  ]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
