import { CommandTimeoutError, runCommand } from "../utils/command";

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
  | { kind: "tracking"; remote: string };

/**
 * Fetches every remote that `git fetch --all` would, one at a time, so a remote that hangs or
 * fails is named, bounded by `idleTimeoutMs` and does not stop the others. One `git fetch --all`
 * has a single timeout for every remote and cannot say which remote hung; killing it would also
 * skip the remotes after it. Failures are returned, not thrown.
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
): Promise<{ fetched: string[]; failures: RemoteFetchFailure[] }> {
  const fetched: string[] = [];
  const failures: RemoteFetchFailure[] = [];
  for (const remote of await fetchableRemotes(cwd)) {
    const failure = await fetchRemote(cwd, remote, idleTimeoutMs);
    if (failure) failures.push(failure);
    else fetched.push(remote);
  }
  return { fetched, failures };
}

/** The checked-out branch's upstream remote, or why there is none. */
export async function headTracking(cwd: string): Promise<HeadTracking> {
  const refs = await runCommand(
    ["git", "for-each-ref", "--format=%(HEAD) %(upstream) %(upstream:remotename)", "refs/heads"],
    { cwd },
  );
  const current = refs.stdout.split("\n").find((line) => line.startsWith("*"));
  if (current === undefined) return { kind: "detached" };
  const [upstream, remote] = current.slice(1).trim().split(/\s+/);
  return upstream ? { kind: "tracking", remote: remote ?? "" } : { kind: "no-upstream" };
}

function describeDuration(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`;
}

/** The approval URL of a Tailscale SSH check, when the command's output contains one. */
function tailscaleCheckUrl(output: string): string | undefined {
  return TAILSCALE_CHECK_URL.exec(output)?.[0];
}

async function fetchableRemotes(cwd: string): Promise<string[]> {
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
    .filter((name) => name !== "" && !skip.has(name));
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
        `${subject} timed out after ${describeDuration(idleTimeoutMs)} without output; skipped` +
        approvalNote(`${error.stderr}\n${error.stdout}`),
    };
  }
}

function approvalNote(output: string): string {
  const url = tailscaleCheckUrl(output);
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
  return reason.length > DETAIL_MAX_LENGTH ? `${reason.slice(0, DETAIL_MAX_LENGTH - 1)}…` : reason;
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .find((entry) => entry.trim() !== "")
      ?.trim() ?? ""
  );
}
