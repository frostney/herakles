import type { OperationPlan, PluginContext } from "../../plugin-host/api";

type Project = Awaited<ReturnType<PluginContext["projects"]["get"]>>;
type RemoteFetchResult = Awaited<ReturnType<PluginContext["git"]["fetchRemotes"]>>;

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
  | { kind: "no-remote-branch" }
  | { kind: "failed"; message: string };

type Fetched = {
  fastForward: FastForward;
  /** One message per other remote that did not answer or failed; origin's fails the sync. */
  problems: readonly string[];
};

/** The remote the default branch is fast-forwarded from. */
const REMOTE = "origin";

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
  const { problems } = first.result;
  if (first.result.fastForward.kind !== "overwritten") {
    return withBehind(...withProblems(describe(first.result.fastForward), problems));
  }

  const blocked = await stashBlock(context, project, branch, options);
  if (blocked !== undefined) return withBehind(...withProblems(["blocked", blocked], problems));

  const second = await context.applyPlan(stashPlan(context, project, branch), {
    yes: options.stash,
  });
  if (!second.applied) {
    return withBehind(
      ...withProblems(["blocked", "local changes would be overwritten; stash declined"], problems),
    );
  }
  if (second.result.kind === "failed") {
    return withBehind(...withProblems(["failed", second.result.message], problems));
  }
  const { stash, fastForward } = second.result;
  const [status, message] = describe(fastForward);
  return withBehind(
    ...withProblems(
      [status, `${message}; local changes stashed as ${stash.ref} and not restored`],
      problems,
    ),
    stash,
  );
}

function describe(fastForward: FastForward): [DefaultBranchSyncResult["status"], string] {
  switch (fastForward.kind) {
    case "done":
      return ["done", "default branch fast-forwarded"];
    case "not-fast-forwardable":
      return ["skipped", "default branch is not fast-forwardable"];
    case "no-remote-branch":
      return ["skipped", `default branch is not on remote '${REMOTE}'; not fast-forwarded`];
    case "overwritten":
      return ["blocked", "local changes would still be overwritten after stashing"];
    case "failed":
      return ["failed", fastForward.message];
  }
}

/**
 * Adds the messages of remotes that did not answer. As in `herakles up`, a result with such a
 * remote is skipped, never done.
 */
function withProblems(
  [status, message]: [DefaultBranchSyncResult["status"], string],
  problems: readonly string[],
): [DefaultBranchSyncResult["status"], string] {
  if (problems.length === 0) return [status, message];
  return [status === "done" ? "skipped" : status, [message, ...problems].join("; ")];
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
): OperationPlan<Fetched> {
  return {
    summary: `Fetch and fast-forward ${branch} of ${project.id}?`,
    steps: [
      {
        action: "fetch",
        target: project.id,
        detail: `git fetch --prune <remote>, one remote at a time, ${REMOTE} last`,
      },
      { action: "fast-forward", target: branch, detail: fastForwardCommand(branch, onBranch) },
    ],
    apply: async () => {
      // Bounded like `herakles up`: a remote that holds the session open without a word (an ssh
      // login waiting for approval) is stopped and named instead of hanging the sync.
      let fetchedRemotes: RemoteFetchResult;
      try {
        fetchedRemotes = await context.git.fetchRemotes(project, { trackingRemote: REMOTE });
      } catch (error) {
        // git could not list the remotes or read their settings; `git fetch --all` fails there too.
        const message = error instanceof Error ? error.message : String(error);
        return { fastForward: { kind: "failed", message }, problems: [] };
      }
      const { fetched, failures } = fetchedRemotes;
      const own = failures.find((failure) => failure.remote === REMOTE);
      const problems = failures
        .filter((failure) => failure !== own)
        .map((failure) => failure.message);
      if (!fetched.includes(REMOTE)) {
        // The fast-forward below needs a current ref from origin.
        const message = own?.message ?? `the checkout has no remote '${REMOTE}'`;
        return { fastForward: { kind: "failed", message }, problems };
      }
      return { fastForward: await fastForward(context, project, branch, onBranch), problems };
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
      { action: "fast-forward", target: branch, detail: fastForwardCommand(branch, true) },
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

/**
 * Fast-forwards the branch to the fetched origin ref without the network, so nothing here can
 * hang on a remote. On the checked-out branch that is a merge, which refuses to overwrite local
 * changes. Otherwise it is a fetch from the repository itself, which refuses anything but a
 * fast-forward and a branch checked out in another worktree, as fetching from origin did.
 */
async function fastForward(
  context: PluginContext,
  project: Project,
  branch: string,
  onBranch: boolean,
): Promise<FastForward> {
  const exists = await tryGit(context, project, [
    "rev-parse",
    "--verify",
    "--quiet",
    `${remoteBranch(branch)}^{commit}`,
  ]);
  if (exists.stdout === undefined) return { kind: "no-remote-branch" };
  const merged = await context.git.run(project, fastForwardArgs(branch, onBranch), {
    allowFailure: true,
  });
  if (merged.exitCode === 0) return { kind: "done" };
  if (overwriteRefusal.test(`${merged.stderr}\n${merged.stdout}`)) return { kind: "overwritten" };
  return { kind: "not-fast-forwardable" };
}

function fastForwardArgs(branch: string, onBranch: boolean): string[] {
  if (onBranch) return ["merge", "--ff-only", remoteBranch(branch)];
  // Without the flag, submodule.recurse would fetch submodules from their remotes, unbounded.
  return ["fetch", "--no-recurse-submodules", ".", `${remoteBranch(branch)}:refs/heads/${branch}`];
}

function fastForwardCommand(branch: string, onBranch: boolean): string {
  return `git ${fastForwardArgs(branch, onBranch).join(" ")}`;
}

function remoteBranch(branch: string): string {
  return `refs/remotes/${REMOTE}/${branch}`;
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
    remoteBranch(branch),
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
