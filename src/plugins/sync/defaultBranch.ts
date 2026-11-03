import type { OperationPlan, PluginContext } from "../../plugin-host/api";

type Project = Awaited<ReturnType<PluginContext["projects"]["get"]>>;

export type SyncStash = {
  /** Position-based stash ref right after stashing, for example `stash@{0}`. */
  ref: string;
  /** The stash commit, which stays valid after later stashes shift the ref. */
  commit: string;
  message: string;
  /** Commands that bring the changes back; Herakles never runs them. */
  restore: string[];
};

export type DefaultBranchSyncResult = {
  projectId: string;
  branch: string;
  status: "done" | "skipped" | "blocked" | "failed";
  message: string;
  behindBefore?: number;
  behindAfter?: number;
  stash?: SyncStash;
};

export type SyncOptions = {
  /** Skip the confirmation of the fetch and fast-forward plan. */
  yes: boolean;
  /** Consent to stash local changes that block the fast-forward. */
  stash: boolean;
  /** Whether a person can answer a stash question. False for `--json` and closed stdin. */
  interactive: boolean;
};

type FastForward =
  | { kind: "done" }
  | { kind: "overwritten" }
  | { kind: "not-fast-forwardable" }
  | { kind: "failed"; message: string };

type Stashed =
  | { kind: "stashed"; stash: SyncStash; fastForward: FastForward }
  | { kind: "failed"; message: string };

/**
 * Herakles' stash marker for a branch. It follows GitHub Desktop's
 * `!!GitHub_Desktop<branch>` convention, so a stash is recognisable as ours.
 */
function stashMarker(branch: string): string {
  return `!!Herakles<${branch}>`;
}

/** Git's refusal when a fast-forward would overwrite tracked or untracked local files. */
const overwriteRefusal =
  /(?:Your local changes to the following|The following untracked working tree) files would be overwritten by (?:merge|checkout)/;

/**
 * Fetch and fast-forward a hosted project's local default branch the way
 * GitHub Desktop pulls: local changes alone never block it. Only when git
 * refuses because the changes would be overwritten does it offer to stash
 * them and retry, and it never pops the stash again.
 */
export async function syncDefaultBranch(
  context: PluginContext,
  project: Project,
  options: SyncOptions,
): Promise<DefaultBranchSyncResult> {
  const branch = project.defaultBranchRef;
  if (!branch) {
    return result(project, "", "skipped", "default branch is unknown");
  }
  const current = await tryGit(context, project, ["branch", "--show-current"]);
  if (current.error !== undefined) return result(project, branch, "failed", current.error);
  if (current.stdout === undefined) {
    return result(project, branch, "failed", "not a readable git repository");
  }

  const behindBefore = await readBehind(context, project, branch);
  const withBehind = async (
    status: DefaultBranchSyncResult["status"],
    message: string,
    stash?: SyncStash,
  ): Promise<DefaultBranchSyncResult> => ({
    ...result(project, branch, status, message),
    ...(behindBefore === undefined ? {} : { behindBefore }),
    ...optional("behindAfter", await readBehind(context, project, branch)),
    ...(stash === undefined ? {} : { stash }),
  });

  const onBranch = current.stdout === branch;
  const first = await context.applyPlan(fetchPlan(context, project, branch, onBranch), {
    yes: options.yes,
  });
  if (!first.applied) return withBehind("skipped", "declined; nothing was changed");
  if (first.result.kind !== "overwritten") return withBehind(...describe(first.result));

  const blocked = await stashBlock(context, project, branch, options);
  if (blocked !== undefined) return withBehind("blocked", blocked);

  const second = await context.applyPlan(stashPlan(context, project, branch), {
    yes: options.stash,
  });
  if (!second.applied) {
    return withBehind("blocked", "local changes would be overwritten; stash declined");
  }
  if (second.result.kind === "failed") return withBehind("failed", second.result.message);
  const { stash, fastForward } = second.result;
  const [status, message] = describe(fastForward);
  return withBehind(
    status,
    `${message}; local changes stashed as ${stash.ref} and not restored`,
    stash,
  );
}

function describe(fastForward: FastForward): [DefaultBranchSyncResult["status"], string] {
  switch (fastForward.kind) {
    case "done":
      return ["done", "default branch fast-forwarded"];
    case "not-fast-forwardable":
      return ["skipped", "default branch is not fast-forwardable"];
    case "overwritten":
      return ["blocked", "local changes would still be overwritten after stashing"];
    case "failed":
      return ["failed", fastForward.message];
  }
}

/** Why a stash must not happen, or undefined when it may be offered. */
async function stashBlock(
  context: PluginContext,
  project: Project,
  branch: string,
  options: SyncOptions,
): Promise<string | undefined> {
  const existing = await findStash(context, project, branch);
  if (existing !== undefined) {
    return `local changes would be overwritten, and a Herakles stash for ${branch} already exists (${existing}); restore or drop it first`;
  }
  if (options.stash || options.interactive) return undefined;
  return "local changes would be overwritten; rerun with --stash to stash them and continue";
}

function fetchPlan(
  context: PluginContext,
  project: Project,
  branch: string,
  onBranch: boolean,
): OperationPlan<FastForward> {
  return {
    summary: `Fetch and fast-forward ${branch} of ${project.id}?`,
    steps: [
      { action: "fetch", target: project.id, detail: "git fetch --all --prune" },
      {
        action: "fast-forward",
        target: branch,
        detail: onBranch ? `git pull --ff-only origin ${branch}` : fetchIntoBranch(branch),
      },
    ],
    apply: async () => {
      const fetched = await context.git.run(project, ["fetch", "--all", "--prune"], {
        allowFailure: true,
      });
      if (fetched.exitCode !== 0) {
        return { kind: "failed", message: fetched.stderr.trim() || "failed to fetch remote refs" };
      }
      return fastForward(context, project, branch, onBranch);
    },
  };
}

function stashPlan(
  context: PluginContext,
  project: Project,
  branch: string,
): OperationPlan<Stashed> {
  const message = stashMarker(branch);
  return {
    summary: `Stash local changes on ${branch} of ${project.id} and continue?`,
    steps: [
      {
        action: "stash",
        target: project.id,
        detail: `git stash push --include-untracked -m '${message}'`,
      },
      { action: "fast-forward", target: branch, detail: `git pull --ff-only origin ${branch}` },
    ],
    apply: async () => {
      const before = await stashTip(context, project);
      const pushed = await context.git.run(
        project,
        ["stash", "push", "--include-untracked", "-m", message],
        { allowFailure: true },
      );
      if (pushed.exitCode !== 0) {
        return { kind: "failed", message: pushed.stderr.trim() || "git stash failed" };
      }
      const commit = await stashTip(context, project);
      if (commit === undefined || commit === before) {
        return { kind: "failed", message: "git stash saved nothing; local changes are untouched" };
      }
      const stash: SyncStash = {
        ref: "stash@{0}",
        commit,
        message,
        restore: ["git stash pop", `git stash apply ${commit}`],
      };
      return {
        kind: "stashed",
        stash,
        fastForward: await fastForward(context, project, branch, true),
      };
    },
  };
}

async function fastForward(
  context: PluginContext,
  project: Project,
  branch: string,
  onBranch: boolean,
): Promise<FastForward> {
  const args = onBranch
    ? ["pull", "--ff-only", "origin", branch]
    : ["fetch", "origin", `${branch}:refs/heads/${branch}`];
  const pulled = await context.git.run(project, args, { allowFailure: true });
  if (pulled.exitCode === 0) return { kind: "done" };
  if (overwriteRefusal.test(`${pulled.stderr}\n${pulled.stdout}`)) return { kind: "overwritten" };
  return { kind: "not-fast-forwardable" };
}

function fetchIntoBranch(branch: string): string {
  return `git fetch origin ${branch}:refs/heads/${branch}`;
}

/** The ref of an existing Herakles stash for the branch, such as `stash@{1}`. */
async function findStash(
  context: PluginContext,
  project: Project,
  branch: string,
): Promise<string | undefined> {
  const listed = await tryGit(context, project, ["stash", "list", "--format=%gd%x09%gs"]);
  const suffix = `: ${stashMarker(branch)}`;
  for (const line of (listed.stdout ?? "").split("\n")) {
    const [ref, subject] = line.split("\t");
    if (ref && subject?.endsWith(suffix)) return ref;
  }
  return undefined;
}

async function stashTip(context: PluginContext, project: Project): Promise<string | undefined> {
  const tip = await tryGit(context, project, ["rev-parse", "--verify", "--quiet", "refs/stash"]);
  return tip.stdout || undefined;
}

async function readBehind(
  context: PluginContext,
  project: Project,
  branch: string,
): Promise<number | undefined> {
  const counted = await tryGit(context, project, [
    "rev-list",
    "--count",
    `refs/remotes/origin/${branch}`,
    "--not",
    `refs/heads/${branch}`,
  ]);
  if (counted.stdout === undefined) return undefined;
  const count = Number(counted.stdout);
  return Number.isFinite(count) ? count : undefined;
}

type GitAttempt = {
  /** Trimmed stdout, or undefined when git exited non-zero or could not run. */
  stdout?: string;
  /** Set when git could not run at all, for example a missing checkout. */
  error?: string;
};

/** Run a read-only git command without throwing. */
async function tryGit(
  context: PluginContext,
  project: Project,
  args: string[],
): Promise<GitAttempt> {
  try {
    const run = await context.git.run(project, args, { allowFailure: true });
    return run.exitCode === 0 ? { stdout: run.stdout.trim() } : {};
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function result(
  project: Project,
  branch: string,
  status: DefaultBranchSyncResult["status"],
  message: string,
): DefaultBranchSyncResult {
  return { projectId: project.id, branch, status, message };
}

function optional<KEY extends string>(key: KEY, value: number | undefined) {
  return value === undefined ? {} : { [key]: value };
}
