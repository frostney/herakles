export type ProjectSource = "github" | "local";

export type HostedVisibility = "public" | "private" | null;

export type ProjectState = "experiment" | "candidate" | "commercial" | "open-source" | "archived";

export type UpAction = "clone" | "fetch" | "skip" | "validate";

export type ProjectLanguage = {
  name: string;
  size: number;
};

export type GitHubRepository = {
  name: string;
  nameWithOwner: string;
  owner: string;
  sshUrl?: string;
  url?: string;
  visibility: "PUBLIC" | "PRIVATE";
  isPrivate?: boolean;
  isArchived: boolean;
  repositoryTopics: string[];
  primaryLanguage?: string;
  languages: string[];
  languageBreakdown?: ProjectLanguage[];
  defaultBranchRef?: string;
  description?: string;
  homepageUrl?: string;
  latestActivityAt?: string;
  mainlineCommittedAt?: string;
  pushedAt?: string;
  updatedAt?: string;
  openPullRequests?: number;
  draftPullRequests?: number;
  openIssues?: number;
};

export type LocalRepository = {
  name: string;
  path: string;
  remote?: string;
};

export type Project = {
  source: ProjectSource;
  id: string;
  owner?: string;
  repo: string;
  slug: string;
  path: string;
  group?: string;
  remote?: string;
  url?: string;
  visibility: HostedVisibility;
  state: ProjectState;
  archived: boolean;
  pinned: boolean;
  topics: string[];
  tags: string[];
  primaryLanguage?: string;
  languages: string[];
  languageBreakdown?: ProjectLanguage[];
  defaultBranchRef?: string;
  hasRoadmap: boolean;
  learningPath?: string;
  archiveNote?: string;
  up: boolean;
  automationEnabled: boolean;
  description?: string;
  latestActivityAt?: string;
  mainlineCommittedAt?: string;
  pushedAt?: string;
  updatedAt?: string;
  openPullRequests?: number;
  draftPullRequests?: number;
  openIssues?: number;
};

export type HostedImportCandidate = {
  repo: string;
  owner: string;
  name: string;
  visibility: "public" | "private";
  archived: boolean;
  suggestedState: ProjectState;
  topics: string[];
  description?: string;
  updatedAt?: string;
  alreadyTracked: boolean;
};

export type ValidationSeverity = "error" | "warning";

export type ValidationIssue = {
  severity: ValidationSeverity;
  code: string;
  projectId?: string;
  message: string;
};

export type ValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
};

export type UpPlanItem = {
  project: Project;
  action: UpAction;
  reason: string;
};

export type UpPlan = {
  generatedAt: string;
  server?: string;
  items: UpPlanItem[];
};

export type DoctorCheck = {
  name: string;
  status: "ok" | "warn" | "fail";
  message: string;
};

export type DoctorResult = {
  generatedAt: string;
  checks: DoctorCheck[];
};

export type HeraklesEventType =
  | "connected"
  | "projects-refresh-started"
  | "projects-refresh-finished"
  | "up-started"
  | "up-progress"
  | "up-finished"
  | "automation-started"
  | "automation-log"
  | "automation-finished"
  | "validation-updated"
  | "report-created";

export type HeraklesEvent = {
  id: number;
  type: HeraklesEventType;
  generatedAt: string;
  message: string;
  payload?: Record<string, unknown>;
};

export type AgentRuntimeRunResult = {
  status: "succeeded" | "failed";
  reportPath: string;
  exitCode: number;
  message: string;
};

export type AutomationJob = {
  id: string;
  schedule: string;
  runtime: string;
  prompt?: string;
  output?: string;
  repoFilter?: string;
  includeTags: string[];
  excludeTags: string[];
  skill?: string;
  enabled: boolean;
};

export type AutomationDueSlot = {
  jobId: string;
  slotId: string;
  dueAt: string;
};

export type AutomationRun = {
  jobId: string;
  slotId: string;
  status: "planned" | "claimed" | "skipped" | "succeeded" | "failed";
  reportPath?: string;
  message: string;
  startedAt: string;
  finishedAt?: string;
};

export type AutomationLock = {
  jobId: string;
  slotId: string;
  machine: string;
  startedAt: string;
  expiresAt: string;
  backend: "local-file";
};

export type LocalPromotionPlan = {
  projectId: string;
  localPath: string;
  owner: string;
  repo: string;
  visibility: "public" | "private";
  remote: string;
  command: string[];
  writesSyncedConfig: false;
  notes: string[];
};

export type LocalPromotionResult = {
  plan: LocalPromotionPlan;
  status: "promoted" | "failed";
  message: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type ReportSummary = {
  id: string;
  path: string;
  title: string;
  kind: string;
  updatedAt: string;
};

export type ReportDetail = ReportSummary & {
  content: string;
};

export type ProjectDetail = {
  project: Project;
  reports: ReportSummary[];
  validationIssues: ValidationIssue[];
};
