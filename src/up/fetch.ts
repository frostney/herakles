import { CommandTimeoutError, runCommand } from "../utils/command";
import { formatDuration } from "../utils/text";
import { approvalNote, failureDetail } from "./output";

export type RemoteFetchFailure = {
  remote: string;
  /** One line for the user: which remote, what happened, and that it was skipped. */
  message: string;
};

/** What the checked-out HEAD tracks, which decides whether it can be fast-forwarded. */
export type HeadTracking =
  | { kind: "detached" }
  /** On a branch that has no commits yet. */
  | { kind: "unborn" }
  | { kind: "no-upstream" }
  | {
      kind: "tracking";
      /** The upstream's remote; `.` when the upstream is a local branch. */
      remote: string;
      /** The remote-tracking (or local) ref `@{upstream}` names, when the branch has one. */
      upstreamRef?: string;
      /**
       * Set when the branch's merge ref has no remote-tracking branch (a single-branch clone, or
       * a ref outside `remote.<name>.fetch`). A plain `git fetch <remote>` fetches that ref
       * anyway, because it is the current branch's merge ref, and leaves it in FETCH_HEAD, which
       * is then what `git pull` merges.
       */
      unmappedRef?: string;
    };

/**
 * Fetches every remote that `git fetch --all` would, one after another like it does, plus
 * `trackingRemote` even when it is marked skipFetchAll (the fast-forward needs a current ref from
 * it). The tracking remote goes last, so FETCH_HEAD, which holds a merge ref that no
 * remote-tracking branch follows, comes from its fetch. A remote that hangs or fails is named,
 * bounded by `idleTimeoutMs` and does not stop the others. One `git fetch --all` has a single
 * timeout for every remote and cannot say which remote hung; killing it would also skip the
 * remotes after it. Failures are returned, not thrown.
 *
 * The limit is inactivity, not total time: `git fetch --progress` keeps writing while it works,
 * so a large fetch that makes progress finishes, and a fetch that goes silent (an ssh session
 * waiting for a login approval) is stopped after `idleTimeoutMs`. A server that computes a very
 * large pack without sending anything for that long is also stopped, and so is an ssh fetch that
 * waits for a person at a passphrase prompt (prompts use the terminal, not the pipes); give such
 * a remote an agent, or raise `up.fetch_idle_timeout_seconds`. HTTPS credential prompts are
 * switched off (`GIT_TERMINAL_PROMPT=0`), so those fail at once.
 */
export async function fetchRemotes(
  cwd: string,
  idleTimeoutMs: number,
  trackingRemote?: string,
): Promise<{ fetched: string[]; failures: RemoteFetchFailure[] }> {
  const fetched: string[] = [];
  const failures: RemoteFetchFailure[] = [];
  for (const remote of await fetchableRemotes(cwd, trackingRemote)) {
    const failure = await fetchRemote(cwd, remote, idleTimeoutMs);
    if (failure) failures.push(failure);
    else fetched.push(remote);
  }
  return { fetched, failures };
}

/** The checked-out branch's upstream, or why there is none. */
export async function headTracking(cwd: string): Promise<HeadTracking> {
  const refs = await runCommand(
    [
      "git",
      "for-each-ref",
      "--format=%(HEAD) %(refname:lstrip=2) %(upstream) %(upstream:remotename)",
      "refs/heads",
    ],
    { cwd },
  );
  const current = refs.stdout.split("\n").find((line) => line.startsWith("*"));
  if (current === undefined) {
    // A branch with no commits has no ref yet, so for-each-ref lists nothing for it either.
    const symbolic = await runCommand(["git", "symbolic-ref", "--quiet", "HEAD"], {
      cwd,
      allowFailure: true,
    });
    return { kind: symbolic.exitCode === 0 ? "unborn" : "detached" };
  }
  const [branch = "", upstream, remote] = current.slice(1).trim().split(/\s+/);
  if (upstream) return { kind: "tracking", remote: remote ?? "", upstreamRef: upstream };
  // No remote-tracking branch for the merge ref. git still knows what the branch tracks.
  const configuredRemote = await configValue(cwd, `branch.${branch}.remote`);
  const unmappedRef = await configValue(cwd, `branch.${branch}.merge`);
  if (configuredRemote && configuredRemote !== "." && unmappedRef) {
    return { kind: "tracking", remote: configuredRemote, unmappedRef };
  }
  return { kind: "no-upstream" };
}

/** The commit HEAD points at. */
export async function headCommit(cwd: string): Promise<string> {
  return (await runCommand(["git", "rev-parse", "HEAD"], { cwd })).stdout.trim();
}

/** Whether `ref` names a commit, for example after a fetch pruned it. */
export async function refExists(cwd: string, ref: string): Promise<boolean> {
  const result = await runCommand(["git", "rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
    cwd,
    allowFailure: true,
  });
  return result.exitCode === 0;
}

async function configValue(cwd: string, key: string): Promise<string | undefined> {
  const result = await runCommand(["git", "config", "--get", key], { cwd, allowFailure: true });
  return result.exitCode === 0 ? result.stdout.trim() || undefined : undefined;
}

async function fetchableRemotes(cwd: string, trackingRemote?: string): Promise<string[]> {
  const listed = await runCommand(["git", "remote"], { cwd });
  // `git fetch --all` leaves out remotes with remote.<name>.skipFetchAll set. Git's own boolean
  // parser decides what counts as set (true, yes, on, 1, any non-zero number, a bare key), and
  // `--type=bool` prints the normalized value. Exit 1 means no such key; any other failure (a
  // malformed value, say) is one `git fetch --all` would hit too, so it is not hidden.
  const flagged = await runCommand(
    ["git", "config", "--type=bool", "--get-regexp", "^remote\\..*\\.skipfetchall$"],
    { cwd, allowFailure: true },
  );
  if (flagged.exitCode > 1) {
    throw new Error(`could not read remote skipFetchAll settings: ${firstLine(flagged.stderr)}`);
  }
  const skip = new Set(
    flagged.stdout
      .split("\n")
      .map((line) => /^remote\.(.+)\.skipfetchall true$/i.exec(line.trim()))
      .flatMap((match) => (match?.[1] === undefined ? [] : [match[1]])),
  );
  const names = listed.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((name) => name !== "" && (name === trackingRemote || !skip.has(name)));
  return names.includes(trackingRemote ?? "")
    ? [...names.filter((name) => name !== trackingRemote), trackingRemote as string]
    : names;
}

async function fetchRemote(
  cwd: string,
  remote: string,
  idleTimeoutMs: number,
): Promise<RemoteFetchFailure | undefined> {
  const subject = `fetch from remote '${remote}'`;
  try {
    const result = await runCommand(["git", "fetch", "--progress", "--prune", "--", remote], {
      cwd,
      allowFailure: true,
      timeoutMs: idleTimeoutMs,
      resetTimeoutOnOutput: true,
      releasePipesAfterExit: true,
      // An HTTPS remote without a credential helper fails at once with git's own error instead
      // of waiting on the terminal until the idle limit. ssh is left alone: its configuration
      // (core.sshCommand, an agent) is the user's.
      env: { GIT_TERMINAL_PROMPT: "0" },
    });
    if (result.exitCode === 0) return undefined;
    const detail = failureDetail(result.stderr);
    return {
      remote,
      message:
        `${subject} failed with ${result.exitCode}${detail ? `: ${detail}` : ""}; skipped` +
        approvalNote(`${result.stderr}\n${result.stdout}`),
    };
  } catch (error) {
    if (!(error instanceof CommandTimeoutError)) throw error;
    return {
      remote,
      message:
        `${subject} timed out after ${formatDuration(idleTimeoutMs)} without output; skipped` +
        approvalNote(`${error.stderr}\n${error.stdout}`),
    };
  }
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .find((entry) => entry.trim() !== "")
      ?.trim() ?? ""
  );
}
