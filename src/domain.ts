export type ProjectSource = "github" | "local";

export type HostedVisibility = "public" | "private" | null;

export type ProjectState = "experiment" | "candidate" | "commercial" | "open-source" | "archived";

export type UpAction = "clone" | "fetch" | "skip" | "validate";

export type ProjectLanguage = {
  name: string;
  size: number;
};

export type ProjectLineCounts = {
  loc: number;
  sloc: number;
};

export type ProjectOpenTarget = "filesystem" | "github" | "codex" | "terminal";

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
  lineCounts?: ProjectLineCounts;
  defaultBranchRef?: string;
  defaultBranchBehindBy?: number;
  hasRoadmap: boolean;
  learningPath?: string;
  archiveNote?: string;
  up: boolean;
  description?: string;
  latestActivityAt?: string;
  mainlineCommittedAt?: string;
  pushedAt?: string;
  updatedAt?: string;
  openPullRequests?: number;
  draftPullRequests?: number;
  openIssues?: number;
};

export type ProjectDefaultBranchSyncResult = {
  projectId: string;
  branch: string;
  status: "done" | "skipped" | "failed";
  message: string;
  behindBefore?: number;
  behindAfter?: number;
};

export type PullRequestReviewStatus =
  | "approved"
  | "changes-requested"
  | "review-required"
  | "unknown";

export type PullRequestCheckStatus = "passing" | "failing" | "pending" | "unknown";

export type PullRequestSummary = {
  projectId: string;
  projectSlug: string;
  projectPinned: boolean;
  projectState: ProjectState;
  repo: string;
  owner: string;
  number: number;
  title: string;
  author: string;
  isDraft: boolean;
  state: "open";
  branch: string;
  baseBranch: string;
  updatedAt: string;
  url: string;
  reviewStatus: PullRequestReviewStatus;
  checkStatus: PullRequestCheckStatus;
};

export type PullRequestCollectionFailure = {
  projectId: string;
  projectSlug: string;
  repo: string;
  message: string;
};

export type PullRequestCollection = {
  generatedAt: string;
  pullRequests: PullRequestSummary[];
  failures: PullRequestCollectionFailure[];
  skippedLocalProjects: number;
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
  | "validation-updated";

export type HeraklesEvent = {
  id: number;
  type: HeraklesEventType;
  generatedAt: string;
  message: string;
  payload?: Record<string, unknown>;
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

export type ProjectRenameStepKind =
  | "rename-host"
  | "update-remote"
  | "move-checkout"
  | "rekey-config";

export type ProjectRenamePlanStep = {
  kind: ProjectRenameStepKind;
  status: "pending" | "already-satisfied" | "not-applicable";
  label: string;
  from?: string;
  to?: string;
  command?: string[];
};

export type ProjectRenamePlan = {
  projectId: string;
  owner: string;
  oldName: string;
  newName: string;
  oldRepo: string;
  newRepo: string;
  oldConfigKey: string;
  newConfigKey: string;
  oldPath: string;
  newPath: string;
  configPath: string;
  configDiff: string;
  steps: ProjectRenamePlanStep[];
  notes: string[];
};

export type ProjectRenameStepResult = {
  kind: ProjectRenameStepKind;
  status: "done" | "already-satisfied" | "not-applicable" | "failed";
  message: string;
};

export type ProjectRenameResult = {
  plan: ProjectRenamePlan;
  status: "renamed" | "failed";
  message: string;
  steps: ProjectRenameStepResult[];
};

export type ProjectDetail = {
  project: Project;
  validationIssues: ValidationIssue[];
};
