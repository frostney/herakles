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
  FolderGit2,
  Plus,
  RefreshCcw,
  Settings,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  AutomationDueSlot,
  AutomationRun,
  DoctorResult,
  HostedImportCandidate,
  Project,
  ProjectDetail,
  ProjectState,
  PrunePlan,
  ReportDetail,
  ReportSummary,
  ValidationIssue,
  ValidationResult,
} from "../../domain";
import {
  type AutomationPayload,
  type HeraklesEvent,
  type LocalArchiveResult,
  type LocalPromotionResult,
  type ProjectConfigPlan,
  type ProjectDiscoveryRefreshResult,
  type RepoMovePlan,
  type StatusPayload,
  type SyncRunResult,
  getAutomations,
  getDoctor,
  getHostedImportCandidates,
  getLocalProjects,
  getProjectDetail,
  getProjects,
  getPrunePlan,
  getReport,
  getReports,
  getStatus,
  postAddProject,
  postAutomationRun,
  postAutomationTick,
  postImportProjects,
  postLocalArchive,
  postLocalPromotion,
  postLocalPromotionPlan,
  postProjectConfigApply,
  postProjectConfigPlan,
  postProjectsRefresh,
  postPrune,
  postRemoveProject,
  postRepoMove,
  postRepoMovePlan,
  postReportNote,
  postSyncDryRun,
  postSyncRun,
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
          <Link to="/local" activeProps={{ className: "active" }}>
            <FolderGit2 size={18} aria-hidden />
            Local
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
    "sync-finished",
    "validation-updated",
    "automation-finished",
  ]);
  useRefreshOnEvents(refreshProjects, ["projects-refresh-finished", "sync-finished"]);
  useRefreshOnEvents(refreshAutomation, ["automation-log", "automation-finished"]);
  useRefreshOnEvents(refreshDoctor, [
    "projects-refresh-finished",
    "sync-finished",
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
          <DoctorPanel data={doctor.data} title="Sync Health" />
        ) : (
          <section className="panel">
            <h2>Sync Health</h2>
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
  const [query, setQuery] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  useRefreshOnEvents(refresh, ["projects-refresh-finished", "sync-finished", "validation-updated"]);
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
      actions={<IconButton label="Refresh" onClick={refresh} icon={<RefreshCcw size={16} />} />}
    >
      <div className="split">
        <AddProjectPanel onChanged={refresh} />
        <GitHubImportPanel onChanged={refresh} />
      </div>
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
            onRemove={refresh}
          />
          <ProjectSettingsPanel
            projects={projects.data}
            selectedProjectId={selectedProjectId}
            onApplied={() => {
              refresh();
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
  const [id, setId] = useState("");
  const [repo, setRepo] = useState("");
  const [path, setPath] = useState("");
  const [state, setState] = useState<ProjectState>("experiment");
  const [message, setMessage] = useState("");
  const add = async () => {
    setMessage("");
    try {
      await postAddProject({
        id: id || defaultProjectId(source === "github" ? repo : path),
        source,
        ...(source === "github" ? { repo } : { path }),
        state,
      });
      setMessage("Project added.");
      setId("");
      setRepo("");
      setPath("");
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
        <label>
          <span>Project id</span>
          <input value={id} onChange={(event) => setId(event.target.value)} placeholder="auto" />
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
            <span>Path</span>
            <input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="local-spike"
            />
          </label>
        )}
        <label htmlFor="add-project-state">
          <span>State</span>
          <StateSelect id="add-project-state" value={state} onChange={setState} />
        </label>
      </div>
      <button type="button" onClick={add}>
        <Plus size={16} aria-hidden /> Add
      </button>
      {message && <p className={message.includes("added") ? "success" : "error"}>{message}</p>}
    </section>
  );
}

function GitHubImportPanel({ onChanged }: { onChanged: () => void }) {
  const [candidates, refresh] = useResource(getHostedImportCandidates);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [states, setStates] = useState<Record<string, ProjectState>>({});
  const [message, setMessage] = useState("");
  const rows = candidates.status === "ready" ? candidates.data : [];
  const importSelected = async () => {
    const projects = rows
      .filter((candidate) => selected[candidate.repo])
      .map((candidate) => ({
        id: candidate.id,
        repo: candidate.repo,
        state: states[candidate.repo] ?? candidate.suggestedState,
      }));
    if (projects.length === 0) {
      setMessage("Select at least one repository.");
      return;
    }
    try {
      await postImportProjects(projects);
      setSelected({});
      setMessage(`Imported ${projects.length} project${projects.length === 1 ? "" : "s"}.`);
      refresh();
      onChanged();
    } catch (error) {
      setMessage(String(error));
    }
  };
  return (
    <section className="panel">
      <h2>GitHub Import</h2>
      {candidates.status === "ready" ? (
        <div className="table-wrap compact-table">
          <table>
            <tbody>
              {rows.slice(0, 8).map((candidate) => (
                <ImportCandidateRow
                  key={candidate.repo}
                  candidate={candidate}
                  checked={selected[candidate.repo] === true}
                  state={states[candidate.repo] ?? candidate.suggestedState}
                  onChecked={(checked) => setSelected({ ...selected, [candidate.repo]: checked })}
                  onState={(next) => setStates({ ...states, [candidate.repo]: next })}
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

function ImportCandidateRow({
  candidate,
  checked,
  state,
  onChecked,
  onState,
}: {
  candidate: HostedImportCandidate;
  checked: boolean;
  state: ProjectState;
  onChecked: (checked: boolean) => void;
  onState: (state: ProjectState) => void;
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
    </tr>
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

function defaultProjectId(value: string): string {
  return value.replace("/", "-").split(/[\\/]/).filter(Boolean).at(-1) ?? value;
}

function ProjectDetailScreen() {
  const { projectId } = projectsDetailRoute.useParams();
  const [detail, refresh] = useResource(() => getProjectDetail(projectId));
  useRefreshOnEvents(refresh, [
    "projects-refresh-finished",
    "sync-finished",
    "validation-updated",
    "report-created",
  ]);
  return (
    <Screen
      title="Repository"
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

function LocalExperiments() {
  const [projects, refresh] = useResource(getLocalProjects);
  useRefreshOnEvents(refresh, ["projects-refresh-finished", "sync-finished"]);
  return (
    <Screen
      title="Local"
      actions={<IconButton label="Refresh" onClick={refresh} icon={<RefreshCcw size={16} />} />}
    >
      {projects.status === "ready" ? (
        <>
          <ProjectTable projects={projects.data} />
          <LocalArchivePanel projects={projects.data} onArchived={refresh} />
          <LocalPromotionPanel projects={projects.data} onPromoted={refresh} />
        </>
      ) : (
        <LoadState state={projects} />
      )}
    </Screen>
  );
}

function Automation() {
  const [automation, refresh] = useResource(getAutomations);
  const [busy, setBusy] = useState(false);
  const [busyJobId, setBusyJobId] = useState("");
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
        <AutomationPanel data={automation.data} busyJobId={busyJobId} onRunJob={runJob} />
      ) : (
        <LoadState state={automation} />
      )}
    </Screen>
  );
}

function SettingsScreen() {
  const [status, refreshStatus] = useResource(getStatus);
  const [doctor, refreshDoctor] = useResource(getDoctor);
  const [prunePlan, refreshPrunePlan] = useResource(getPrunePlan);
  const [busy, setBusy] = useState(false);
  const [syncResults, setSyncResults] = useState<SyncRunResult>([]);
  const [syncMode, setSyncMode] = useState<"dry-run" | "run">("dry-run");
  const [projectDiscoveryResult, setProjectDiscoveryResult] =
    useState<ProjectDiscoveryRefreshResult>();
  const [validationResult, setValidationResult] = useState<ValidationResult>();
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  useRefreshOnEvents(refreshStatus, [
    "projects-refresh-finished",
    "sync-finished",
    "validation-updated",
  ]);
  useRefreshOnEvents(refreshPrunePlan, ["sync-finished", "projects-refresh-finished"]);
  const dryRun = async () => {
    setBusy(true);
    setMessage("");
    try {
      setSyncResults(await postSyncDryRun());
      setSyncMode("dry-run");
      setMessageKind("success");
      setMessage("Sync dry run complete.");
    } catch (error) {
      setMessageKind("error");
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  const syncRun = async () => {
    setBusy(true);
    setMessage("");
    try {
      setSyncResults(await postSyncRun());
      setSyncMode("run");
      refreshStatus();
      refreshPrunePlan();
      setMessageKind("success");
      setMessage("Sync run complete.");
    } catch (error) {
      setMessageKind("error");
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  const refreshProjects = async () => {
    setBusy(true);
    setMessage("");
    try {
      setProjectDiscoveryResult(await postProjectsRefresh());
      refreshStatus();
      refreshPrunePlan();
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
  const refreshPrune = () => {
    refreshPrunePlan();
    setMessageKind("success");
    setMessage("Prune plan refreshed.");
  };
  return (
    <Screen
      title="Settings"
      actions={
        <>
          <button type="button" onClick={refreshProjects} disabled={busy}>
            Refresh Projects
          </button>
          <button type="button" onClick={() => validate(false)} disabled={busy}>
            Validate
          </button>
          <button type="button" onClick={() => validate(true)} disabled={busy}>
            Strict Validate
          </button>
          <button type="button" onClick={dryRun} disabled={busy}>
            Sync Dry Run
          </button>
          <button type="button" onClick={syncRun} disabled={busy}>
            Sync Run
          </button>
          <button type="button" onClick={refreshPrune} disabled={busy}>
            Prune Plan
          </button>
        </>
      }
    >
      {message && <p className={messageKind}>{message}</p>}
      {status.status === "ready" && <WorkspacePanel status={status.data} />}
      {projectDiscoveryResult && <ProjectDiscoveryResultPanel result={projectDiscoveryResult} />}
      {validationResult && <ValidationResultPanel result={validationResult} />}
      <SyncResultsPanel mode={syncMode} results={syncResults} />
      {prunePlan.status === "ready" ? (
        <PrunePlanPanel plan={prunePlan.data} onChanged={refreshPrunePlan} />
      ) : (
        <LoadState state={prunePlan} />
      )}
      {doctor.status === "ready" ? (
        <DoctorPanel data={doctor.data} />
      ) : (
        <LoadState state={doctor} />
      )}
    </Screen>
  );
}

function WorkspacePanel({ status }: { status: StatusPayload }) {
  return (
    <section className="panel">
      <h2>Workspace</h2>
      <div className="detail-grid">
        <DetailItem label="Root" value={status.root} mono />
        <DetailItem label="Synced config" value={status.config.syncedConfigPath} mono />
        <DetailItem
          label="Local UI config"
          value={status.config.localConfigPath ?? "not present"}
          mono
        />
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

function SyncResultsPanel({ mode, results }: { mode: "dry-run" | "run"; results: SyncRunResult }) {
  const title = mode === "dry-run" ? "Sync Dry Run" : "Sync Run";
  return (
    <section className="panel">
      <h2>{title}</h2>
      {results.length === 0 ? (
        <p className="empty">No sync results.</p>
      ) : (
        <DataTable headers={["Project", "Action", "Status", "Reason"]}>
          {results.map((result) => (
            <tr key={`${result.item.project.id}-${result.item.action}`}>
              <td>{result.item.project.slug}</td>
              <td>{result.item.action}</td>
              <td>{result.status}</td>
              <td>{result.message}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </section>
  );
}

function PrunePlanPanel({
  plan,
  onChanged,
}: {
  plan: PrunePlan;
  onChanged: () => void;
}) {
  const [busyProject, setBusyProject] = useState("");
  const prune = async (projectId: string) => {
    setBusyProject(projectId);
    try {
      await postPrune(projectId);
      onChanged();
    } finally {
      setBusyProject("");
    }
  };
  return (
    <section className="panel">
      <h2>Prune Plan</h2>
      {plan.items.length === 0 ? (
        <p className="empty">No prune-eligible clones.</p>
      ) : (
        <DataTable headers={["Project", "Reason", "Path", "Destination", "Action"]}>
          {plan.items.map((item) => (
            <tr key={item.project.id}>
              <td>{item.project.slug}</td>
              <td>{item.reason}</td>
              <td className="mono">{item.fromPath}</td>
              <td className="mono">{item.toPath}</td>
              <td>
                <button
                  type="button"
                  className="small-button"
                  disabled={busyProject === item.project.id}
                  onClick={() => prune(item.project.id)}
                >
                  Prune
                </button>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
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

function ProjectTable({
  projects,
  compact = false,
  selectedProjectId,
  onSelectProject,
  onRemove,
}: {
  projects: Project[];
  compact?: boolean;
  selectedProjectId?: string;
  onSelectProject?: (id: string) => void;
  onRemove?: () => void;
}) {
  if (projects.length === 0) return <p className="empty">No projects.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Project</th>
            {!compact && <th>Source</th>}
            <th>State</th>
            <th>Sync</th>
            {!compact && onSelectProject && <th>Settings</th>}
            {!compact && <th>Path</th>}
            {!compact && onRemove && <th>Tracking</th>}
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <ProjectTableRow
              key={project.id}
              compact={compact}
              onRemove={onRemove}
              onSelectProject={onSelectProject}
              project={project}
              selectedProjectId={selectedProjectId}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProjectTableRow({
  compact,
  onRemove,
  onSelectProject,
  project,
  selectedProjectId,
}: {
  compact: boolean;
  onRemove: (() => void) | undefined;
  onSelectProject: ((id: string) => void) | undefined;
  project: Project;
  selectedProjectId: string | undefined;
}) {
  return (
    <tr>
      <td>
        <strong>
          <Link
            to="/projects/$projectId"
            params={{ projectId: project.id }}
            className="inline-link"
          >
            {project.slug}
          </Link>
        </strong>
        <span>{project.visibility ?? "local"}</span>
      </td>
      {!compact && <td>{project.source}</td>}
      <td>{project.state}</td>
      <td>{project.sync ? "yes" : "no"}</td>
      {!compact && onSelectProject && (
        <ProjectSettingsCell
          onSelectProject={onSelectProject}
          project={project}
          selectedProjectId={selectedProjectId}
        />
      )}
      {!compact && <td className="mono">{project.path}</td>}
      {!compact && onRemove && <ProjectRemoveCell onRemove={onRemove} project={project} />}
    </tr>
  );
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
  if (project.source !== "github") {
    return (
      <td>
        <span className="muted">local</span>
      </td>
    );
  }
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
      <h2>{project.slug}</h2>
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
    { label: "Sync", value: project.sync ? "yes" : "no" },
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
      <MoveProjectControls key={`move-${project.id}`} project={project} onApplied={onApplied} />
    </section>
  );
}

function ProjectStateControls({ project, onApplied }: { project: Project; onApplied: () => void }) {
  const [state, setState] = useState(project.state);
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
    setForce(false);
  }, [project.state]);

  const currentKey = projectConfigPreviewKey(project.id, state, force);
  const canApply = plan !== undefined && previewKey === currentKey;

  const run = async (apply: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      const nextPlan = apply
        ? await postProjectConfigApply(project.id, state, { force })
        : await postProjectConfigPlan(project.id, state, { force });
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
        project={project}
        state={state}
        onApply={() => run(true)}
        onForceChange={(nextForce) => {
          setForce(nextForce);
          setPreviewKey("");
        }}
        onPreview={() => run(false)}
        onStateChange={(nextState) => {
          setState(nextState);
          setPreviewKey("");
        }}
      />
      <ProjectConfigPlanPreview plan={plan} />
      {message && <p className={message === "Applied" ? "success" : "error"}>{message}</p>}
    </>
  );
}

function projectConfigPreviewKey(projectId: string, state: Project["state"], force: boolean) {
  return `${projectId}:${state}:${force ? "force" : "normal"}`;
}

function ProjectStateForm({
  busy,
  canApply,
  force,
  project,
  state,
  onApply,
  onForceChange,
  onPreview,
  onStateChange,
}: {
  busy: boolean;
  canApply: boolean;
  force: boolean;
  project: Project;
  state: Project["state"];
  onApply: () => void;
  onForceChange: (force: boolean) => void;
  onPreview: () => void;
  onStateChange: (state: Project["state"]) => void;
}) {
  return (
    <div className="project-settings-controls">
      <div>
        <strong>{project.slug}</strong>
        <span>{project.id}</span>
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

function MoveProjectControls({ project, onApplied }: { project: Project; onApplied: () => void }) {
  const [movePath, setMovePath] = useState("");
  const [movePlan, setMovePlan] = useState<RepoMovePlan>();
  const [previewPath, setPreviewPath] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const trimmedMovePath = movePath.trim();
  const canMove =
    movePlan !== undefined && previewPath === trimmedMovePath && movePlan.projectId === project.id;

  const run = async (apply: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      const result = apply
        ? await postRepoMove(project.id, movePath)
        : await postRepoMovePlan(project.id, movePath);
      setMovePlan(result);
      setPreviewPath(trimmedMovePath);
      if (apply) {
        setMessage("Moved");
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
      <div className="move-controls">
        <label>
          <span>Move path</span>
          <input
            value={movePath}
            onChange={(event) => {
              setMovePath(event.target.value);
              setPreviewPath("");
            }}
            placeholder="new-relative-path"
          />
        </label>
        <button type="button" onClick={() => run(false)} disabled={busy || !trimmedMovePath}>
          Preview Move
        </button>
        <button type="button" onClick={() => run(true)} disabled={busy || !canMove}>
          Move
        </button>
      </div>
      {movePlan && <MovePlanPreview plan={movePlan} />}
      {message && <p className={message === "Moved" ? "success" : "error"}>{message}</p>}
    </>
  );
}

function MovePlanPreview({ plan }: { plan: RepoMovePlan }) {
  return (
    <>
      <pre className="toml-preview">{plan.diff ?? plan.toml ?? plan.relativePath}</pre>
      {plan.validation && (
        <ValidationSummary
          validation={plan.validation}
          label={
            plan.validation.valid ? "Projected validation: valid" : "Projected validation issues"
          }
        />
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
  onRunJob,
}: { data: AutomationPayload; busyJobId: string; onRunJob: (jobId: string) => void }) {
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
                  <span>{automationJobDescription(job)}</span>
                </div>
                <div className="row-actions">
                  <code>{job.schedule}</code>
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

function automationJobDescription(job: AutomationPayload["jobs"][number]) {
  const parts = [job.mode];
  if (job.skill) parts.push(`skill ${job.skill}`);
  if (job.issueLabels.length) parts.push(`labels ${job.issueLabels.join(", ")}`);
  if (job.repoFilter) parts.push(`filter ${job.repoFilter.replace(/\s+/g, " ").trim()}`);
  return parts.join(" / ");
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
const localRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/local",
  component: LocalExperiments,
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
    localRoute,
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
