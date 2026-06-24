import { RefreshCcw, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ProjectState,
  PullRequestCheckStatus,
  PullRequestCollection,
  PullRequestReviewStatus,
  PullRequestSummary,
} from "../../../domain";
import { getPullRequests } from "../api";
import {
  type PullRequestDraftFilter,
  type PullRequestFilterState,
  defaultPullRequestFilters,
  filterPullRequests,
  pullRequestProjectOptions,
  uniquePullRequestAuthors,
} from "../pullRequestFilters";
import {
  Badge,
  type BadgeTone,
  DataTable,
  EmptyState,
  IconButton,
  LoadState,
  Metric,
  Panel,
  Screen,
} from "../shared/components";
import { useResource } from "../shared/hooks";
import { assets, ui } from "../shared/styles";

export function PullRequests() {
  const [data, refresh] = useResource(getPullRequests);
  const [lastReadyData, setLastReadyData] = useState<PullRequestCollection>();
  const [filters, setFilters] = useState<PullRequestFilterState>(defaultPullRequestFilters);
  useEffect(() => {
    if (data.status === "ready") setLastReadyData(data.data);
  }, [data]);
  const visibleData = data.status === "ready" ? data.data : lastReadyData;
  const refreshing = data.status === "loading" && visibleData !== undefined;
  const filtered = useMemo(
    () => (visibleData ? filterPullRequests(visibleData.pullRequests, filters) : []),
    [filters, visibleData],
  );
  return (
    <Screen
      title="Pull Requests"
      subtitle="Review open work across tracked hosted projects"
      actions={
        <>
          {refreshing ? <output className={ui.muted}>Refreshing...</output> : null}
          <IconButton
            label="Refresh"
            onClick={() => refresh(() => getPullRequests({ refresh: true }))}
            icon={<RefreshCcw size={16} />}
          />
        </>
      }
    >
      {visibleData ? (
        <>
          <PullRequestOverview data={visibleData} />
          <PullRequestFilters data={visibleData} filters={filters} onFilters={setFilters} />
          <PullRequestFailurePanel failures={visibleData.failures} />
          {data.status === "error" ? (
            <Panel title="Refresh Failed" actions={<Badge tone="danger">error</Badge>}>
              <p className={ui.muted}>{data.error}</p>
            </Panel>
          ) : null}
          <PullRequestTable pullRequests={filtered} />
        </>
      ) : (
        <LoadState state={data} />
      )}
    </Screen>
  );
}

function PullRequestOverview({ data }: { data: PullRequestCollection }) {
  return (
    <div className={ui.metrics}>
      <Metric label="Open PRs" value={data.pullRequests.length} />
      <Metric
        label="Drafts"
        value={data.pullRequests.filter((pullRequest) => pullRequest.isDraft).length}
      />
      <Metric
        label="Failing checks"
        value={
          data.pullRequests.filter((pullRequest) => pullRequest.checkStatus === "failing").length
        }
      />
      <Metric label="Partial failures" value={data.failures.length} />
    </div>
  );
}

function PullRequestFilters({
  data,
  filters,
  onFilters,
}: {
  data: PullRequestCollection;
  filters: PullRequestFilterState;
  onFilters: (filters: PullRequestFilterState) => void;
}) {
  const projects = pullRequestProjectOptions(data.pullRequests);
  const projectLabels = Object.fromEntries(
    projects.map((project) => [project.value, project.label]),
  );
  const authors = uniquePullRequestAuthors(data.pullRequests);
  const lifecycles: Array<ProjectState | "all"> = [
    "all",
    "open-source",
    "experiment",
    "candidate",
    "commercial",
    "archived",
  ];
  const draftStates: PullRequestDraftFilter[] = ["all", "open", "draft"];
  const reviewStates: Array<PullRequestReviewStatus | "all"> = [
    "all",
    "review-required",
    "approved",
    "changes-requested",
    "unknown",
  ];
  const checkStates: Array<PullRequestCheckStatus | "all"> = [
    "all",
    "failing",
    "pending",
    "passing",
    "unknown",
  ];
  return (
    <section className={ui.panel}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-[var(--space-3)]">
        <label className={ui.label}>
          <span className={ui.labelText}>Search</span>
          <input
            className={ui.input}
            value={filters.query}
            onChange={(event) => onFilters({ ...filters, query: event.target.value })}
            placeholder="Search pull requests..."
          />
        </label>
        <PullRequestSelect
          label="Project"
          value={filters.project}
          values={["all", ...projects.map((project) => project.value)]}
          labels={projectLabels}
          onChange={(project) => onFilters({ ...filters, project })}
        />
        <PullRequestSelect
          label="Lifecycle"
          value={filters.lifecycle}
          values={lifecycles}
          onChange={(lifecycle) => onFilters({ ...filters, lifecycle })}
        />
        <PullRequestSelect
          label="State"
          value={filters.draft}
          values={draftStates}
          onChange={(draft) => onFilters({ ...filters, draft })}
        />
        <PullRequestSelect
          label="Author"
          value={filters.author}
          values={["all", ...authors]}
          onChange={(author) => onFilters({ ...filters, author })}
        />
        <PullRequestSelect
          label="Review"
          value={filters.review}
          values={reviewStates}
          onChange={(review) => onFilters({ ...filters, review })}
        />
        <PullRequestSelect
          label="Checks"
          value={filters.checks}
          values={checkStates}
          onChange={(checks) => onFilters({ ...filters, checks })}
        />
      </div>
    </section>
  );
}

function PullRequestSelect<T extends string>({
  label,
  value,
  values,
  labels = {},
  onChange,
}: {
  label: string;
  value: T;
  values: readonly T[];
  labels?: Record<string, string>;
  onChange: (value: T) => void;
}) {
  return (
    <label className={ui.label}>
      <span className={ui.labelText}>{label}</span>
      <select
        className={ui.input}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {values.map((candidate) => (
          <option value={candidate} key={candidate}>
            {labels[candidate] ?? pullRequestFilterLabel(candidate)}
          </option>
        ))}
      </select>
    </label>
  );
}

function PullRequestFailurePanel({
  failures,
}: {
  failures: PullRequestCollection["failures"];
}) {
  if (failures.length === 0) return null;
  return (
    <Panel title="Partial GitHub Reads" actions={<Badge tone="warning">{failures.length}</Badge>}>
      <div className={ui.list}>
        {failures.map((failure) => (
          <article className={ui.listRow} key={failure.projectId}>
            <div className={ui.listRowMain}>
              <strong className={ui.listTitle}>{pullRequestRepoName(failure.repo)}</strong>
              <span className={ui.muted}>{failure.message}</span>
            </div>
            <span className={ui.mono}>{failure.repo}</span>
          </article>
        ))}
      </div>
    </Panel>
  );
}

function PullRequestTable({ pullRequests }: { pullRequests: PullRequestSummary[] }) {
  if (pullRequests.length === 0) {
    return (
      <EmptyState art={assets.owl} title="No open pull requests">
        No tracked hosted projects currently match these pull request filters.
      </EmptyState>
    );
  }
  return (
    <DataTable headers={["Pull request", "Project", "State", "Review", "Checks", "Updated"]}>
      {pullRequests.map((pullRequest) => (
        <tr key={`${pullRequest.projectId}-${pullRequest.number}`}>
          <td>
            <div className="grid gap-1">
              <div className="flex items-start gap-2">
                {pullRequest.projectPinned ? (
                  <Star
                    size={14}
                    className="mt-0.5 shrink-0 fill-current text-[var(--primary)]"
                    aria-label="Starred project"
                  />
                ) : null}
                <a className={ui.link} href={pullRequest.url} target="_blank" rel="noreferrer">
                  #{pullRequest.number} {pullRequest.title}
                </a>
              </div>
              <span className={ui.mono}>
                {pullRequest.branch || "unknown"} {"->"} {pullRequest.baseBranch || "unknown"}
              </span>
            </div>
          </td>
          <td>
            <div className="grid gap-1">
              <strong>{pullRequest.repo}</strong>
              <a
                className={`${ui.link} ${ui.mono}`}
                href={pullRequestGitHubRepoUrl(pullRequest)}
                target="_blank"
                rel="noreferrer"
              >
                {pullRequest.owner}/{pullRequest.repo}
              </a>
            </div>
          </td>
          <td>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={pullRequest.isDraft ? "warning" : "primary"}>
                {pullRequest.isDraft ? "draft" : "open"}
              </Badge>
              <Badge>{pullRequest.projectState}</Badge>
            </div>
          </td>
          <td>
            <Badge tone={pullRequestReviewTone(pullRequest.reviewStatus)}>
              {pullRequestFilterLabel(pullRequest.reviewStatus)}
            </Badge>
          </td>
          <td>
            <Badge tone={pullRequestCheckTone(pullRequest.checkStatus)}>
              {pullRequestFilterLabel(pullRequest.checkStatus)}
            </Badge>
          </td>
          <td>
            <div className="grid gap-1">
              <span>{pullRequest.author}</span>
              <time className={ui.mono}>{formatPullRequestDate(pullRequest.updatedAt)}</time>
            </div>
          </td>
        </tr>
      ))}
    </DataTable>
  );
}

function pullRequestFilterLabel(value: string): string {
  if (value === "all") return "All";
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function pullRequestRepoName(repo: string): string {
  return repo.split("/").pop() || repo;
}

function pullRequestGitHubRepoUrl(pullRequest: PullRequestSummary): string {
  return `https://github.com/${pullRequest.owner}/${pullRequest.repo}`;
}

function pullRequestReviewTone(status: PullRequestReviewStatus): BadgeTone {
  if (status === "approved") return "success";
  if (status === "changes-requested") return "danger";
  if (status === "review-required") return "info";
  return "neutral";
}

function pullRequestCheckTone(status: PullRequestCheckStatus): BadgeTone {
  if (status === "passing") return "success";
  if (status === "failing") return "danger";
  if (status === "pending") return "warning";
  return "neutral";
}

function formatPullRequestDate(value: string): string {
  if (!value) return "unknown";
  return new Date(value).toLocaleString();
}
