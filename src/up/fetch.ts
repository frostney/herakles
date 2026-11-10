import { CommandTimeoutError, runCommand } from "../utils/command";

/** Longest `herakles up` waits on one remote when the config does not say otherwise. */
export const DEFAULT_FETCH_TIMEOUT_MS = 60_000;

const DETAIL_MAX_LENGTH = 160;
// Tailscale SSH in "check" mode holds the session open until someone approves this URL.
const TAILSCALE_CHECK_URL = /https:\/\/login\.tailscale\.com\/[A-Za-z0-9\-._~/?=&%]+/;

export type RemoteFetchFailure = {
  remote: string;
  /** One line for the user: which remote, what happened, and that it was skipped. */
  message: string;
};

/**
 * Fetches every remote that `git fetch --all` would, one at a time, so a remote that hangs or
 * fails is named, bounded by `timeoutMs` and does not stop the others. One `git fetch --all`
 * has a single timeout for every remote and cannot say which remote hung; killing it would also
 * skip the remotes after it. Failures are returned, not thrown.
 */
export async function fetchRemotes(
  cwd: string,
  timeoutMs: number,
): Promise<{ failures: RemoteFetchFailure[] }> {
  const failures: RemoteFetchFailure[] = [];
  for (const remote of await fetchableRemotes(cwd)) {
    const failure = await fetchRemote(cwd, remote, timeoutMs);
    if (failure) failures.push(failure);
  }
  return { failures };
}

/** The remote the checked-out branch tracks, which `git pull` fetches again; undefined if none. */
export async function upstreamRemote(cwd: string): Promise<string | undefined> {
  const refs = await runCommand(
    ["git", "for-each-ref", "--format=%(HEAD) %(upstream:remotename)", "refs/heads"],
    { cwd, allowFailure: true },
  );
  if (refs.exitCode !== 0) return undefined;
  const current = refs.stdout.split("\n").find((line) => line.startsWith("*"));
  return current?.slice(1).trim() || undefined;
}

export function describeTimeout(timeoutMs: number): string {
  return timeoutMs % 1000 === 0 ? `${timeoutMs / 1000}s` : `${timeoutMs}ms`;
}

/** The approval URL of a Tailscale SSH check, when the command's output contains one. */
function tailscaleCheckUrl(output: string): string | undefined {
  return TAILSCALE_CHECK_URL.exec(output)?.[0];
}

async function fetchableRemotes(cwd: string): Promise<string[]> {
  const listed = await runCommand(["git", "remote"], { cwd });
  const skipped = await runCommand(
    ["git", "config", "--get-regexp", "^remote\\..*\\.skipfetchall$"],
    { cwd, allowFailure: true },
  );
  // `git fetch --all` leaves out remotes with remote.<name>.skipFetchAll set. Values are read
  // raw, so one malformed value cannot hide the others; a key without a value means true.
  const skip = new Set(
    skipped.stdout
      .split("\n")
      .map((line) => /^remote\.(.+)\.skipfetchall(?: (true|yes|on|1))?$/i.exec(line.trim()))
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
  timeoutMs: number,
): Promise<RemoteFetchFailure | undefined> {
  const subject = `fetch from remote '${remote}'`;
  try {
    const result = await runCommand(["git", "fetch", "--prune", "--", remote], {
      cwd,
      allowFailure: true,
      timeoutMs,
    });
    if (result.exitCode === 0) return undefined;
    const detail = firstLine(result.stderr);
    return {
      remote,
      message: `${subject} failed with ${result.exitCode}${detail ? `: ${detail}` : ""}; skipped`,
    };
  } catch (error) {
    if (!(error instanceof CommandTimeoutError)) throw error;
    const url = tailscaleCheckUrl(`${error.stderr}\n${error.stdout}`);
    const approval = url ? ` (Tailscale SSH check, approve the login at ${url})` : "";
    return {
      remote,
      message: `${subject} timed out after ${describeTimeout(timeoutMs)}; skipped${approval}`,
    };
  }
}

function firstLine(text: string): string {
  const line = text.split("\n").find((entry) => entry.trim() !== "") ?? "";
  const collapsed = line.trim().replace(/\s+/g, " ");
  return collapsed.length > DETAIL_MAX_LENGTH
    ? `${collapsed.slice(0, DETAIL_MAX_LENGTH - 1)}…`
    : collapsed;
}
