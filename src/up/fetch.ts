import { CommandTimeoutError, runCommand } from "../utils/command";
import { formatDuration, truncateText } from "../utils/text";

const DETAIL_MAX_LENGTH = 160;
// Tailscale SSH in "check" mode holds the session open until someone approves this URL.
const TAILSCALE_CHECK_URL = /https:\/\/login\.tailscale\.com\/[A-Za-z0-9\-._~/?=&%]+/;

export type RemoteFetchFailure = {
  remote: string;
  /** One line for the user: which remote, what happened, and that it was skipped. */
  message: string;
};

/** What the checked-out HEAD tracks, which decides whether it can be fast-forwarded. */
export type HeadTracking =
  | { kind: "detached" }
  | { kind: "no-upstream" }
  | {
      kind: "tracking";
      /** The upstream's remote; `.` when the upstream is a local branch. */
      remote: string;
      /**
       * Set when the branch's merge ref has no remote-tracking branch (a single-branch clone, or
       * a ref outside `remote.<name>.fetch`). A plain fetch never updates it, so it has to be
       * fetched by name and merged from FETCH_HEAD, as `git pull` does.
       */
      unmappedRef?: string;
    };

/**
 * Fetches every remote that `git fetch --all` would, plus `trackingRemote` even when it is
 * marked skipFetchAll (the fast-forward needs a current ref from it), all at once. A remote that
 * hangs or fails is named, bounded by `idleTimeoutMs` and does not stop the others, and running
 * them side by side means N silent remotes cost one limit, not N. One `git fetch --all` has a
 * single timeout for every remote and cannot say which remote hung; killing it would also skip
 * the remotes after it. Results come back in remote order. Failures are returned, not thrown.
 *
 * The limit is inactivity, not total time: `git fetch --progress` keeps writing while it works,
 * so a large fetch that makes progress finishes, and a fetch that goes silent (an ssh session
 * waiting for a login approval) is stopped after `idleTimeoutMs`. A server that computes a very
 * large pack without sending anything for that long is also stopped; raise
 * `up.fetch_idle_timeout_seconds` for such a remote.
 */
export async function fetchRemotes(
  cwd: string,
  idleTimeoutMs: number,
  trackingRemote?: string,
): Promise<{ fetched: string[]; failures: RemoteFetchFailure[] }> {
  const remotes = await fetchableRemotes(cwd, trackingRemote);
  // Parallel fetches would overwrite each other's FETCH_HEAD, and nothing reads it here.
  const results = await Promise.all(
    remotes.map((remote) =>
      runFetch(
        cwd,
        ["--no-write-fetch-head", "--prune", "--", remote],
        { remote, subject: `fetch from remote '${remote}'` },
        idleTimeoutMs,
      ),
    ),
  );
  return {
    fetched: remotes.filter((_, index) => results[index] === undefined),
    failures: results.flatMap((failure) => (failure ? [failure] : [])),
  };
}

/** Fetches the branch's merge ref by name, which leaves its tip in FETCH_HEAD. */
export function fetchUpstreamRef(
  cwd: string,
  remote: string,
  ref: string,
  idleTimeoutMs: number,
): Promise<RemoteFetchFailure | undefined> {
  return runFetch(
    cwd,
    ["--", remote, ref],
    { remote, subject: `fetch of '${ref}' from remote '${remote}'` },
    idleTimeoutMs,
  );
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
  if (current === undefined) return { kind: "detached" };
  const [branch = "", upstream, remote] = current.slice(1).trim().split(/\s+/);
  if (upstream) return { kind: "tracking", remote: remote ?? "" };
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
  return listed.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((name) => name !== "" && (name === trackingRemote || !skip.has(name)));
}

async function runFetch(
  cwd: string,
  args: readonly string[],
  target: { remote: string; subject: string },
  idleTimeoutMs: number,
): Promise<RemoteFetchFailure | undefined> {
  const { remote, subject } = target;
  try {
    const result = await runCommand(["git", "fetch", "--progress", ...args], {
      cwd,
      allowFailure: true,
      timeoutMs: idleTimeoutMs,
      resetTimeoutOnOutput: true,
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

/** The approval URL of a Tailscale SSH check, when the command's output contains one. */
function approvalNote(output: string): string {
  const url = TAILSCALE_CHECK_URL.exec(output)?.[0];
  return url ? ` (Tailscale SSH check, approve the login at ${url})` : "";
}

/**
 * The line that says why a fetch failed. With `--progress` stderr is full of progress lines and
 * ssh may print notices first, so the last `fatal:` or `error:` line wins, then the last line.
 */
function failureDetail(stderr: string): string {
  const lines = stderr
    .split(/[\r\n]+/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter((line) => line !== "");
  const reason = lines.findLast((line) => /^(fatal|error):/i.test(line)) ?? lines.at(-1) ?? "";
  return truncateText(reason, DETAIL_MAX_LENGTH);
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .find((entry) => entry.trim() !== "")
      ?.trim() ?? ""
  );
}
