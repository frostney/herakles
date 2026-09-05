import { Link } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  CircleDot,
  FolderOpen,
  GitBranch,
  Github,
  GitPullRequest,
  History,
  LoaderCircle,
  Plus,
  RefreshCcw,
  Search,
  Server,
  SquareTerminal,
  Star,
  Terminal,
  Workflow,
  X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  HostedImportCandidate,
  LocalPromotionResult,
  Project,
  ProjectDetail,
  ProjectOpenTarget,
  ProjectRenamePlan,
  ProjectRenameResult,
  ProjectState,
  UpPlan,
} from "../../../domain";
import {
  getHostedImportCandidates,
  getProjectDetail,
  getProjects,
  getUpPlan,
  type ProjectConfigPlan,
  type ProjectConfigValues,
  postAddProject,
  postImportProjects,
  postLocalPromotion,
  postLocalPromotionPlan,
  postOpenProject,
  postProjectConfigApply,
  postProjectConfigPlan,
  postProjectRename,
  postProjectRenamePlan,
  postProjectUp,
  postRemoveProject,
  postResolveProjectCanonicalPath,
  postSyncProjectDefaultBranch,
  postUp,
  projectIconUrl,
  type UpRunResult,
} from "../api";
import {
  defaultProjectSortDirection,
  type ProjectSortDirection,
  type ProjectSortKey,
  projectSortOptions,
  sortProjects,
} from "../projectSorting";
import {
  Badge,
  DetailItem,
  EmptyState,
  IconButton,
  LoadState,
  Modal,
  Screen,
  StateSelect,
  splitTags,
  TextField,
  TextWithMonoPaths,
  UpResultList,
  ValidationIssueList,
  ValidationSummary,
} from "../shared/components";
import { displayPath } from "../shared/displayPath";
import { type Loadable, useAction, useRefreshOnEvents, useResource } from "../shared/hooks";
import { assets, classNames, feedbackClass, feedbackToneClass, ui } from "../shared/styles";
import { shouldScaffoldFromConfiguration, workspaceDriftItems } from "../upPlanPresentation";

const githubImportDraftStorageKey = "herakles.githubImportDraft.v1";
const githubImportCandidatesStorageKey = "herakles.githubImportCandidates.v2";

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

function applyPinnedOverrides(
  projects: readonly Project[],
  overrides: Record<string, boolean>,
): Project[] {
  if (Object.keys(overrides).length === 0) return [...projects];
  return projects.map((project) => {
    const pinned = overrides[project.id];
    return pinned === undefined ? project : { ...project, pinned };
  });
}

function compactPinnedOverrides(
  projects: readonly Project[],
  overrides: Record<string, boolean>,
): Record<string, boolean> {
  const projectPinnedById = new Map(projects.map((project) => [project.id, project.pinned]));
  let changed = false;
  const compacted: Record<string, boolean> = {};
  for (const [projectId, pinned] of Object.entries(overrides)) {
    if (projectPinnedById.get(projectId) === pinned) {
      changed = true;
      continue;
    }
    if (!projectPinnedById.has(projectId)) {
      changed = true;
      continue;
    }
    compacted[projectId] = pinned;
  }
  return changed ? compacted : overrides;
}

export function Projects() {
  const [projects, refresh] = useResource(getProjects);
  const [upPlan, refreshUpPlan] = useResource(getUpPlan);
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<ProjectState | "all">("all");
  const [sortKey, setSortKey] = useState<ProjectSortKey>("starred");
  const [sortDirection, setSortDirection] = useState<ProjectSortDirection>("desc");
  const [pinnedOverrides, setPinnedOverrides] = useState<Record<string, boolean>>({});
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const refreshProjects = () => {
    refresh();
    refreshUpPlan();
  };
  useRefreshOnEvents(refreshProjects, [
    "projects-refresh-finished",
    "up-finished",
    "validation-updated",
  ]);
  const effectiveProjects = useMemo(() => {
    if (projects.status !== "ready") return [];
    return applyPinnedOverrides(projects.data, pinnedOverrides);
  }, [pinnedOverrides, projects]);
  useEffect(() => {
    if (projects.status !== "ready") return;
    setPinnedOverrides((current) => compactPinnedOverrides(projects.data, current));
  }, [projects]);
  const filtered = useMemo(() => {
    if (projects.status !== "ready") return [];
    const needle = query.toLowerCase();
    const filteredProjects = effectiveProjects.filter((project) => {
      const stateMatches = stateFilter === "all" || project.state === stateFilter;
      const queryMatches = [
        project.slug,
        project.state,
        project.source,
        project.visibility ?? "",
        project.primaryLanguage ?? "",
        project.languages.join(" "),
      ].some((value) => value.toLowerCase().includes(needle));
      return stateMatches && queryMatches;
    });
    return sortProjects(filteredProjects, sortKey, sortDirection);
  }, [effectiveProjects, projects.status, query, sortDirection, sortKey, stateFilter]);
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
              projects={effectiveProjects}
              query={query}
              sortDirection={sortDirection}
              sortKey={sortKey}
              state={stateFilter}
              onQuery={setQuery}
              onSortDirection={setSortDirection}
              onSortKey={(key) => {
                setSortKey(key);
                setSortDirection(defaultProjectSortDirection(key));
              }}
              onState={setStateFilter}
            />
            <ProjectCardGrid
              projects={filtered}
              onChanged={refreshProjects}
              selectedProjectId={selectedProjectId}
              onPinnedChange={(projectId, pinned) =>
                setPinnedOverrides((current) => ({ ...current, [projectId]: pinned }))
              }
              onSelectProject={setSelectedProjectId}
              onRemove={refreshProjects}
            />
            <ProjectSettingsPanel
              projects={effectiveProjects}
              selectedProjectId={selectedProjectId}
              onRenamed={(projectId) => {
                refreshProjects();
                setSelectedProjectId(projectId);
              }}
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
  sortDirection,
  sortKey,
  state,
  onQuery,
  onSortDirection,
  onSortKey,
  onState,
}: {
  projects: Project[];
  query: string;
  sortDirection: ProjectSortDirection;
  sortKey: ProjectSortKey;
  state: ProjectState | "all";
  onQuery: (query: string) => void;
  onSortDirection: (direction: ProjectSortDirection) => void;
  onSortKey: (key: ProjectSortKey) => void;
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
      <div className="flex flex-wrap items-end justify-end gap-[var(--space-2)] max-[820px]:w-full max-[820px]:justify-stretch">
        <label className="grid min-w-[180px] gap-1.5 text-[0.875rem] font-semibold text-[var(--text-muted)]">
          <span className={ui.labelText}>Sort by</span>
          <select
            className={ui.input}
            value={sortKey}
            onChange={(event) => onSortKey(event.currentTarget.value as ProjectSortKey)}
          >
            {projectSortOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={classNames(ui.button, "h-10 w-12 min-w-12 justify-center px-0")}
          onClick={() => onSortDirection(sortDirection === "asc" ? "desc" : "asc")}
          title={sortDirection === "asc" ? "Sort ascending" : "Sort descending"}
          aria-label={sortDirection === "asc" ? "Sort ascending" : "Sort descending"}
        >
          {sortDirection === "asc" ? (
            <ArrowUp size={16} aria-hidden />
          ) : (
            <ArrowDown size={16} aria-hidden />
          )}
        </button>
        <label className="relative grid min-w-[260px] gap-1.5 text-[0.875rem] font-semibold text-[var(--text-muted)] max-[820px]:min-w-0 max-[820px]:flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
            size={16}
            aria-hidden
          />
          <span className="sr-only">Search projects</span>
          <input
            className={classNames(ui.input, "pl-[calc(var(--space-3)+22px)]")}
            type="search"
            value={query}
            onChange={(event) => onQuery(event.currentTarget.value)}
            placeholder="Search projects..."
          />
        </label>
      </div>
    </div>
  );
}

function AddProjectPanel({ onChanged }: { onChanged: () => void }) {
  const [source, setSource] = useState<"github" | "local">("github");
  const [repo, setRepo] = useState("");
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [tags, setTags] = useState("");
  const { busy, message, setMessage, runAction } = useAction();
  const add = async () => {
    if (busy) return;
    await runAction(async () => {
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
      setMessage({
        kind: "success",
        text: source === "github" ? "Project added and workspace updated." : "Project added.",
      });
      setRepo("");
      setName("");
      setGroup("");
      setTags("");
      onChanged();
    });
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
          <TextField
            label="Repository"
            value={repo}
            onChange={(event) => setRepo(event.target.value)}
            placeholder="owner/name"
          />
        ) : (
          <TextField
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="local-spike"
          />
        )}
        <TextField label="Group" value={group} onChange={(event) => setGroup(event.target.value)} />
        <TextField label="Tags" value={tags} onChange={(event) => setTags(event.target.value)} />
      </div>
      <button type="button" className={ui.buttonPrimary} onClick={add} disabled={busy}>
        <Plus size={16} aria-hidden /> Add Project
      </button>
      {message.text && (
        <p className={message.text.includes("added") ? feedbackClass.success : feedbackClass.error}>
          {message.text}
        </p>
      )}
    </section>
  );
}

function WorkspaceDriftPanel({ result, onChanged }: { result: UpPlan; onChanged: () => void }) {
  const [ignoredPlanAt, setIgnoredPlanAt] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [upResult, setUpResult] = useState<UpRunResult>();
  const { busy, message, setMessage, runAction } = useAction();
  const [resolvingProjectId, setResolvingProjectId] = useState("");
  const driftItems = workspaceDriftItems(result.items);
  const ignored = ignoredPlanAt === result.generatedAt;
  const primaryAction = shouldScaffoldFromConfiguration(driftItems)
    ? "Scaffold from Configuration"
    : "Sync Workspace";

  if (ignored || driftItems.length === 0) return null;

  const runUp = async () => {
    await runAction(async () => {
      setUpResult(await postUp());
      setMessage({ kind: "success", text: "Workspace up complete." });
      onChanged();
    });
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
    setMessage({ kind: "success", text: "" });
    try {
      await postResolveProjectCanonicalPath(item.project.id);
      setMessage({ kind: "success", text: "Canonical checkout path resolved." });
      onChanged();
    } catch (error) {
      setMessage({ kind: "error", text: String(error) });
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
      {message.text && <p className={feedbackToneClass(message.kind)}>{message.text}</p>}
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
            <span className={ui.muted}>
              <TextWithMonoPaths text={item.reason} />
            </span>
            <div className="grid gap-1">
              <span className={ui.labelText}>
                {isHostedClonePathMismatch(item) ? "Canonical path" : "Path"}
              </span>
              <span className={ui.mono}>{displayPath(item.project.path)}</span>
            </div>
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
  const importSelected = async () => {
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
  };
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
            onImport={() => void importSelected()}
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
      <div className="mb-[var(--space-3)] grid grid-cols-2 gap-[var(--space-3)] max-[820px]:grid-cols-1">
        <div className={importFieldClass}>
          <span className={importLabelClass}>From owner / org</span>
          <select
            className={importInputClass}
            value={draft.owner}
            onChange={(event) => onDraft((current) => ({ ...current, owner: event.target.value }))}
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
            value={draft.bulkGroup}
            placeholder="group for imported projects"
            onChange={(event) =>
              onDraft((current) => ({ ...current, bulkGroup: event.target.value }))
            }
          />
        </div>
      </div>
      <ImportTagField
        tags={draft.bulkTags}
        onTags={(bulkTags) => onDraft((current) => ({ ...current, bulkTags }))}
      />
      <div className="mb-[var(--space-3)] grid gap-[var(--space-1_5)]">
        <div className="relative flex items-center">
          <span className="pointer-events-none absolute left-[var(--space-3)] inline-flex text-[15px] text-[var(--text-faint)] [&_svg]:h-[15px] [&_svg]:w-[15px]">
            <Search size={15} />
          </span>
          <input
            className={classNames(importInputClass, "pl-[calc(var(--space-3)+22px)]")}
            value={draft.query}
            placeholder="Filter repositories..."
            onChange={(event) => onDraft((current) => ({ ...current, query: event.target.value }))}
          />
        </div>
        <p className="font-mono text-[var(--text-xs)] text-[var(--text-muted)]">
          Showing {filteredRows.length} of {rows.length} · {selectedCount} selected
        </p>
      </div>
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
    selected: filteredRecord(
      parsed.selected,
      (value): value is boolean => typeof value === "boolean",
    ),
    states: filteredRecord(parsed.states, isProjectState),
    groups: filteredRecord(parsed.groups, (value): value is string => typeof value === "string"),
    tags: filteredRecord(parsed.tags, (value): value is string => typeof value === "string"),
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

function filteredRecord<T>(
  value: unknown,
  accepts: (value: unknown) => value is T,
): Record<string, T> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, T] => accepts(entry[1])),
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
const projectLogoClass =
  "inline-flex h-9 w-9 flex-none select-none items-center justify-center overflow-hidden bg-transparent";

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
    <ul
      className="m-0 flex list-none flex-col overflow-hidden rounded-[var(--radius-md)] border-[1.5px] border-[var(--border-subtle)] p-0"
      aria-label="GitHub repositories"
    >
      {candidates.map((candidate) => (
        <ImportCandidateRow
          key={candidate.repo}
          candidate={candidate}
          draft={draft}
          onDraft={onDraft}
        />
      ))}
    </ul>
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
  draft,
  onDraft,
}: {
  candidate: HostedImportCandidate;
  draft: GitHubImportDraft;
  onDraft: (updater: (current: GitHubImportDraft) => GitHubImportDraft) => void;
}) {
  const checked = draft.selected[candidate.repo] === true;
  const group = draft.groups[candidate.repo] ?? "";
  const state = draft.states[candidate.repo] ?? candidate.suggestedState;
  const tags = draft.tags[candidate.repo] ?? "";
  const update = <K extends "selected" | "groups" | "states" | "tags">(
    field: K,
    value: GitHubImportDraft[K][string],
  ) =>
    onDraft((current) => ({ ...current, [field]: { ...current[field], [candidate.repo]: value } }));
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
    update("selected", !checked);
  };
  return (
    <li
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
          onChange={(event) => update("selected", event.target.checked)}
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
            <StateSelect value={state} onChange={(value) => update("states", value)} />
          </div>
          <label className={importFieldClass}>
            <span className={importLabelClass}>Group override</span>
            <input
              className={importInputClass}
              value={group}
              placeholder="use dialog group"
              onChange={(event) => update("groups", event.target.value)}
            />
          </label>
          <label className={importFieldClass}>
            <span className={importLabelClass}>Tags override</span>
            <input
              className={importInputClass}
              value={tags}
              placeholder="use dialog tags"
              onChange={(event) => update("tags", event.target.value)}
            />
          </label>
        </div>
      ) : null}
    </li>
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
  useRefreshOnEvents(refresh, ["projects-refresh-finished", "up-finished", "validation-updated"]);
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

function ProjectCardGrid({
  onChanged,
  onPinnedChange,
  projects,
  selectedProjectId,
  onSelectProject,
  onRemove,
}: {
  onChanged: () => void;
  onPinnedChange: (projectId: string, pinned: boolean) => void;
  projects: Project[];
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
  onRemove: () => void;
}) {
  if (projects.length === 0) {
    return (
      <EmptyState art={assets.heraklesHero} title="No projects here">
        No projects match this lifecycle state or search query.
      </EmptyState>
    );
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-[var(--space-4)]">
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          onChanged={onChanged}
          onPinnedChange={onPinnedChange}
          onRemove={onRemove}
          onSelectProject={onSelectProject}
          project={project}
          selectedProjectId={selectedProjectId}
        />
      ))}
    </div>
  );
}

function ProjectCard({
  onChanged,
  onPinnedChange,
  onRemove,
  onSelectProject,
  project,
  selectedProjectId,
}: {
  onChanged: () => void;
  onPinnedChange: (projectId: string, pinned: boolean) => void;
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
        <ProjectAvatar project={project} />
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
              {project.repo}
            </Link>
          </strong>
          <ProjectRepositoryLink project={project} />
        </div>
        <ProjectStarButton project={project} onPinnedChange={onPinnedChange} />
        <LifecycleBadge state={project.state} />
      </div>
      {project.description && (
        <p className="m-0 line-clamp-2 overflow-hidden text-[var(--text-sm)] leading-snug text-[var(--text-muted)]">
          {project.description}
        </p>
      )}
      <ProjectLanguageBar project={project} />
      <ProjectRepositorySignals project={project} />
      <ProjectDefaultBranchSync project={project} onChanged={onChanged} />
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
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
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
        <ProjectOpenActions project={project} />
      </div>
    </article>
  );
}

function ProjectDefaultBranchSync({
  onChanged,
  project,
}: {
  onChanged: () => void;
  project: Project;
}) {
  const { busy, message, setMessage, runAction } = useAction();
  if (project.source !== "github" || !project.defaultBranchRef) return null;
  const sync = async () => {
    if (busy) return;
    await runAction(async () => {
      const result = await postSyncProjectDefaultBranch(project.id);
      if (result.status !== "done") {
        setMessage({ kind: "error", text: result.message });
      } else if (result.behindAfter && result.behindAfter > 0) {
        setMessage({
          kind: "error",
          text: `${result.branch} is still ${result.behindAfter} ${
            result.behindAfter === 1 ? "commit" : "commits"
          } behind`,
        });
      }
      onChanged();
    });
  };
  return (
    <div className="flex min-w-0 items-center justify-between gap-[var(--space-2)] font-mono text-[var(--text-2xs)] text-[var(--text-faint)]">
      <span className="inline-flex min-w-0 items-center gap-[var(--space-1)]">
        <GitBranch size={13} aria-hidden />
        <span className="truncate">{defaultBranchBehindLabel(project)}</span>
      </span>
      <button
        type="button"
        className={ui.iconButton}
        title="Synchronize local default branch"
        aria-label="Synchronize local default branch"
        disabled={busy}
        onClick={sync}
      >
        {busy ? (
          <LoaderCircle size={15} className="animate-spin" aria-hidden />
        ) : (
          <RefreshCcw size={15} aria-hidden />
        )}
      </button>
      {message.text ? <span className={feedbackClass.error}>{message.text}</span> : null}
    </div>
  );
}

function defaultBranchBehindLabel(project: Project): string {
  const branch = project.defaultBranchRef ?? "default branch";
  const behind = project.defaultBranchBehindBy;
  if (behind === undefined) return `${branch}: behind unknown`;
  return `${branch}: ${behind} ${behind === 1 ? "commit" : "commits"} behind`;
}

function ProjectRepositoryLink({ project }: { project: Project }) {
  const { busy, message, runAction } = useAction();
  const label =
    project.source === "github" && project.owner
      ? `${project.owner}/${project.repo}`
      : (project.visibility ?? project.source);

  if (!project.url) {
    return (
      <span className="font-mono text-[var(--text-xs)] text-[var(--text-faint)]">{label}</span>
    );
  }

  const openGitHub = async () => {
    if (busy) return;
    await runAction(async () => {
      await openProjectTarget(project, "github");
    });
  };

  return (
    <span className="flex min-w-0 items-center gap-[var(--space-1)]">
      <button
        type="button"
        className="min-w-0 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent p-0 text-left font-mono text-[var(--text-xs)] text-[var(--text-faint)] underline-offset-2 hover:text-[var(--primary)] hover:underline disabled:cursor-wait disabled:opacity-70"
        title={`Open ${label} in GitHub`}
        aria-label={`Open ${label} in GitHub`}
        disabled={busy}
        onClick={openGitHub}
      >
        {label}
      </button>
      {message.text ? <span className={feedbackClass.error}>{message.text}</span> : null}
    </span>
  );
}

function ProjectLanguageBar({ project }: { project: Project }) {
  const languages = topProjectLanguages(project);
  if (languages.length === 0) {
    return (
      <div className="grid gap-1">
        <span className={ui.labelText}>Languages</span>
        <span className={ui.mono}>No language data</span>
        <ProjectLineCountSummary project={project} />
      </div>
    );
  }
  const total = languages.reduce((sum, language) => sum + language.size, 0) || languages.length;
  return (
    <div className="grid gap-1.5">
      <div
        className="flex h-2 overflow-hidden rounded-full bg-[var(--surface-inset)]"
        role="img"
        aria-label={`Top languages: ${languages.map((language) => language.name).join(", ")}`}
      >
        {languages.map((language) => (
          <span
            key={language.name}
            className="h-full min-w-[3px]"
            style={{
              backgroundColor: languageColor(language.name),
              width: `${Math.max(((language.size || 1) / total) * 100, 3)}%`,
            }}
            title={`${language.name} ${languagePercent(language.size || 1, total)}`}
          />
        ))}
      </div>
      <div className="flex min-w-0 flex-wrap gap-x-[var(--space-2)] gap-y-1">
        {languages.map((language) => (
          <span
            className="inline-flex items-center gap-[var(--space-1)] font-mono text-[var(--text-2xs)] text-[var(--text-faint)]"
            key={language.name}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: languageColor(language.name) }}
              aria-hidden
            />
            {language.name}
            <span>{languagePercent(language.size || 1, total)}</span>
          </span>
        ))}
      </div>
      <ProjectLineCountSummary project={project} />
    </div>
  );
}

function ProjectLineCountSummary({ project }: { project: Project }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-x-[var(--space-3)] gap-y-1 font-mono text-[var(--text-2xs)] text-[var(--text-faint)]">
      <span>
        LOC{" "}
        <strong className="font-semibold text-[var(--text-muted)]">
          {lineCount(project.lineCounts?.loc)}
        </strong>
      </span>
      <span>
        SLOC{" "}
        <strong className="font-semibold text-[var(--text-muted)]">
          {lineCount(project.lineCounts?.sloc)}
        </strong>
      </span>
    </div>
  );
}

function ProjectRepositorySignals({ project }: { project: Project }) {
  return (
    <div className="grid gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-[var(--space-3)] py-[var(--space-2)]">
      <div className="grid grid-cols-2 gap-x-[var(--space-3)] gap-y-1">
        <ProjectSignal
          icon={<GitPullRequest size={13} aria-hidden />}
          label="PRs"
          value={countLabel(project.openPullRequests)}
          detail={draftPullRequestLabel(project)}
        />
        <ProjectSignal
          icon={<CircleDot size={13} aria-hidden />}
          label="Issues"
          value={countLabel(project.openIssues)}
        />
      </div>
      <div className="grid grid-cols-2 gap-x-[var(--space-3)] gap-y-1">
        <ProjectSignal
          icon={<History size={13} aria-hidden />}
          label="Last commit"
          value={relativeDate(project.mainlineCommittedAt)}
          title={absoluteDate(project.mainlineCommittedAt)}
        />
        <ProjectSignal
          icon={<RefreshCcw size={13} aria-hidden />}
          label="Activity"
          value={relativeDate(project.latestActivityAt)}
          title={absoluteDate(project.latestActivityAt)}
        />
      </div>
    </div>
  );
}

function ProjectSignal({
  detail,
  icon,
  label,
  title,
  value,
}: {
  detail?: string | undefined;
  icon: ReactNode;
  label: string;
  title?: string | undefined;
  value: string;
}) {
  return (
    <span
      className="min-w-0 font-mono text-[var(--text-2xs)] text-[var(--text-faint)]"
      title={title}
    >
      <span className="mb-0.5 flex min-w-0 items-center gap-[var(--space-1)] text-[var(--text-muted)]">
        {icon}
        <span>{label}</span>
      </span>
      <strong className="text-[var(--text-xs)] font-semibold text-[var(--text-strong)]">
        {value}
      </strong>
      {detail ? <span className="ml-1 text-[var(--text-faint)]">{detail}</span> : null}
    </span>
  );
}

function topProjectLanguages(project: Project): Array<{ name: string; size: number }> {
  const languages = project.languageBreakdown?.length
    ? project.languageBreakdown
    : project.languages.map((name) => ({ name, size: 1 }));
  return languages
    .filter((language) => language.name)
    .sort((a, b) => b.size - a.size || a.name.localeCompare(b.name))
    .slice(0, 5);
}

function languagePercent(size: number, total: number): string {
  return `${((size / total) * 100).toFixed(1)}%`;
}

function countLabel(count: number | undefined): string {
  return count === undefined ? "--" : String(count);
}

function lineCount(count: number | undefined): string {
  return count === undefined ? "--" : count.toLocaleString();
}

function draftPullRequestLabel(project: Project): string | undefined {
  if (project.openPullRequests === undefined) return undefined;
  return `(${project.draftPullRequests ?? 0} draft)`;
}

function relativeDate(value: string | undefined): string {
  if (!value) return "--";
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "--";
  const seconds = Math.round((time - Date.now()) / 1000);
  const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, unitSeconds] of ranges) {
    if (Math.abs(seconds) >= unitSeconds || unit === "minute") {
      return formatter.format(Math.round(seconds / unitSeconds), unit);
    }
  }
  return "just now";
}

function absoluteDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return undefined;
  return new Date(time).toLocaleString();
}

function languageColor(language: string): string {
  const color = githubLanguageColors[language];
  if (color) return color;
  let hash = 0;
  for (const char of language) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return `hsl(${hash} 58% 58%)`;
}

const githubLanguageColors: Record<string, string> = {
  CSS: "#663399",
  Dockerfile: "#384d54",
  Go: "#00add8",
  HTML: "#e34c26",
  JavaScript: "#f1e05a",
  "Jupyter Notebook": "#da5b0b",
  Pascal: "#e3f171",
  PHP: "#4f5d95",
  Python: "#3572a5",
  Ruby: "#701516",
  Rust: "#dea584",
  Shell: "#89e051",
  Swift: "#f05138",
  TypeScript: "#3178c6",
};

function ProjectAvatar({ project }: { project: Project }) {
  const [failed, setFailed] = useState(false);
  const initials = repoInitials(project.repo);
  return (
    <span className={projectLogoClass} aria-hidden>
      {failed ? (
        initials
      ) : (
        <img
          className="h-full w-full object-contain"
          src={projectIconUrl(project.id)}
          alt=""
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

function yesNo(value: boolean) {
  return value ? "yes" : "no";
}

function lifecycleAccent(state: ProjectState) {
  return `var(--lc-${state})`;
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

function ProjectStarButton({
  onPinnedChange,
  project,
}: {
  onPinnedChange: (projectId: string, pinned: boolean) => void;
  project: Project;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toggle = async () => {
    if (busy) return;
    const previousPinned = project.pinned;
    const nextPinned = !previousPinned;
    setBusy(true);
    setError("");
    onPinnedChange(project.id, nextPinned);
    try {
      await postProjectConfigApply(project.id, { pinned: nextPinned });
    } catch (error) {
      onPinnedChange(project.id, previousPinned);
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex items-center">
      <button
        type="button"
        className={classNames(
          ui.iconButton,
          project.pinned && "text-[var(--primary)] hover:text-[var(--primary-hover)]",
        )}
        title={project.pinned ? "Unstar repository" : "Star repository"}
        aria-label={project.pinned ? "Unstar repository" : "Star repository"}
        aria-pressed={project.pinned}
        disabled={busy}
        onClick={toggle}
      >
        {busy ? (
          <LoaderCircle size={16} className="animate-spin" aria-hidden />
        ) : (
          <Star size={16} className={project.pinned ? "fill-current" : undefined} aria-hidden />
        )}
      </button>
      {error ? <span className={feedbackClass.error}>{error}</span> : null}
    </span>
  );
}

const projectOpenTargets = [
  { target: "filesystem", label: "Open in Finder / Explorer", icon: FolderOpen },
  { target: "github", label: "Open in GitHub", icon: Github },
  { target: "terminal", label: "Open in Terminal", icon: Terminal },
  { target: "codex", label: "Open in Codex", icon: SquareTerminal },
] as const;

function ProjectOpenActions({ project }: { project: Project }) {
  const [busyTarget, setBusyTarget] = useState<ProjectOpenTarget | "">("");
  const [error, setError] = useState("");
  const openTarget = async (target: ProjectOpenTarget) => {
    if (busyTarget) return;
    setBusyTarget(target);
    setError("");
    try {
      await openProjectTarget(project, target);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusyTarget("");
    }
  };
  return (
    <div className="flex min-w-0 items-center justify-end gap-1">
      {projectOpenTargets.map(({ target, label, icon: Icon }) => (
        <button
          key={target}
          type="button"
          className={ui.iconButton}
          title={label}
          aria-label={label}
          disabled={Boolean(busyTarget) || (target === "github" && !project.url)}
          onClick={() => openTarget(target)}
        >
          {busyTarget === target ? (
            <LoaderCircle size={16} className="animate-spin" aria-hidden />
          ) : (
            <Icon size={16} aria-hidden />
          )}
        </button>
      ))}
      {error ? <span className={feedbackClass.error}>{error}</span> : null}
    </div>
  );
}

async function openProjectTarget(project: Project, target: ProjectOpenTarget) {
  const destination = target === "github" ? project.url : project.path;
  if (!destination) return;
  await postOpenProject(project.id, target, destination);
}

function ProjectRemoveButton({ onRemove, project }: { onRemove: () => void; project: Project }) {
  const { busy, message, runAction } = useAction();
  const remove = async () => {
    if (busy) return;
    if (!confirmStopTracking(project)) return;
    await runAction(async () => {
      await postRemoveProject(project.slug);
      onRemove();
    });
  };
  return (
    <>
      <button type="button" className={ui.buttonDanger} onClick={remove} disabled={busy}>
        Remove
      </button>
      {message.text && <span className={feedbackClass.error}>{message.text}</span>}
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
    </>
  );
}

function ProjectMetadataPanel({ project }: { project: Project }) {
  const items = projectDetailItems(project);
  return (
    <section className={ui.panel}>
      <h2>{project.repo}</h2>
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

function ProjectValidationPanel({ issues }: { issues: ProjectDetail["validationIssues"] }) {
  return (
    <section className={ui.panel}>
      <h2>Validation</h2>
      <ValidationIssueList issues={issues} />
    </section>
  );
}

function ProjectSettingsPanel({
  projects,
  selectedProjectId,
  onApplied,
  onRenamed,
}: {
  projects: Project[];
  selectedProjectId: string;
  onApplied: () => void;
  onRenamed: (projectId: string) => void;
}) {
  const project = projects.find((candidate) => candidate.id === selectedProjectId);
  if (!project) return null;

  return (
    <section className={ui.panel}>
      <h2 className={ui.panelTitle}>Project Settings</h2>
      <ProjectStateControls key={`state-${project.id}`} project={project} onApplied={onApplied} />
      {project.source === "github" && project.owner && (
        <ProjectRenamePanel
          key={`rename-${project.id}`}
          owner={project.owner}
          project={project}
          onRenamed={onRenamed}
        />
      )}
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
  const { busy, message, setMessage, runAction } = useAction();

  useEffect(() => {
    setPlan(undefined);
    setPreviewKey("");
    setMessage({ kind: "success", text: "" });
    setState(project.state);
    setGroup(project.group ?? "");
    setTags(project.tags.join(", "));
    setLearning("");
    setForce(false);
  }, [project.state, project.group, project.tags, setMessage]);

  const currentKey = projectConfigPreviewKey(project.id, state, group, tags, learning, force);
  const canApply = plan !== undefined && previewKey === currentKey;

  const previewConfigPlan = () => runProjectConfigOperation("preview");
  const applyConfigPlan = () => runProjectConfigOperation("apply");
  const runProjectConfigOperation = async (operation: "preview" | "apply") => {
    await runAction(async () => {
      const changes: ProjectConfigValues = {
        state,
        group: group.trim(),
        tags: splitTags(tags),
        ...(learning.trim() ? { learning: learning.trim() } : {}),
      };
      const nextPlan =
        operation === "apply"
          ? await postProjectConfigApply(project.id, changes, { force })
          : await postProjectConfigPlan(project.id, changes, { force });
      setPlan(nextPlan);
      setPreviewKey(currentKey);
      if (operation === "apply") {
        setMessage({ kind: "success", text: "Applied" });
        onApplied();
      }
    });
  };
  return (
    <>
      <div className={ui.formGrid}>
        <div className="grid gap-1 self-end">
          <strong className={ui.listTitle}>{project.repo}</strong>
          <span className={ui.mono}>
            {project.source === "github" && project.owner
              ? `${project.owner}/${project.repo}`
              : project.source}
          </span>
        </div>
        <label className={ui.label} htmlFor={`project-state-${project.id}`}>
          <span className={ui.labelText}>State</span>
          <StateSelect
            id={`project-state-${project.id}`}
            value={state}
            onChange={(value) => {
              setState(value);
              setPreviewKey("");
            }}
          />
        </label>
        <TextField
          label="Group"
          value={group}
          onChange={(event) => {
            setGroup(event.target.value);
            setPreviewKey("");
          }}
        />
        <TextField
          label="Tags"
          value={tags}
          onChange={(event) => {
            setTags(event.target.value);
            setPreviewKey("");
          }}
        />
        <TextField
          label="Learning file"
          value={learning}
          onChange={(event) => {
            setLearning(event.target.value);
            setPreviewKey("");
          }}
        />
        <label className={ui.checkboxLabel}>
          <input
            className={ui.checkbox}
            type="checkbox"
            checked={force}
            onChange={(event) => {
              setForce(event.target.checked);
              setPreviewKey("");
            }}
          />
          <span>Force transition</span>
        </label>
        <button
          type="button"
          className={ui.buttonGhost}
          onClick={previewConfigPlan}
          disabled={busy}
        >
          Preview
        </button>
        <button
          type="button"
          className={ui.buttonPrimary}
          onClick={applyConfigPlan}
          disabled={busy || !canApply}
        >
          Apply
        </button>
      </div>
      <ProjectConfigPlanPreview plan={plan} />
      {message.text && (
        <p className={message.text === "Applied" ? feedbackClass.success : feedbackClass.error}>
          {message.text}
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

function ProjectRenamePanel({
  owner,
  project,
  onRenamed,
}: {
  owner: string;
  project: Project;
  onRenamed: (projectId: string) => void;
}) {
  const [newName, setNewName] = useState(project.repo);
  const [plan, setPlan] = useState<ProjectRenamePlan>();
  const [result, setResult] = useState<ProjectRenameResult>();
  const [previewKey, setPreviewKey] = useState("");
  const { busy, message, setMessage, runAction } = useAction(errorMessage);

  useEffect(() => {
    setNewName(project.repo);
    setPlan(undefined);
    setResult(undefined);
    setPreviewKey("");
    setMessage({ kind: "success", text: "" });
  }, [project.repo, setMessage]);

  const trimmedName = newName.trim();
  const currentKey = `${project.id}:${trimmedName}`;
  const canPreview = trimmedName.length > 0 && trimmedName !== project.repo;
  const canApply = plan !== undefined && previewKey === currentKey;
  const targetRepo = `${owner}/${trimmedName}`;

  const run = async (operation: "preview" | "apply") => {
    setResult(undefined);
    await runAction(async () => {
      if (operation === "preview") {
        const nextPlan = await postProjectRenamePlan(project.id, targetRepo);
        setPlan(nextPlan);
        setPreviewKey(currentKey);
        return;
      }
      const nextResult = await postProjectRename(project.id, targetRepo);
      setResult(nextResult);
      setPlan(nextResult.plan);
      setMessage({
        kind: nextResult.status === "renamed" ? "success" : "error",
        text: nextResult.message,
      });
      if (nextResult.status === "renamed") {
        onRenamed(`github:${nextResult.plan.newRepo}`);
      }
    });
  };

  return (
    <section className={ui.panel}>
      <h2 className={ui.panelTitle}>Rename Project</h2>
      <p className={ui.muted}>
        Rename the GitHub repository and update its derived checkout path and tracked config.
        Repository transfers are not supported.
      </p>
      <div className={ui.formGrid}>
        <div className="grid gap-[var(--space-1_5)]">
          <span className={ui.labelText}>Owner</span>
          <strong className={ui.mono}>{owner}</strong>
        </div>
        <TextField
          label="Repository name"
          value={newName}
          onChange={(event) => {
            setNewName(event.target.value);
            setPreviewKey("");
            setPlan(undefined);
            setResult(undefined);
            setMessage({ kind: "success", text: "" });
          }}
        />
        <button
          type="button"
          className={ui.buttonGhost}
          onClick={() => void run("preview")}
          disabled={busy || !canPreview}
        >
          Preview Rename
        </button>
        <button
          type="button"
          className={ui.buttonPrimary}
          onClick={() => void run("apply")}
          disabled={busy || !canApply}
        >
          Apply Rename
        </button>
      </div>
      <ProjectRenameOutput plan={plan} result={result} />
      {message.text && (
        <p
          className={feedbackToneClass(message.kind)}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}

function ProjectRenameOutput({
  plan,
  result,
}: {
  plan: ProjectRenamePlan | undefined;
  result: ProjectRenameResult | undefined;
}) {
  if (!plan) return null;
  const resultByKind = new Map(result?.steps.map((step) => [step.kind, step]));
  return (
    <div className="mt-[var(--space-4)] grid gap-[var(--space-3)]" aria-live="polite">
      <ol className={ui.list}>
        {plan.steps.map((step) => {
          const applied = resultByKind.get(step.kind);
          return (
            <li className={ui.listRow} key={step.kind}>
              <span className={ui.listRowMain}>
                <strong className={ui.listTitle}>{step.label}</strong>
                <span className={ui.mono}>
                  {[step.from, step.to].filter(Boolean).join(" → ") || "No local action"}
                </span>
              </span>
              <Badge tone={renameStepTone(applied?.status ?? step.status)}>
                {applied?.status ?? step.status}
              </Badge>
            </li>
          );
        })}
      </ol>
      <pre className={ui.codeBlock}>{plan.configDiff}</pre>
      <ul className="grid gap-1 pl-[var(--space-5)] text-[var(--text-sm)] text-[var(--text-muted)]">
        {plan.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  );
}

function renameStepTone(
  status:
    | ProjectRenamePlan["steps"][number]["status"]
    | ProjectRenameResult["steps"][number]["status"],
): "neutral" | "success" | "warning" | "danger" {
  if (status === "done" || status === "already-satisfied") return "success";
  if (status === "failed") return "danger";
  if (status === "pending") return "warning";
  return "neutral";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function LocalPromotionPanel({
  project,
  onPromoted,
}: {
  project: Project;
  onPromoted: () => void;
}) {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState(project.repo);
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [plan, setPlan] = useState("");
  const [result, setResult] = useState<LocalPromotionResult>();
  const { busy, message, setMessage, runAction } = useAction();

  useEffect(() => {
    setRepo(project.repo);
    setPlan("");
    setResult(undefined);
    setMessage({ kind: "success", text: "" });
  }, [project, setMessage]);

  const options = () => ({
    ...(owner ? { owner } : {}),
    ...(repo ? { repo } : {}),
    visibility,
  });

  const runPromotion = async (apply: boolean) => {
    setResult(undefined);
    await runAction(async () => {
      if (!apply) {
        const nextPlan = await postLocalPromotionPlan(project.id, options());
        setPlan(nextPlan.command.join(" "));
        return;
      }
      const nextResult = await postLocalPromotion(project.id, options());
      setResult(nextResult);
      setPlan(nextResult.plan.command.join(" "));
      setMessage({
        kind: nextResult.status === "promoted" ? "success" : "error",
        text: nextResult.message,
      });
      if (nextResult.status === "promoted") onPromoted();
    });
  };

  return (
    <section className={ui.panel}>
      <h2 className={ui.panelTitle}>Promotion</h2>
      <div className={ui.formGrid}>
        <TextField label="Owner" value={owner} onChange={(event) => setOwner(event.target.value)} />
        <TextField label="Repo" value={repo} onChange={(event) => setRepo(event.target.value)} />
        <label className={ui.label}>
          <span className={ui.labelText}>Visibility</span>
          <select
            className={ui.input}
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as "public" | "private")}
          >
            <option value="private">private</option>
            <option value="public">public</option>
          </select>
        </label>
        <button
          type="button"
          className={ui.buttonGhost}
          onClick={() => runPromotion(false)}
          disabled={busy}
        >
          Preview
        </button>
        <button
          type="button"
          className={ui.buttonPrimary}
          onClick={() => runPromotion(true)}
          disabled={busy}
        >
          Promote
        </button>
      </div>
      <LocalPromotionOutput message={message} plan={plan} result={result} />
    </section>
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
