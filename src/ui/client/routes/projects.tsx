import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  Github,
  LoaderCircle,
  Plus,
  RefreshCcw,
  Search,
  Server,
  Workflow,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  HostedImportCandidate,
  LocalPromotionResult,
  Project,
  ProjectDetail,
  ProjectState,
  ReportSummary,
  UpPlan,
} from "../../../domain";
import {
  type ProjectConfigPlan,
  type ProjectConfigValues,
  type UpRunResult,
  getHostedImportCandidates,
  getProjectDetail,
  getProjects,
  getUpPlan,
  postAddProject,
  postImportProjects,
  postLocalPromotion,
  postLocalPromotionPlan,
  postProjectConfigApply,
  postProjectConfigPlan,
  postProjectUp,
  postRemoveProject,
  postResolveProjectCanonicalPath,
  postUp,
} from "../api";
import {
  Badge,
  DetailItem,
  EmptyState,
  IconButton,
  LoadState,
  Modal,
  Screen,
  StateSelect,
  UpResultList,
  ValidationIssueList,
  ValidationSummary,
  VisualBanner,
  splitTags,
} from "../shared/components";
import { displayPath, displayTextWithHomePaths } from "../shared/displayPath";
import { type Loadable, useRefreshOnEvents, useResource } from "../shared/hooks";
import { assets, classNames, feedbackClass, feedbackToneClass, ui } from "../shared/styles";
import { shouldScaffoldFromConfiguration, workspaceDriftItems } from "../upPlanPresentation";
import { ReportLink } from "./reports";

const githubImportDraftStorageKey = "herakles.githubImportDraft.v1";
const githubImportCandidatesStorageKey = "herakles.githubImportCandidates.v1";

type GitHubImportDraft = {
  selected: Record<string, boolean>;
  states: Record<string, ProjectState>;
  groups: Record<string, string>;
  tags: Record<string, string>;
  query: string;
  owner: string;
  bulkGroup: string;
  bulkTags: string;
};

type GitHubImportCandidatesCache = {
  candidates: HostedImportCandidate[];
  cachedAt: string;
};

type GitHubImportProgress = {
  phase: "idle" | "writing" | "syncing";
  current: number;
  total: number;
  repo?: string;
};

export function Projects() {
  const [projects, refresh] = useResource(getProjects);
  const [upPlan, refreshUpPlan] = useResource(getUpPlan);
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<ProjectState | "all">("all");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [addOpen, setAddOpen] = useState(false);
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
    return projects.data.filter((project) => {
      const stateMatches = stateFilter === "all" || project.state === stateFilter;
      const queryMatches = [
        project.slug,
        project.state,
        project.source,
        project.visibility ?? "",
      ].some((value) => value.toLowerCase().includes(needle));
      return stateMatches && queryMatches;
    });
  }, [projects, query, stateFilter]);
  return (
    <Screen
      title="Projects"
      subtitle="Track, interpret, and operate the repositories in this workspace"
      actions={
        <>
          <button type="button" className={ui.buttonPrimary} onClick={() => setAddOpen(true)}>
            <Plus size={15} aria-hidden />
            Add Project
          </button>
          <button type="button" className={ui.button} onClick={() => setImportOpen(true)}>
            <Github size={15} aria-hidden />
            Import GitHub
          </button>
          <IconButton label="Refresh" onClick={refreshProjects} icon={<RefreshCcw size={16} />} />
        </>
      }
    >
      <>
        {upPlan.status === "ready" ? (
          <WorkspaceDriftPanel result={upPlan.data} onChanged={refreshProjects} />
        ) : null}
        {addOpen && (
          <Modal
            title="Add Project"
            icon={<Plus size={18} />}
            designSystem
            onClose={() => setAddOpen(false)}
          >
            <div className="flex flex-col gap-[var(--space-3)]">
              <AddProjectPanel
                onChanged={() => {
                  refreshProjects();
                  setAddOpen(false);
                }}
              />
              <button
                type="button"
                className={ui.buttonGhost}
                onClick={() => {
                  setAddOpen(false);
                  setImportOpen(true);
                }}
              >
                <Github size={15} aria-hidden />
                Import from GitHub
              </button>
            </div>
          </Modal>
        )}
        {importOpen && (
          <GitHubImportPanel
            onChanged={() => {
              refreshProjects();
              setImportOpen(false);
              setAddOpen(false);
            }}
            onCancel={() => setImportOpen(false)}
          />
        )}
        {projects.status === "ready" ? (
          <>
            <ProjectFilters
              projects={projects.data}
              query={query}
              state={stateFilter}
              onQuery={setQuery}
              onState={setStateFilter}
            />
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
          <LoadState state={projects} label="Loading projects..." />
        )}
      </>
    </Screen>
  );
}

function ProjectFilters({
  projects,
  query,
  state,
  onQuery,
  onState,
}: {
  projects: Project[];
  query: string;
  state: ProjectState | "all";
  onQuery: (query: string) => void;
  onState: (state: ProjectState | "all") => void;
}) {
  const states: Array<ProjectState | "all"> = [
    "all",
    "open-source",
    "experiment",
    "candidate",
    "commercial",
    "archived",
  ];
  return (
    <div className="flex flex-col gap-[var(--space-3)] lg:flex-row lg:items-center lg:justify-between">
      <div
        className="flex flex-wrap gap-0 overflow-x-auto border-b-[1.5px] border-[var(--border-subtle)]"
        role="tablist"
        aria-label="Lifecycle state"
      >
        {states.map((candidate) => (
          <button
            type="button"
            key={candidate}
            className={classNames(
              "min-h-9 rounded-none border-0 border-b-2 border-solid border-transparent bg-transparent px-[var(--space-3)] font-sans text-[var(--text-sm)] font-semibold text-[var(--text-muted)] shadow-none active:translate-y-0 active:shadow-none",
              state === candidate && "border-b-[var(--primary)] text-[var(--text-strong)]",
            )}
            onClick={() => onState(candidate)}
            role="tab"
            aria-selected={state === candidate}
          >
            <span>{candidate === "all" ? "All" : candidate}</span>
            <strong className="rounded-full bg-[var(--neutral-soft)] px-2 py-0.5 text-[11px]">
              {candidate === "all"
                ? projects.length
                : projects.filter((project) => project.state === candidate).length}
            </strong>
          </button>
        ))}
      </div>
      <label className="relative grid min-w-[260px] gap-1.5 text-[0.875rem] font-semibold text-[var(--text-muted)] max-[820px]:w-full">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
          size={16}
          aria-hidden
        />
        <span className="sr-only">Search projects</span>
        <input
          className={classNames(ui.input, "pl-[calc(var(--space-3)+22px)]")}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search projects..."
        />
      </label>
    </div>
  );
}

function AddProjectPanel({ onChanged }: { onChanged: () => void }) {
  const [source, setSource] = useState<"github" | "local">("github");
  const [repo, setRepo] = useState("");
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [tags, setTags] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (busy) return;
    setMessage("");
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="grid gap-[var(--space-4)]">
      <h2 className="sr-only">Add Project</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-[var(--space-3)]">
        <label className={ui.label}>
          <span className={ui.labelText}>Source</span>
          <select
            className={ui.input}
            value={source}
            onChange={(event) => setSource(event.target.value as typeof source)}
          >
            <option value="github">GitHub</option>
            <option value="local">Local</option>
          </select>
        </label>
        {source === "github" ? (
          <label className={ui.label}>
            <span className={ui.labelText}>Repository</span>
            <input
              className={ui.input}
              value={repo}
              onChange={(event) => setRepo(event.target.value)}
              placeholder="owner/name"
            />
          </label>
        ) : (
          <label className={ui.label}>
            <span className={ui.labelText}>Name</span>
            <input
              className={ui.input}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="local-spike"
            />
          </label>
        )}
        <label className={ui.label}>
          <span className={ui.labelText}>Group</span>
          <input
            className={ui.input}
            value={group}
            onChange={(event) => setGroup(event.target.value)}
          />
        </label>
        <label className={ui.label}>
          <span className={ui.labelText}>Tags</span>
          <input
            className={ui.input}
            value={tags}
            onChange={(event) => setTags(event.target.value)}
          />
        </label>
      </div>
      <button type="button" className={ui.buttonPrimary} onClick={add} disabled={busy}>
        <Plus size={16} aria-hidden /> Add Project
      </button>
      {message && (
        <p className={message.includes("added") ? feedbackClass.success : feedbackClass.error}>
          {message}
        </p>
      )}
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
  const [resolvingProjectId, setResolvingProjectId] = useState("");
  const driftItems = workspaceDriftItems(result.items);
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

  const resolveCanonicalPath = async (item: UpPlan["items"][number]) => {
    if (
      !confirm(
        `Move ${item.project.repo} to the canonical checkout path?\n\n${displayPath(
          item.project.path,
        )}`,
      )
    ) {
      return;
    }
    setResolvingProjectId(item.project.id);
    setMessage("");
    try {
      await postResolveProjectCanonicalPath(item.project.id);
      setMessageKind("success");
      setMessage("Canonical checkout path resolved.");
      onChanged();
    } catch (error) {
      setMessageKind("error");
      setMessage(String(error));
    } finally {
      setResolvingProjectId("");
    }
  };

  return (
    <Modal title="Workspace Drift" onClose={() => setIgnoredPlanAt(result.generatedAt)}>
      <div className={ui.panelHead}>
        <div>
          <p className={ui.muted}>
            Configuration expects {driftItems.length} workspace item
            {driftItems.length === 1 ? "" : "s"} that do not fully match disk.
          </p>
        </div>
        <div className={ui.actions}>
          <button type="button" className={ui.buttonPrimary} onClick={runUp} disabled={busy}>
            {primaryAction}
          </button>
          <button type="button" className={ui.buttonGhost} onClick={() => setReviewing(!reviewing)}>
            {reviewing ? "Hide Dry Run" : "Review Dry Run"}
          </button>
          <button
            type="button"
            className={ui.buttonGhost}
            onClick={() => setIgnoredPlanAt(result.generatedAt)}
          >
            Ignore
          </button>
        </div>
      </div>
      <PlanItemList
        items={driftItems}
        onResolveCanonicalPath={(item) => void resolveCanonicalPath(item)}
        resolvingProjectId={resolvingProjectId}
      />
      {reviewing && <PlanItemList items={result.items} title="Dry Run Items" />}
      {upResult && <UpResultList result={upResult} />}
      {message && <p className={feedbackToneClass(messageKind)}>{message}</p>}
    </Modal>
  );
}

function PlanItemList({
  items,
  title = "Drifted Items",
  onResolveCanonicalPath,
  resolvingProjectId = "",
}: {
  items: UpPlan["items"];
  title?: string;
  onResolveCanonicalPath?: (item: UpPlan["items"][number]) => void;
  resolvingProjectId?: string;
}) {
  return (
    <div className={classNames(ui.list, "mb-[var(--space-4)]")}>
      <div className={ui.labelText}>{title}</div>
      {items.map((item) => (
        <article className={ui.listRow} key={`${title}-${item.project.id}-${item.action}`}>
          <div className={ui.listRowMain}>
            <strong>{item.project.repo}</strong>
            <span className={ui.muted}>{displayTextWithHomePaths(item.reason)}</span>
            <span className={ui.mono}>{displayPath(item.project.path)}</span>
          </div>
          <div className={ui.actions}>
            {onResolveCanonicalPath && isHostedClonePathMismatch(item) ? (
              <button
                type="button"
                className={ui.buttonGhost}
                onClick={() => onResolveCanonicalPath(item)}
                disabled={resolvingProjectId === item.project.id}
              >
                {resolvingProjectId === item.project.id ? "Resolving..." : "Use Canonical Path"}
              </button>
            ) : null}
            <Badge tone="primary">{item.action}</Badge>
          </div>
        </article>
      ))}
    </div>
  );
}

function isHostedClonePathMismatch(item: UpPlan["items"][number]) {
  return item.action === "validate" && item.reason.includes("hosted-clone-path-mismatch:");
}

function GitHubImportPanel({
  onChanged,
  onCancel,
}: {
  onChanged: () => void;
  onCancel: () => void;
}) {
  const [candidates, setCandidates] = useState<Loadable<HostedImportCandidate[]>>(
    loadCachedGitHubImportCandidates,
  );
  const [draft, setDraft] = useState<GitHubImportDraft>(loadGitHubImportDraft);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<GitHubImportProgress>({
    phase: "idle",
    current: 0,
    total: 0,
  });
  const hadCachedCandidatesOnOpen = useRef(candidates.status === "ready");
  const rows = candidates.status === "ready" ? candidates.data : [];
  const selectedCount = rows.filter((candidate) => draft.selected[candidate.repo]).length;
  const importing = progress.phase !== "idle";
  const refresh = useCallback((showLoading = true) => {
    if (showLoading) setCandidates({ status: "loading" });
    getHostedImportCandidates()
      .then((data) => {
        setCandidates({ status: "ready", data });
        saveCachedGitHubImportCandidates(data);
      })
      .catch((error) => setCandidates({ status: "error", error: String(error) }));
  }, []);
  useEffect(() => {
    refresh(!hadCachedCandidatesOnOpen.current);
  }, [refresh]);
  useEffect(() => {
    saveGitHubImportDraft(draft);
  }, [draft]);
  return (
    <Modal
      title="Import repositories"
      icon={<Github size={18} />}
      size="xl"
      designSystem
      scrollBody
      onClose={onCancel}
      footer={
        candidates.status === "ready" ? (
          <GitHubImportFooter
            bulkGroup={draft.bulkGroup}
            bulkTags={draft.bulkTags}
            selectedCount={selectedCount}
            importing={importing}
            onCancel={onCancel}
            onImport={() =>
              void importSelectedGitHubProjects({
                draft,
                rows,
                setDraft,
                setMessage,
                setProgress,
                refresh,
                onChanged,
              })
            }
          />
        ) : undefined
      }
    >
      {candidates.status === "ready" ? (
        <>
          <GitHubImportProgressPanel progress={progress} />
          <GitHubImportReadyPanel draft={draft} rows={rows} onDraft={setDraft} />
        </>
      ) : (
        <LoadState state={candidates} label="Loading GitHub repositories..." />
      )}
      {message && (
        <p className={message.startsWith("Imported") ? feedbackClass.success : feedbackClass.error}>
          {message}
        </p>
      )}
    </Modal>
  );
}

function GitHubImportReadyPanel({
  draft,
  rows,
  onDraft,
}: {
  draft: GitHubImportDraft;
  rows: HostedImportCandidate[];
  onDraft: (updater: (current: GitHubImportDraft) => GitHubImportDraft) => void;
}) {
  const owners = Array.from(new Set(rows.map((candidate) => candidate.owner))).sort();
  const filteredRows = rows.filter((candidate) =>
    importCandidateMatches(candidate, draft.query, draft.owner),
  );
  const selectedCount = rows.filter((candidate) => draft.selected[candidate.repo]).length;
  return (
    <>
      <ImportCandidateFilters
        query={draft.query}
        owner={draft.owner}
        owners={owners}
        bulkGroup={draft.bulkGroup}
        bulkTags={draft.bulkTags}
        selected={selectedCount}
        shown={filteredRows.length}
        total={rows.length}
        onQuery={(query) => onDraft((current) => ({ ...current, query }))}
        onOwner={(owner) => onDraft((current) => ({ ...current, owner }))}
        onBulkGroup={(bulkGroup) => onDraft((current) => ({ ...current, bulkGroup }))}
        onBulkTags={(bulkTags) => onDraft((current) => ({ ...current, bulkTags }))}
      />
      <ImportCandidateList candidates={filteredRows} draft={draft} onDraft={onDraft} />
    </>
  );
}

function GitHubImportProgressPanel({ progress }: { progress: GitHubImportProgress }) {
  if (progress.phase === "idle") return null;
  const percent =
    progress.total > 0 ? Math.max(4, Math.round((progress.current / progress.total) * 100)) : 4;
  const label =
    progress.phase === "writing"
      ? `Writing configuration for ${progress.total} selected repositories`
      : `Syncing ${progress.current} of ${progress.total}${progress.repo ? ` · ${progress.repo}` : ""}`;
  return (
    <output
      className="mb-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--info-soft-border)] bg-[var(--info-soft)] p-[var(--space-3)]"
      aria-live="polite"
    >
      <div className="mb-[var(--space-2)] flex items-center justify-between gap-[var(--space-3)]">
        <span className="font-sans text-[var(--text-sm)] font-semibold text-[var(--text-strong)]">
          Import in progress
        </span>
        <span className="font-mono text-[var(--text-xs)] text-[var(--text-muted)]">{label}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-inset)]" aria-hidden>
        <div
          className="h-full rounded-full bg-[var(--info-strong)] transition-[width] duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
      <progress className="sr-only" value={progress.current} max={progress.total}>
        {percent}%
      </progress>
    </output>
  );
}

function selectedImportProjects(rows: HostedImportCandidate[], draft: GitHubImportDraft) {
  return rows
    .filter((candidate) => draft.selected[candidate.repo])
    .map((candidate) => {
      const group = (draft.groups[candidate.repo] ?? draft.bulkGroup).trim();
      const tagList = splitTags(draft.tags[candidate.repo] || draft.bulkTags);
      return {
        repo: candidate.repo,
        state: draft.states[candidate.repo] ?? candidate.suggestedState,
        ...(group ? { group } : {}),
        ...(tagList.length > 0 ? { tags: tagList } : {}),
      };
    });
}

async function importSelectedGitHubProjects({
  draft,
  rows,
  setDraft,
  setMessage,
  setProgress,
  refresh,
  onChanged,
}: {
  draft: GitHubImportDraft;
  rows: HostedImportCandidate[];
  setDraft: (updater: (current: GitHubImportDraft) => GitHubImportDraft) => void;
  setMessage: (message: string) => void;
  setProgress: (progress: GitHubImportProgress) => void;
  refresh: (showLoading?: boolean) => void;
  onChanged: () => void;
}) {
  const projects = selectedImportProjects(rows, draft);
  if (projects.length === 0) {
    setMessage("Select at least one repository.");
    return;
  }
  try {
    setMessage("");
    setProgress({ phase: "writing", current: 0, total: projects.length });
    const imported = await postImportProjects(projects);
    for (const [index, importedProject] of imported.entries()) {
      const repo = projects[index]?.repo ?? importedProject.projectId;
      setProgress({ phase: "syncing", current: index, total: projects.length, repo });
      const result = await postProjectUp(importedProject.projectId);
      assertProjectUpSucceeded(result);
      setProgress({ phase: "syncing", current: index + 1, total: projects.length, repo });
    }
    setDraft((current) =>
      clearImportedGitHubImportDraft(
        current,
        projects.map((project) => project.repo),
      ),
    );
    setMessage(
      `Imported and updated ${projects.length} project${projects.length === 1 ? "" : "s"}.`,
    );
    refresh(false);
    onChanged();
  } catch (error) {
    setMessage(String(error));
  } finally {
    setProgress({ phase: "idle", current: 0, total: 0 });
  }
}

function emptyGitHubImportDraft(): GitHubImportDraft {
  return {
    selected: {},
    states: {},
    groups: {},
    tags: {},
    query: "",
    owner: "all",
    bulkGroup: "",
    bulkTags: "",
  };
}

function loadGitHubImportDraft(): GitHubImportDraft {
  const parsed = readStoredJson(githubImportDraftStorageKey);
  if (!isRecord(parsed)) return emptyGitHubImportDraft();
  return {
    selected: stringBooleanRecord(parsed.selected),
    states: projectStateRecord(parsed.states),
    groups: stringRecord(parsed.groups),
    tags: stringRecord(parsed.tags),
    query: typeof parsed.query === "string" ? parsed.query : "",
    owner: typeof parsed.owner === "string" ? parsed.owner : "all",
    bulkGroup: typeof parsed.bulkGroup === "string" ? parsed.bulkGroup : "",
    bulkTags: typeof parsed.bulkTags === "string" ? parsed.bulkTags : "",
  };
}

function saveGitHubImportDraft(draft: GitHubImportDraft) {
  writeStoredJson(githubImportDraftStorageKey, draft);
}

function clearImportedGitHubImportDraft(
  draft: GitHubImportDraft,
  importedRepos: string[],
): GitHubImportDraft {
  const selected = { ...draft.selected };
  const states = { ...draft.states };
  const groups = { ...draft.groups };
  const tags = { ...draft.tags };
  for (const repo of importedRepos) {
    delete selected[repo];
    delete states[repo];
    delete groups[repo];
    delete tags[repo];
  }
  return { ...draft, selected, states, groups, tags };
}

function loadCachedGitHubImportCandidates(): Loadable<HostedImportCandidate[]> {
  const parsed = readStoredJson(githubImportCandidatesStorageKey);
  if (!isRecord(parsed) || !Array.isArray(parsed.candidates)) return { status: "loading" };
  const candidates = parsed.candidates.filter(isHostedImportCandidate);
  return candidates.length === parsed.candidates.length
    ? { status: "ready", data: candidates }
    : { status: "loading" };
}

function saveCachedGitHubImportCandidates(candidates: HostedImportCandidate[]) {
  const cache: GitHubImportCandidatesCache = {
    candidates,
    cachedAt: new Date().toISOString(),
  };
  writeStoredJson(githubImportCandidatesStorageKey, cache);
}

function readStoredJson(key: string): unknown {
  if (typeof window === "undefined") return undefined;
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? JSON.parse(stored) : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private windows or restricted browser contexts.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHostedImportCandidate(value: unknown): value is HostedImportCandidate {
  if (!isRecord(value)) return false;
  const visibility = value.visibility;
  return (
    hasStringFields(value, ["repo", "owner", "name"]) &&
    (visibility === "public" || visibility === "private") &&
    typeof value.archived === "boolean" &&
    isProjectState(value.suggestedState) &&
    isStringList(value.topics) &&
    hasOptionalStringFields(value, ["description", "updatedAt"]) &&
    typeof value.alreadyTracked === "boolean"
  );
}

function hasStringFields(value: Record<string, unknown>, fields: string[]) {
  return fields.every((field) => typeof value[field] === "string");
}

function hasOptionalStringFields(value: Record<string, unknown>, fields: string[]) {
  return fields.every((field) => value[field] === undefined || typeof value[field] === "string");
}

function isStringList(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function stringBooleanRecord(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
    ),
  );
}

function projectStateRecord(value: unknown): Record<string, ProjectState> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, ProjectState] =>
      isProjectState(entry[1]),
    ),
  );
}

function isProjectState(value: unknown): value is ProjectState {
  return (
    value === "experiment" ||
    value === "candidate" ||
    value === "commercial" ||
    value === "open-source" ||
    value === "archived"
  );
}

function assertProjectUpSucceeded(results: UpRunResult) {
  const failed = results.find((result) => result.status === "failed");
  if (!failed) return;
  throw new Error(`${failed.item.project.repo}: ${failed.message}`);
}

const importFieldClass = "flex flex-col gap-[var(--space-1_5)]";
const importLabelClass =
  "font-mono text-[var(--text-2xs)] uppercase tracking-[var(--tracking-caps)] text-[var(--text-faint)]";
const importInputClass =
  "h-[var(--control-md)] w-full rounded-[var(--radius-md)] border-[1.5px] border-[var(--border-default)] bg-[var(--surface-inset)] px-[var(--space-3)] font-sans text-[var(--text-base)] text-[var(--text-strong)] shadow-[inset_0_2px_4px_rgb(0_0_0_/_0.18)] transition-colors placeholder:text-[var(--text-faint)] hover:border-[var(--border-strong)] focus:border-[var(--border-focus)] focus:outline-none focus:shadow-[0_0_0_3px_var(--primary-soft)]";
const compactAvatarClass =
  "inline-flex h-6 w-6 flex-none select-none items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-card)] font-sans text-[var(--text-xs)] font-semibold text-[var(--text-body)]";

function ImportCandidateFilters({
  query,
  owner,
  owners,
  bulkGroup,
  bulkTags,
  selected,
  shown,
  total,
  onQuery,
  onOwner,
  onBulkGroup,
  onBulkTags,
}: {
  query: string;
  owner: string;
  owners: string[];
  bulkGroup: string;
  bulkTags: string;
  selected: number;
  shown: number;
  total: number;
  onQuery: (query: string) => void;
  onOwner: (owner: string) => void;
  onBulkGroup: (group: string) => void;
  onBulkTags: (tags: string) => void;
}) {
  return (
    <>
      <div className="mb-[var(--space-3)] grid grid-cols-2 gap-[var(--space-3)] max-[820px]:grid-cols-1">
        <div className={importFieldClass}>
          <span className={importLabelClass}>From owner / org</span>
          <select
            className={importInputClass}
            value={owner}
            onChange={(event) => onOwner(event.target.value)}
          >
            <option value="all">All owners</option>
            {owners.map((candidateOwner) => (
              <option key={candidateOwner} value={candidateOwner}>
                {candidateOwner}
              </option>
            ))}
          </select>
        </div>
        <div className={importFieldClass}>
          <span className={importLabelClass}>Assign to group</span>
          <input
            className={importInputClass}
            value={bulkGroup}
            placeholder="group for imported projects"
            onChange={(event) => onBulkGroup(event.target.value)}
          />
        </div>
      </div>
      <ImportTagField tags={bulkTags} onTags={onBulkTags} />
      <div className="mb-[var(--space-3)] grid gap-[var(--space-1_5)]">
        <div className="relative flex items-center">
          <span className="pointer-events-none absolute left-[var(--space-3)] inline-flex text-[15px] text-[var(--text-faint)] [&_svg]:h-[15px] [&_svg]:w-[15px]">
            <Search size={15} />
          </span>
          <input
            className={classNames(importInputClass, "pl-[calc(var(--space-3)+22px)]")}
            value={query}
            placeholder="Filter repositories..."
            onChange={(event) => onQuery(event.target.value)}
          />
        </div>
        <p className="font-mono text-[var(--text-xs)] text-[var(--text-muted)]">
          Showing {shown} of {total} · {selected} selected
        </p>
      </div>
    </>
  );
}

function ImportTagField({ tags, onTags }: { tags: string; onTags: (tags: string) => void }) {
  const [tagDraft, setTagDraft] = useState("");
  const tagList = splitTags(tags);
  const addTag = () => {
    const next = tagDraft.trim().toLowerCase();
    if (!next || tagList.includes(next)) {
      setTagDraft("");
      return;
    }
    onTags([...tagList, next].join(", "));
    setTagDraft("");
  };
  return (
    <div className={classNames(importFieldClass, "mb-[var(--space-3)]")}>
      <span className={importLabelClass}>Tags · applied to every imported project</span>
      <div className="flex min-h-[var(--control-md)] flex-wrap items-center gap-[var(--space-1_5)] rounded-[var(--radius-md)] border-[1.5px] border-[var(--border-default)] bg-[var(--surface-inset)] px-2 py-[5px] shadow-[inset_0_2px_4px_rgb(0_0_0_/_0.16)]">
        {tagList.map((tag) => (
          <span
            className="inline-flex h-[22px] items-center gap-[var(--space-1_5)] rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-[var(--space-2)] font-mono text-[var(--text-xs)] text-[var(--text-muted)]"
            key={tag}
          >
            {tag}
            <button
              type="button"
              className="-mr-0.5 inline-flex h-auto min-h-0 cursor-pointer items-center rounded-[var(--radius-xs)] border-0 bg-transparent p-0 text-[var(--text-faint)] shadow-none hover:text-[var(--danger)] active:translate-y-0 active:shadow-none"
              aria-label={`Remove ${tag}`}
              onClick={() => onTags(tagList.filter((current) => current !== tag).join(", "))}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          className="min-h-0 min-w-[90px] flex-1 border-0 bg-transparent p-0 font-mono text-[var(--text-xs)] text-[var(--text-strong)] shadow-none outline-none placeholder:text-[var(--text-faint)] focus:shadow-none"
          value={tagDraft}
          placeholder="add tag + Enter"
          onChange={(event) => setTagDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addTag();
            }
          }}
        />
      </div>
    </div>
  );
}

function ImportCandidateList({
  candidates,
  draft,
  onDraft,
}: {
  candidates: HostedImportCandidate[];
  draft: GitHubImportDraft;
  onDraft: (updater: (current: GitHubImportDraft) => GitHubImportDraft) => void;
}) {
  return (
    <div
      className="flex flex-col overflow-hidden rounded-[var(--radius-md)] border-[1.5px] border-[var(--border-subtle)]"
      aria-label="GitHub repositories"
    >
      {candidates.map((candidate) => (
        <ImportCandidateRow
          key={candidate.repo}
          candidate={candidate}
          checked={draft.selected[candidate.repo] === true}
          group={draft.groups[candidate.repo] ?? ""}
          state={draft.states[candidate.repo] ?? candidate.suggestedState}
          tags={draft.tags[candidate.repo] ?? ""}
          onChecked={(checked) =>
            onDraft((current) => ({
              ...current,
              selected: { ...current.selected, [candidate.repo]: checked },
            }))
          }
          onGroup={(next) =>
            onDraft((current) => ({
              ...current,
              groups: { ...current.groups, [candidate.repo]: next },
            }))
          }
          onState={(next) =>
            onDraft((current) => ({
              ...current,
              states: { ...current.states, [candidate.repo]: next },
            }))
          }
          onTags={(next) =>
            onDraft((current) => ({
              ...current,
              tags: { ...current.tags, [candidate.repo]: next },
            }))
          }
        />
      ))}
    </div>
  );
}

function GitHubImportFooter({
  bulkGroup,
  bulkTags,
  selectedCount,
  importing,
  onCancel,
  onImport,
}: {
  bulkGroup: string;
  bulkTags: string;
  selectedCount: number;
  importing: boolean;
  onCancel: () => void;
  onImport: () => void;
}) {
  const bulkTagCount = splitTags(bulkTags).length;
  return (
    <>
      <span className="mr-auto font-mono text-[var(--text-xs)] text-[var(--text-muted)]">
        {selectedCount} selected
        {bulkGroup ? (
          <>
            {" "}
            → group <b className="text-[var(--text-body)]">{bulkGroup}</b>
          </>
        ) : null}
        {bulkTagCount > 0 ? ` · ${bulkTagCount} tag${bulkTagCount === 1 ? "" : "s"}` : ""}
      </span>
      <button type="button" className={ui.buttonGhost} onClick={onCancel} disabled={importing}>
        Cancel
      </button>
      <button
        type="button"
        className={ui.buttonPrimary}
        onClick={onImport}
        disabled={importing || selectedCount === 0}
      >
        {importing ? (
          <>
            <LoaderCircle className="animate-spin" size={15} aria-hidden />
            Importing
          </>
        ) : (
          `Import ${selectedCount} ${selectedCount === 1 ? "repository" : "repositories"}`
        )}
      </button>
    </>
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
  const description =
    candidate.description ||
    `${candidate.owner}/${candidate.name}${candidate.archived ? " · archived" : ""}`;
  const toggleFromRow = (event: React.MouseEvent<HTMLElement>) => {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("input, select, button, label")
    ) {
      return;
    }
    onChecked(!checked);
  };
  return (
    <div
      className={classNames(
        "grid cursor-pointer grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-[var(--space-3)] border-b border-[var(--border-subtle)] p-[var(--space-3)] transition-colors last:border-b-0 hover:bg-[var(--surface-raised)]",
        checked && "bg-[var(--primary-soft)]",
      )}
      onMouseDown={toggleFromRow}
    >
      <div className="relative inline-flex items-center justify-center">
        <input
          type="checkbox"
          className="peer h-[18px] w-[18px] min-h-0 appearance-none rounded-[var(--radius-xs)] border-[1.5px] border-[var(--border-strong)] bg-[var(--surface-inset)] p-0 shadow-none checked:border-[var(--primary)] checked:bg-[var(--primary)]"
          aria-label={`Select ${candidate.repo}`}
          checked={checked}
          onChange={(event) => onChecked(event.target.checked)}
        />
        <span className="pointer-events-none absolute left-[2.5px] top-[2.5px] inline-flex text-[var(--on-primary)] opacity-0 peer-checked:opacity-100">
          <CheckCircle2 size={13} />
        </span>
      </div>
      <span className={compactAvatarClass}>{repoInitials(candidate.repo)}</span>
      <div className="min-w-0">
        <div className="font-mono text-[var(--text-sm)] font-semibold text-[var(--text-strong)]">
          {candidate.repo}
        </div>
        <div className="mt-px max-w-[340px] overflow-hidden text-ellipsis whitespace-nowrap text-[var(--text-xs)] text-[var(--text-muted)]">
          {description}
        </div>
      </div>
      <div className="flex items-center gap-[var(--space-2)]">
        <span className="font-mono text-[var(--text-2xs)] text-[var(--text-faint)]">
          {candidate.visibility}
          {candidate.archived ? " · archived" : ""}
        </span>
        <LifecycleBadge state={state} />
      </div>
      {checked ? (
        <div className="col-[3/5] mt-[var(--space-3)] grid grid-cols-3 gap-[var(--space-3)] border-t border-dashed border-[var(--border-subtle)] pt-[var(--space-3)] max-[820px]:grid-cols-1">
          <div className={importFieldClass}>
            <span className={importLabelClass}>Lifecycle</span>
            <StateSelect value={state} onChange={onState} />
          </div>
          <label className={importFieldClass}>
            <span className={importLabelClass}>Group override</span>
            <input
              className={importInputClass}
              value={group}
              placeholder="use dialog group"
              onChange={(event) => onGroup(event.target.value)}
            />
          </label>
          <label className={importFieldClass}>
            <span className={importLabelClass}>Tags override</span>
            <input
              className={importInputClass}
              value={tags}
              placeholder="use dialog tags"
              onChange={(event) => onTags(event.target.value)}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

function repoInitials(repo: string) {
  return repo
    .split(/[/-]/)
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function ProjectDetailScreen({ projectId }: { projectId: string }) {
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
        <LoadState state={detail} label="Loading project details..." />
      )}
    </Screen>
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

export function ProjectTable(props: ProjectTableProps) {
  if (props.projects.length === 0) {
    return (
      <EmptyState art={assets.heraklesHero} title="No projects here">
        No projects match this lifecycle state or search query.
      </EmptyState>
    );
  }
  return props.compact === true ? (
    <CompactProjectTable projects={props.projects} />
  ) : (
    <ProjectCardGrid {...props} />
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

function ProjectCardGrid({
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
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-[var(--space-4)]">
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          onRemove={onRemove}
          onSelectProject={onSelectProject}
          project={project}
          selectedProjectId={selectedProjectId}
        />
      ))}
    </div>
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
    <div className={ui.tableWrap}>
      <table className={ui.table}>
        <thead>{header}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function ProjectCard({
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
  const selected = selectedProjectId === project.id;
  const accent = lifecycleAccent(project.state);
  return (
    <article className="relative m-0 flex cursor-pointer flex-col gap-[var(--space-3)] overflow-hidden rounded-[var(--radius-lg)] border-[1.5px] border-[var(--border-subtle)] bg-[var(--surface-card)] py-[var(--space-4)] pr-[var(--space-4)] pl-[var(--space-5)] shadow-[var(--lift-1)] transition-[border-color,transform,box-shadow] duration-[var(--duration-base)] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-[var(--lift-2)]">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[9px]"
        style={{
          background: `repeating-linear-gradient(135deg, ${accent} 0 5px, color-mix(in srgb, ${accent} 62%, #000) 5px 10px)`,
        }}
      />
      <div className="mb-0 flex items-start gap-[var(--space-3)]">
        <span className={compactAvatarClass} aria-hidden>
          {repoInitials(projectName(project))}
        </span>
        <div className="min-w-0 flex-1">
          <strong className="block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[0.875rem] font-semibold text-[var(--text-strong)]">
            <Link
              to="/projects/$projectId"
              params={{ projectId: project.id }}
              className={classNames(
                ui.link,
                "block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[0.875rem] font-semibold",
              )}
            >
              {projectName(project)}
            </Link>
          </strong>
          <span className="font-mono text-[var(--text-xs)] text-[var(--text-faint)]">
            {project.source === "github" && project.owner
              ? `${project.owner}/${project.repo}`
              : (project.visibility ?? project.source)}
          </span>
        </div>
        <LifecycleBadge state={project.state} />
      </div>
      {project.description && (
        <p className="m-0 line-clamp-2 overflow-hidden text-[var(--text-sm)] leading-snug text-[var(--text-muted)]">
          {project.description}
        </p>
      )}
      <div className="mb-0 mt-auto flex items-center gap-[var(--space-3)] pt-[var(--space-1)]">
        <span className="inline-flex items-center gap-[var(--space-1)] bg-transparent p-0 font-mono text-[var(--text-xs)] text-[var(--text-faint)]">
          <Workflow size={14} aria-hidden /> workspace up: {yesNo(project.up)}
        </span>
        <span className="inline-flex items-center gap-[var(--space-1)] bg-transparent p-0 font-mono text-[var(--text-xs)] text-[var(--text-faint)]">
          <Server size={14} aria-hidden /> {project.visibility ?? "local"}
        </span>
      </div>
      <p className="m-0 mb-[var(--space-3)] overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[var(--text-xs)] text-[var(--text-faint)]">
        {displayPath(project.path)}
      </p>
      <div className={ui.actions}>
        <button
          type="button"
          className={ui.buttonGhost}
          aria-pressed={selected}
          onClick={() => onSelectProject(selected ? "" : project.id)}
        >
          {selected ? "Selected" : "Plan Settings"}
        </button>
        <ProjectRemoveButton onRemove={onRemove} project={project} />
      </div>
    </article>
  );
}

function ProjectIdentityCell({ project }: { project: Project }) {
  return (
    <td>
      <strong>
        <Link to="/projects/$projectId" params={{ projectId: project.id }} className={ui.link}>
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

export function projectName(project: Project) {
  return project.repo;
}

function lifecycleAccent(state: ProjectState) {
  switch (state) {
    case "open-source":
      return "var(--lc-open-source)";
    case "experiment":
      return "var(--lc-experiment)";
    case "candidate":
      return "var(--lc-candidate)";
    case "commercial":
      return "var(--lc-commercial)";
    case "archived":
      return "var(--lc-archived)";
  }
}

function LifecycleBadge({ state }: { state: ProjectState }) {
  const accent = lifecycleAccent(state);
  return (
    <span
      className="inline-flex min-h-[24px] items-center gap-[var(--space-1_5)] rounded-full border px-[var(--space-2)] font-mono text-[var(--text-2xs)] font-semibold uppercase"
      style={{
        borderColor: `color-mix(in srgb, ${accent} 40%, transparent)`,
        background: `color-mix(in srgb, ${accent} 16%, transparent)`,
        color: accent,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {state}
    </span>
  );
}

function ProjectRemoveButton({ onRemove, project }: { onRemove: () => void; project: Project }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (busy) return;
    if (!confirmStopTracking(project)) return;
    setBusy(true);
    setError("");
    try {
      await postRemoveProject(project.slug);
      onRemove();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className={ui.buttonDanger} onClick={remove} disabled={busy}>
        Remove
      </button>
      {error && <span className={feedbackClass.error}>{error}</span>}
    </>
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
    <section className={ui.panel}>
      <h2>{projectName(project)}</h2>
      <div className={ui.detailGrid}>
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
    { label: "Path", value: displayPath(project.path), mono: true },
  ];
  addDetailItem(items, "Remote", project.remote, true);
  addDetailItem(items, "Default branch", project.defaultBranchRef);
  addDetailItem(items, "Primary language", project.primaryLanguage);
  addDetailItem(items, "Learning", project.learningPath && displayPath(project.learningPath), true);
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
    <a className={ui.buttonGhost} href={url}>
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
    <section className={ui.panel}>
      <h2>Validation</h2>
      <ValidationIssueList issues={issues} />
    </section>
  );
}

function ProjectReportsPanel({ reports }: { reports: ReportSummary[] }) {
  return (
    <section className={ui.panel}>
      <h2>Related Reports</h2>
      {reports.length === 0 ? (
        <p className={ui.emptyText}>No related reports.</p>
      ) : (
        <div className={ui.list}>
          {reports.map((report) => (
            <article className={ui.listRow} key={report.id}>
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
    <section className={ui.panel}>
      <h2 className={ui.panelTitle}>Project Settings</h2>
      <ProjectStateControls key={`state-${project.id}`} project={project} onApplied={onApplied} />
      {project.source === "local" && (
        <LocalPromotionPanel project={project} onPromoted={onApplied} />
      )}
    </section>
  );
}

function ProjectStateControls({ project, onApplied }: { project: Project; onApplied: () => void }) {
  const [state, setState] = useState(project.state);
  const [group, setGroup] = useState(project.group ?? "");
  const [tags, setTags] = useState(project.tags.join(", "));
  const [learning, setLearning] = useState("");
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
    setLearning("");
    setForce(false);
  }, [project.state, project.group, project.tags]);

  const currentKey = projectConfigPreviewKey(project.id, state, group, tags, learning, force);
  const canApply = plan !== undefined && previewKey === currentKey;

  const run = async (apply: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      const changes: ProjectConfigValues = {
        state,
        group: group.trim(),
        tags: splitTags(tags),
        ...(learning.trim() ? { learning: learning.trim() } : {}),
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
        learning={learning}
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
        onLearningChange={(nextLearning) => {
          setLearning(nextLearning);
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
      {message && (
        <p className={message === "Applied" ? feedbackClass.success : feedbackClass.error}>
          {message}
        </p>
      )}
    </>
  );
}

function projectConfigPreviewKey(
  projectId: string,
  state: Project["state"],
  group: string,
  tags: string,
  learning: string,
  force: boolean,
) {
  return `${projectId}:${state}:${group}:${tags}:${learning}:${force ? "force" : "normal"}`;
}

function ProjectStateForm({
  busy,
  canApply,
  force,
  group,
  learning,
  project,
  state,
  tags,
  onApply,
  onForceChange,
  onGroupChange,
  onLearningChange,
  onPreview,
  onStateChange,
  onTagsChange,
}: {
  busy: boolean;
  canApply: boolean;
  force: boolean;
  group: string;
  learning: string;
  project: Project;
  state: Project["state"];
  tags: string;
  onApply: () => void;
  onForceChange: (force: boolean) => void;
  onGroupChange: (group: string) => void;
  onLearningChange: (learning: string) => void;
  onPreview: () => void;
  onStateChange: (state: Project["state"]) => void;
  onTagsChange: (tags: string) => void;
}) {
  return (
    <div className={ui.formGrid}>
      <div className="grid gap-1 self-end">
        <strong className={ui.listTitle}>{projectName(project)}</strong>
        <span className={ui.mono}>
          {project.source === "github" && project.owner
            ? `${project.owner}/${project.repo}`
            : project.source}
        </span>
      </div>
      <label className={ui.label}>
        <span className={ui.labelText}>State</span>
        <select
          className={ui.input}
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
      <label className={ui.label}>
        <span className={ui.labelText}>Group</span>
        <input
          className={ui.input}
          value={group}
          onChange={(event) => onGroupChange(event.target.value)}
        />
      </label>
      <label className={ui.label}>
        <span className={ui.labelText}>Tags</span>
        <input
          className={ui.input}
          value={tags}
          onChange={(event) => onTagsChange(event.target.value)}
        />
      </label>
      <label className={ui.label}>
        <span className={ui.labelText}>Learning file</span>
        <input
          className={ui.input}
          value={learning}
          onChange={(event) => onLearningChange(event.target.value)}
        />
      </label>
      <label className={ui.checkboxLabel}>
        <input
          className={ui.checkbox}
          type="checkbox"
          checked={force}
          onChange={(event) => onForceChange(event.target.checked)}
        />
        <span>Force transition</span>
      </label>
      <button type="button" className={ui.buttonGhost} onClick={onPreview} disabled={busy}>
        Preview
      </button>
      <button
        type="button"
        className={ui.buttonPrimary}
        onClick={onApply}
        disabled={busy || !canApply}
      >
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
        <p className={plan.transition.forced ? feedbackClass.warning : feedbackClass.success}>
          {plan.transition.from} {"->"} {plan.transition.to}
          {plan.transition.forced ? " forced" : " allowed"}
        </p>
      )}
      <pre className={ui.codeBlock}>{plan.diff}</pre>
      {plan.validation && (
        <ValidationSummary validation={plan.validation} label={validationLabel} />
      )}
    </>
  );
}

function LocalPromotionPanel({
  project,
  onPromoted,
}: { project: Project; onPromoted: () => void }) {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState(project.repo);
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [plan, setPlan] = useState("");
  const [result, setResult] = useState<LocalPromotionResult>();
  const [message, setMessage] = useState<PromotionMessage>({ kind: "success", text: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRepo(project.repo);
    setPlan("");
    setResult(undefined);
    setMessage({ kind: "success", text: "" });
  }, [project]);

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
        const nextResult = await postLocalPromotion(project.id, options());
        setResult(nextResult);
        setPlan(nextResult.plan.command.join(" "));
        setMessage({
          kind: nextResult.status === "promoted" ? "success" : "error",
          text: nextResult.message,
        });
        if (nextResult.status === "promoted") onPromoted();
        return;
      }
      const nextPlan = await postLocalPromotionPlan(project.id, options());
      setPlan(nextPlan.command.join(" "));
    } catch (error) {
      setMessage({ kind: "error", text: String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={ui.panel}>
      <h2 className={ui.panelTitle}>Promotion</h2>
      <LocalPromotionControls
        busy={busy}
        owner={owner}
        repo={repo}
        visibility={visibility}
        onOwnerChange={setOwner}
        onPreview={() => run(false)}
        onPromote={() => run(true)}
        onRepoChange={setRepo}
        onVisibilityChange={setVisibility}
      />
      <LocalPromotionOutput message={message} plan={plan} result={result} />
    </section>
  );
}

function LocalPromotionControls({
  busy,
  owner,
  repo,
  visibility,
  onOwnerChange,
  onPreview,
  onPromote,
  onRepoChange,
  onVisibilityChange,
}: {
  busy: boolean;
  owner: string;
  repo: string;
  visibility: "public" | "private";
  onOwnerChange: (owner: string) => void;
  onPreview: () => void;
  onPromote: () => void;
  onRepoChange: (repo: string) => void;
  onVisibilityChange: (visibility: "public" | "private") => void;
}) {
  return (
    <div className={ui.formGrid}>
      <label className={ui.label}>
        <span className={ui.labelText}>Owner</span>
        <input
          className={ui.input}
          value={owner}
          onChange={(event) => onOwnerChange(event.target.value)}
        />
      </label>
      <label className={ui.label}>
        <span className={ui.labelText}>Repo</span>
        <input
          className={ui.input}
          value={repo}
          onChange={(event) => onRepoChange(event.target.value)}
        />
      </label>
      <label className={ui.label}>
        <span className={ui.labelText}>Visibility</span>
        <select
          className={ui.input}
          value={visibility}
          onChange={(event) => onVisibilityChange(event.target.value as "public" | "private")}
        >
          <option value="private">private</option>
          <option value="public">public</option>
        </select>
      </label>
      <button type="button" className={ui.buttonGhost} onClick={onPreview} disabled={busy}>
        Preview
      </button>
      <button type="button" className={ui.buttonPrimary} onClick={onPromote} disabled={busy}>
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
      {plan && <pre className={ui.codeBlock}>{plan}</pre>}
      {result && <pre className={ui.codeBlock}>{JSON.stringify(result, null, 2)}</pre>}
      {message.text && <p className={feedbackToneClass(message.kind)}>{message.text}</p>}
    </>
  );
}

type PromotionMessage = { kind: "success" | "error"; text: string };
