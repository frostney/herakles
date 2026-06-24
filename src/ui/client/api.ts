import type {
  AutomationJobConfigInput,
  AutomationJobConfigPlan,
  AutomationPayload,
  ProjectConfigPlan,
  ProjectConfigValues,
  ProjectDiscoveryRefreshResult,
  StatusPayload,
  UpRunResult,
} from "../../api/contracts";
import type {
  AutomationRun,
  DoctorResult,
  HeraklesEvent,
  HostedImportCandidate,
  LocalPromotionPlan,
  LocalPromotionResult,
  Project,
  ProjectDefaultBranchSyncResult,
  ProjectDetail,
  ProjectOpenTarget,
  ProjectState,
  PullRequestCollection,
  ReportDetail,
  ReportSummary,
  UpPlan,
  ValidationResult,
} from "../../domain";

export type { HeraklesEvent, LocalPromotionResult };
export type {
  AutomationJobConfigInput,
  AutomationJobConfigPlan,
  AutomationPayload,
  ProjectConfigPlan,
  ProjectConfigValues,
  ProjectDiscoveryRefreshResult,
  StatusPayload,
  UpRunResult,
} from "../../api/contracts";

export async function getStatus(): Promise<StatusPayload> {
  return get("/api/status");
}

export async function getProjects(): Promise<Project[]> {
  return get("/api/projects");
}

export async function getProjectDetail(id: string): Promise<ProjectDetail> {
  return get(`/api/projects/${encodeURIComponent(id)}`);
}

export async function getPullRequests(
  options: { refresh?: boolean } = {},
): Promise<PullRequestCollection> {
  return get(`/api/pull-requests${options.refresh ? "?refresh=true" : ""}`);
}

export function projectIconUrl(id: string): string {
  return `/api/project-icons/${encodeURIComponent(id)}`;
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

export async function getAutomations(): Promise<AutomationPayload> {
  return get("/api/automation/jobs");
}

export async function getHostedImportCandidates(): Promise<HostedImportCandidate[]> {
  return get("/api/projects/import-candidates");
}

export async function getUpPlan(): Promise<UpPlan> {
  return get("/api/up/plan");
}

export async function getDoctor(): Promise<DoctorResult> {
  return get("/api/doctor");
}

export async function getConfigToml(): Promise<{ path: string; toml: string }> {
  return get("/api/config/toml");
}

export async function postConfigToml(
  toml: string,
  options: { apply?: boolean } = {},
): Promise<{ path: string; toml: string; validation: ValidationResult; applied: boolean }> {
  return post(options.apply ? "/api/config/toml/apply" : "/api/config/toml/plan", { toml });
}

export async function postProjectsRefresh(): Promise<ProjectDiscoveryRefreshResult> {
  return post("/api/projects/refresh");
}

export async function postAddProject(input: {
  id?: string;
  source: "github" | "local";
  repo?: string;
  name?: string;
  group?: string;
  state?: ProjectState;
  tags?: string[];
}): Promise<ProjectConfigPlan> {
  return post("/api/projects/add", input);
}

export async function postImportProjects(
  projects: Array<{
    id?: string;
    repo: string;
    state?: ProjectState;
    group?: string;
    tags?: string[];
  }>,
): Promise<ProjectConfigPlan[]> {
  return post("/api/projects/import", { projects });
}

export async function postRemoveProject(projectId: string) {
  return post("/api/projects/remove", { projectId });
}

export async function postResolveProjectCanonicalPath(
  projectId: string,
): Promise<{ projectId: string; from: string; to: string; moved: true }> {
  return post("/api/projects/resolve-canonical-path", { projectId });
}

export async function postOpenProject(
  projectId: string,
  target: ProjectOpenTarget,
  destination: string,
) {
  return post("/api/projects/open", { projectId, target, destination });
}

export async function postProjectUp(
  projectId: string,
  options: { dryRun?: boolean } = {},
): Promise<UpRunResult> {
  return post("/api/projects/up", { projectId, dryRun: options.dryRun === true });
}

export async function postSyncProjectDefaultBranch(
  projectId: string,
): Promise<ProjectDefaultBranchSyncResult> {
  return post("/api/projects/sync-default-branch", { projectId });
}

export async function postValidate(options: { strict?: boolean } = {}): Promise<ValidationResult> {
  return post(`/api/validate${options.strict ? "?strict=true" : ""}`);
}

export async function postUp(options: { dryRun?: boolean } = {}): Promise<UpRunResult> {
  return post(options.dryRun ? "/api/up/plan" : "/api/up");
}

export async function postAutomationTick() {
  return post("/api/automation/tick");
}

export async function postAutomationRun(jobId: string): Promise<AutomationRun> {
  return post("/api/automation/run", { jobId, slot: "now" });
}

export async function postAutomationJobPlan(
  input: AutomationJobConfigInput,
): Promise<AutomationJobConfigPlan> {
  return post("/api/automation/job-plan", input);
}

export async function postAutomationJobApply(
  input: AutomationJobConfigInput,
): Promise<AutomationJobConfigPlan> {
  return post("/api/automation/job-apply", input);
}

export async function postProjectConfigPlan(
  projectId: string,
  changes: ProjectConfigValues,
  options: { force?: boolean } = {},
): Promise<ProjectConfigPlan> {
  return post("/api/config/project-plan", { projectId, ...changes, force: options.force === true });
}

export async function postProjectConfigApply(
  projectId: string,
  changes: ProjectConfigValues,
  options: { force?: boolean } = {},
): Promise<ProjectConfigPlan> {
  return post("/api/config/apply", { projectId, ...changes, force: options.force === true });
}

export async function postLocalPromotionPlan(
  projectId: string,
  options: { owner?: string; repo?: string; visibility?: "public" | "private" },
): Promise<LocalPromotionPlan> {
  return post("/api/projects/promote-plan", { projectId, ...options });
}

export async function postLocalPromotion(
  projectId: string,
  options: { owner?: string; repo?: string; visibility?: "public" | "private" },
): Promise<LocalPromotionResult> {
  return post("/api/projects/promote", { projectId, ...options });
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
