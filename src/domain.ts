export type ProjectSource = "github" | "local";

export type HostedVisibility = "public" | "private" | null;

export type ProjectState = "experiment" | "candidate" | "commercial" | "open-source" | "archived";

export type UpAction = "clone" | "fetch" | "skip" | "validate";

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
  defaultBranchRef?: string;
  description?: string;
  homepageUrl?: string;
  pushedAt?: string;
  updatedAt?: string;
};

export type GitHubPullRequest = {
  repo: string;
  number: number;
  title: string;
  url: string;
  author?: string;
  headRefName?: string;
  updatedAt?: string;
};

export type GitHubReviewComment = {
  id: string;
  body: string;
  author?: string;
  path?: string;
  line?: number;
  url?: string;
  createdAt?: string;
};

export type GitHubReviewThread = {
  repo: string;
  prNumber: number;
  id: string;
  isResolved: boolean;
  path?: string;
  line?: number;
  comments: GitHubReviewComment[];
};

export type GitHubIssue = {
  repo: string;
  number: number;
  title: string;
  url: string;
  labels: string[];
  author?: string;
  updatedAt?: string;
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
  defaultBranchRef?: string;
  hasRoadmap: boolean;
  learningPath?: string;
  archiveNote?: string;
  up: boolean;
  automationEnabled: boolean;
  description?: string;
  updatedAt?: string;
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

export type CodexRunResult = {
  status: "succeeded" | "failed";
  reportPath: string;
  exitCode: number;
  message: string;
};

export type AutomationJob = {
  id: string;
  schedule: string;
  harness: string;
  prompt?: string;
  output?: string;
  repoFilter?: string;
  includeTags: string[];
  excludeTags: string[];
  issueLabels: string[];
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

export type IssueRecommendation = {
  id: string;
  projectId: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  proposedBranch: string;
  labels: string[];
  score: number;
  reasons: string[];
  updatedAt?: string;
};

export type IssueRecommendationRun = {
  generatedAt: string;
  reportPath: string;
  structuredPath: string;
  candidates: IssueRecommendation[];
};

export type CodeRabbitPullRequestContext = {
  id: string;
  projectId: string;
  repo: string;
  prNumber: number;
  title: string;
  url: string;
  headRefName?: string;
  updatedAt?: string;
  threads: GitHubReviewThread[];
};

export type CodeRabbitRecommendationRun = {
  generatedAt: string;
  reportPath: string;
  structuredPath: string;
  contexts: CodeRabbitPullRequestContext[];
};

export type TestCommand = {
  id: string;
  label: string;
  argv: string[];
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
