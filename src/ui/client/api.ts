import type {
  ApprovalCandidate,
  AutomationDueSlot,
  AutomationJob,
  AutomationLock,
  AutomationRun,
  CodeRabbitRecommendationRun,
  DoctorResult,
  HeraklesEvent,
  IssueRecommendationRun,
  LocalPromotionPlan,
  LocalPromotionResult,
  PatchPublishResult,
  PatchWorktreeResult,
  Project,
  ProjectDetail,
  ProjectState,
  PrunePlan,
  PruneResult,
  RepoMovePlan,
  ReportDetail,
  ReportSummary,
  ValidationResult,
} from "../../domain";

export type StatusPayload = {
  generatedAt: string;
  config: {
    syncedConfigPath: string;
    localConfigPath?: string;
  };
  root: string;
  projectCount: number;
  githubCount: number;
  localExperimentCount: number;
  hostedCloneCount: number;
  counts: Record<string, number>;
  validation: ValidationResult;
};

export type AutomationPayload = {
  jobs: AutomationJob[];
  due: AutomationDueSlot[];
  runs: AutomationRun[];
  locks: AutomationLock[];
};

export type { HeraklesEvent, LocalPromotionResult, RepoMovePlan };

export type OverridePlan = {
  configPath: string;
  projectId: string;
  repoKey: string;
  changes: Record<string, string>;
  before?: Record<string, string>;
  after: Record<string, string>;
  transition?: {
    from: ProjectState;
    to: ProjectState;
    allowed: boolean;
    forced: boolean;
  };
  validation?: ValidationResult;
  toml: string;
  diff: string;
  action: "append" | "replace";
};

export type SyncRunResult = Array<{
  item: {
    action: string;
    reason: string;
    project: Project;
  };
  status: string;
  message: string;
}>;

export type InventoryRefreshResult = {
  github: unknown[];
  local: unknown[];
  hostedLocal: unknown[];
  generatedAt: string;
  path: string;
};

export type LocalArchiveResult = {
  state?: ProjectState;
  learning?: string;
};

export async function getStatus(): Promise<StatusPayload> {
  return get("/api/status");
}

export async function getProjects(): Promise<Project[]> {
  return get("/api/projects");
}

export async function getProjectDetail(id: string): Promise<ProjectDetail> {
  return get(`/api/projects/${encodeURIComponent(id)}`);
}

export async function getLocalProjects(): Promise<Project[]> {
  return get("/api/local-projects");
}

export async function getReports(): Promise<ReportSummary[]> {
  return get("/api/reports");
}

export async function getReport(id: string): Promise<ReportDetail> {
  return get(`/api/reports/${encodeURIComponent(id)}`);
}

export async function postReportNote(input: {
  title: string;
  body: string;
  projectId?: string;
}): Promise<ReportDetail> {
  return post("/api/reports/note", input);
}

export async function getApprovals(): Promise<ApprovalCandidate[]> {
  return get("/api/approvals");
}

export async function getAutomations(): Promise<AutomationPayload> {
  return get("/api/automation/jobs");
}

export async function getDoctor(): Promise<DoctorResult> {
  return get("/api/doctor");
}

export async function getPrunePlan(): Promise<PrunePlan> {
  return get("/api/sync/prune-plan");
}

export async function postSyncDryRun(): Promise<SyncRunResult> {
  return post("/api/sync/dry-run");
}

export async function postSyncRun(): Promise<SyncRunResult> {
  return post("/api/sync");
}

export async function postInventoryRefresh(): Promise<InventoryRefreshResult> {
  return post("/api/inventory/refresh");
}

export async function postValidate(options: { strict?: boolean } = {}): Promise<ValidationResult> {
  return post(`/api/validate${options.strict ? "?strict=true" : ""}`);
}

export async function postPrune(projectId: string): Promise<PruneResult> {
  return post("/api/prune", { projectId });
}

export async function postAutomationTick() {
  return post("/api/automation/tick");
}

export async function postAutomationRun(jobId: string): Promise<AutomationRun> {
  return post("/api/automation/run", { jobId, slot: "now" });
}

export async function postIssueRecommendations(): Promise<IssueRecommendationRun> {
  return post("/api/recommendations/issues");
}

export async function postCodeRabbitRecommendations(): Promise<CodeRabbitRecommendationRun> {
  return post("/api/recommendations/coderabbit");
}

export async function postApprovalDecision(
  id: string,
  action: "approve" | "reject" | "defer",
): Promise<ApprovalCandidate> {
  return post(`/api/approvals/${encodeURIComponent(id)}/${action}`);
}

export async function postApprovalPrepare(id: string): Promise<PatchWorktreeResult> {
  return post(`/api/approvals/${encodeURIComponent(id)}/prepare`);
}

export async function postApprovalPublish(id: string): Promise<PatchPublishResult> {
  return post(`/api/approvals/${encodeURIComponent(id)}/publish`);
}

export async function postOverridePlan(
  projectId: string,
  state: ProjectState,
  options: { force?: boolean } = {},
): Promise<OverridePlan> {
  return post("/api/config/override-plan", { projectId, state, force: options.force === true });
}

export async function postOverrideApply(
  projectId: string,
  state: ProjectState,
  options: { force?: boolean } = {},
): Promise<OverridePlan> {
  return post("/api/config/apply", { projectId, state, force: options.force === true });
}

export async function postRepoMovePlan(projectId: string, path: string): Promise<RepoMovePlan> {
  return post("/api/repo/move-plan", { projectId, path });
}

export async function postRepoMove(projectId: string, path: string): Promise<RepoMovePlan> {
  return post("/api/repo/move", { projectId, path });
}

export async function postLocalPromotionPlan(
  projectId: string,
  options: { owner?: string; repo?: string; visibility?: "public" | "private" },
): Promise<LocalPromotionPlan> {
  return post(`/api/local-projects/${encodeURIComponent(projectId)}/promote-plan`, options);
}

export async function postLocalPromotion(
  projectId: string,
  options: { owner?: string; repo?: string; visibility?: "public" | "private" },
): Promise<LocalPromotionResult> {
  return post(`/api/local-projects/${encodeURIComponent(projectId)}/promote`, options);
}

export async function postLocalArchive(
  projectId: string,
  learning: string,
): Promise<LocalArchiveResult> {
  return post(`/api/local-projects/${encodeURIComponent(projectId)}/archive`, { learning });
}

export function subscribeToEvents(onEvent: (event: HeraklesEvent) => void): () => void {
  const source = new EventSource("/api/events");
  const handler = (message: MessageEvent<string>) => {
    onEvent(JSON.parse(message.data) as HeraklesEvent);
  };
  source.addEventListener("herakles", handler);
  return () => {
    source.removeEventListener("herakles", handler);
    source.close();
  };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
