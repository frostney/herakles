import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { PluginContext } from "../../plugin-host/api";
import {
  isObjectId,
  type MergedPullRequest,
  parseMergedPullRequests,
  parseUpstream,
  parseWorktreeList,
  type WorktreeEntry,
} from "./parse";

export type Tools = Pick<PluginContext, "git" | "gh">;

/**
 * The project type the context hands out. Derived from the context because
 * Fallow follows a type re-exported by the API into core and flags the import.
 */
export type Project = Parameters<Tools["git"]["run"]>[0];

export type SkipCode =
  | "t3-managed"
  | "locked"
  | "detached"
  | "missing"
  | "default-branch"
  | "dirty"
  | "no-upstream"
  | "unpushed"
  | "no-github"
  | "no-merged-pr"
  | "head-moved"
  | "unverified";

export type Skipped = { prunable: false; code: SkipCode; reason: string };

export type Assessment = { prunable: true; pullRequest: number } | Skipped;

/** A linked worktree of a tracked project, with the verdict on pruning it. */
export type Candidate = {
  project: Project;
  path: string;
  branch?: string;
  /** The commit the worktree was at when scanned; the plan prunes only this tip. */
  tip: string;
  assessment: Assessment;
};

const skip = (code: SkipCode, reason: string): Skipped => ({ prunable: false, code, reason });

/** Scan every tracked project's canonical checkout for linked worktrees. */
export async function scanProjects(
  tools: Tools,
  projects: readonly Project[],
  warn: (text: string) => void,
): Promise<Candidate[]> {
  // HOME first: `homedir()` can keep the value it saw at startup.
  const home = process.env.HOME || homedir();
  const t3Root = await resolveReal(join(home, ".t3", "worktrees"));
  // Keyed by worktree path, so a checkout tracked twice is scanned once.
  const candidates = new Map<string, Candidate>();
  for (const project of projects) {
    // A hosted project that is not cloned yet has no worktrees.
    if (!existsSync(project.path)) continue;
    try {
      for (const candidate of await scanProject(tools, project, t3Root)) {
        if (!candidates.has(candidate.path)) candidates.set(candidate.path, candidate);
      }
    } catch (error) {
      warn(`${project.slug}: could not read worktrees: ${(error as Error).message}`);
    }
  }
  return [...candidates.values()];
}

async function scanProject(tools: Tools, project: Project, t3Root: string): Promise<Candidate[]> {
  const listing = await tools.git.run(project, ["worktree", "list", "--porcelain"]);
  // The first entry is the main worktree, which is never a candidate.
  const linked = parseWorktreeList(listing.stdout).slice(1);
  const defaultBranch = linked.length === 0 ? undefined : await defaultBranchOf(tools, project);
  const candidates: Candidate[] = [];
  for (const entry of linked) {
    const assessment = await assess(tools, project, entry, { t3Root, defaultBranch });
    candidates.push({
      project,
      path: entry.path,
      ...(entry.branch === undefined ? {} : { branch: entry.branch }),
      tip: entry.head,
      assessment,
    });
  }
  return candidates;
}

async function assess(
  tools: Tools,
  project: Project,
  entry: WorktreeEntry,
  facts: ProjectFacts,
): Promise<Assessment> {
  const excluded = await exclusion(entry, facts);
  if (excluded) return excluded;
  const branch = entry.branch!;
  const checks: Array<() => Promise<Assessment | undefined>> = [
    () => cleanSkip(entry.path),
    () => pushedSkip(tools, project, branch),
  ];
  for (const check of checks) {
    const skipped = await check();
    if (skipped) return skipped;
  }
  return mergedPullRequest(tools, project, branch, entry.head, facts.defaultBranch);
}

/** Facts about a project that every one of its worktrees shares. */
type ProjectFacts = { t3Root: string; defaultBranch: string | undefined };

async function exclusion(
  entry: WorktreeEntry,
  facts: ProjectFacts,
): Promise<Assessment | undefined> {
  if (isInside(facts.t3Root, await resolveReal(entry.path))) {
    return skip("t3-managed", "T3-managed worktree");
  }
  if (entry.locked !== undefined) {
    return skip("locked", entry.locked === "" ? "locked" : `locked: ${entry.locked}`);
  }
  if (entry.bare || entry.detached || entry.branch === undefined) {
    return skip("detached", "detached HEAD with no branch");
  }
  if (entry.prunable !== undefined || !existsSync(entry.path)) {
    return skip("missing", "worktree directory is missing; `git worktree prune` clears it");
  }
  if (entry.branch === facts.defaultBranch) {
    return skip("default-branch", `default branch ${entry.branch}`);
  }
  return undefined;
}

/** Skip unless `git status --porcelain` is empty, untracked files included. */
export async function cleanSkip(path: string): Promise<Skipped | undefined> {
  const status = await gitIn(path, ["status", "--porcelain"]);
  if (status.exitCode !== 0) {
    return skip("unverified", `could not read status: ${status.stderr.trim()}`);
  }
  return status.stdout.trim() === "" ? undefined : skip("dirty", "uncommitted or untracked files");
}

async function pushedSkip(
  tools: Tools,
  project: Project,
  branch: string,
): Promise<Assessment | undefined> {
  const result = await tools.git.run(
    project,
    [
      "for-each-ref",
      "--format=%(refname)%09%(upstream)%09%(upstream:track)",
      `refs/heads/${branch}`,
    ],
    { allowFailure: true },
  );
  const upstream = result.exitCode === 0 ? parseUpstream(result.stdout, branch) : undefined;
  if (!upstream) return skip("unverified", "could not read the branch upstream");
  if (!upstream.configured) return skip("no-upstream", "unpushed: branch has no upstream");
  // A gone upstream, as after GitHub deletes a merged branch, is covered by the
  // merged pull request check: the tip must be contained in that pull request.
  if (!upstream.gone && upstream.ahead > 0) {
    return skip("unpushed", `unpushed: ${upstream.ahead} commit(s) ahead of upstream`);
  }
  return undefined;
}

async function mergedPullRequest(
  tools: Tools,
  project: Project,
  branch: string,
  tip: string,
  defaultBranch: string | undefined,
): Promise<Assessment> {
  if (project.owner === undefined) {
    return skip("no-github", "no merged PR: project has no GitHub repository");
  }
  const result = await tools.gh.run(
    [
      "pr",
      "list",
      "--repo",
      `${project.owner}/${project.repo}`,
      "--head",
      branch,
      "--state",
      "merged",
      "--json",
      "number,headRefOid,baseRefName,isCrossRepository",
      "--limit",
      "100",
    ],
    { allowFailure: true },
  );
  const pullRequests = result.exitCode === 0 ? parseMergedPullRequests(result.stdout) : undefined;
  if (!pullRequests) {
    return skip("unverified", `could not list merged PRs: ${result.stderr.trim() || "bad output"}`);
  }
  // `--head` matches the branch name only, so a merged fork PR with the same name must not count.
  const own = pullRequests.filter((pullRequest) => !pullRequest.crossRepository);
  if (own.length === 0) {
    const reason =
      pullRequests.length === 0
        ? "no merged PR for this branch"
        : "no merged PR for this branch (only merged fork PRs share its name)";
    return skip("no-merged-pr", reason);
  }
  if (defaultBranch === undefined) {
    return skip("unverified", "cannot tell the default branch, so cannot tell where the PR merged");
  }
  // A PR merged into another branch, as in a stack, has not reached the default branch.
  const reached = own.filter((pullRequest) => pullRequest.baseRefName === defaultBranch);
  if (reached.length === 0) {
    const bases = [...new Set(own.map((pullRequest) => pullRequest.baseRefName))].join(", ");
    return skip(
      "no-merged-pr",
      `merged PR targeted ${bases}, not the default branch ${defaultBranch}`,
    );
  }
  return containingPullRequest(tools, project, reached, tip);
}

/** The default branch from hosted facts, else from the clone's `origin/HEAD`. */
async function defaultBranchOf(tools: Tools, project: Project): Promise<string | undefined> {
  if (project.defaultBranchRef !== undefined) {
    return project.defaultBranchRef.replace(/^refs\/heads\//, "");
  }
  const head = await tools.git.run(
    project,
    ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    {
      allowFailure: true,
    },
  );
  const name = head.stdout.trim().replace(/^origin\//, "");
  return head.exitCode === 0 && name !== "" ? name : undefined;
}

/** The merged PR whose head is the tip, or that contains the tip; squash merges count. */
async function containingPullRequest(
  tools: Tools,
  project: Project,
  pullRequests: readonly MergedPullRequest[],
  tip: string,
): Promise<Assessment> {
  let unknownHead = false;
  for (const pullRequest of pullRequests) {
    if (pullRequest.headRefOid === tip) return { prunable: true, pullRequest: pullRequest.number };
    if (!isObjectId(pullRequest.headRefOid)) continue;
    const result = await tools.git.run(
      project,
      ["merge-base", "--is-ancestor", tip, pullRequest.headRefOid],
      { allowFailure: true },
    );
    if (result.exitCode === 0) return { prunable: true, pullRequest: pullRequest.number };
    if (result.exitCode !== 1) unknownHead = true;
  }
  if (unknownHead) {
    return skip("unverified", "merged PR head is not available locally; fetch and retry");
  }
  const numbers = pullRequests.map((pullRequest) => `#${pullRequest.number}`).join(", ");
  return skip("head-moved", `head moved past merged PR ${numbers}`);
}

/** Resolve symlinks; a path that does not exist is kept lexically. */
async function resolveReal(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
}

/**
 * Run git inside a linked worktree. `context.git.run` works only in a
 * project's canonical checkout, and status needs the worktree's own files.
 */
export async function gitIn(cwd: string, args: readonly string[]) {
  // Ambient repository selection would make git ignore `cwd`.
  const { GIT_DIR: _dir, GIT_WORK_TREE: _tree, GIT_INDEX_FILE: _index, ...inherited } = Bun.env;
  const child = Bun.spawn(["git", ...args], {
    cwd,
    env: { ...inherited, GIT_OPTIONAL_LOCKS: "0" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}
