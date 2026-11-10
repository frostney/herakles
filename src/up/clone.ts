import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { CommandTimeoutError, runCommand } from "../utils/command";
import { formatDuration } from "../utils/text";
import { approvalNote, failureDetail } from "./output";

export type CloneOutcome = {
  status: "done" | "skipped" | "failed";
  message: string;
};

/**
 * Clones `repository` (`owner/name`) to `path` with `gh repo clone`, bounded by inactivity like
 * a remote fetch: `--progress` makes git report on stderr while it transfers and checks out, and
 * any output starts the wait over, so a large clone that keeps reporting finishes, while one that
 * goes silent (an ssh session waiting for a login approval) is stopped after `idleTimeoutMs`.
 * gh's own steps print nothing: its API lookup before the clone and, for a fork, its fetch of
 * the `upstream` remote afterwards; either one staying silent that long stops the clone too.
 *
 * The clone first creates `path` as an empty directory and clones into it (git accepts an empty
 * destination). Creating it fails if anything is at `path`, for example something another
 * process put there since the plan was made; then nothing is cloned and nothing is touched. A
 * clone that times out is skipped, one that fails is failed. Either way the directory is
 * removed, because the next `up` would take any directory at `path` for an existing clone, and
 * the message says so when the clone had left something in it. Failures are returned, not
 * thrown.
 */
export async function cloneRepository(
  repository: string,
  path: string,
  idleTimeoutMs: number,
): Promise<CloneOutcome> {
  await mkdir(dirname(path), { recursive: true });
  if (!(await claimPath(path))) {
    return {
      status: "skipped",
      message: "not cloned because something is already at the clone path",
    };
  }
  const subject = `clone of ${repository}`;
  try {
    const result = await runCommand(["gh", "repo", "clone", repository, path, "--", "--progress"], {
      allowFailure: true,
      timeoutMs: idleTimeoutMs,
      resetTimeoutOnOutput: true,
      releasePipesAfterExit: true,
      // An HTTPS clone whose credential helper has nothing fails at once instead of waiting on
      // the terminal until the idle limit. ssh is left alone, as for fetches.
      env: { GIT_TERMINAL_PROMPT: "0" },
    });
    if (result.exitCode === 0) return { status: "done", message: "cloned" };
    const detail = failureDetail(result.stderr);
    return {
      status: "failed",
      message:
        `${subject} failed with ${result.exitCode}${detail ? `: ${detail}` : ""}` +
        (await removeUnfinishedClone(path)) +
        approvalNote(`${result.stderr}\n${result.stdout}`),
    };
  } catch (error) {
    if (!(error instanceof CommandTimeoutError)) throw error;
    return {
      status: "skipped",
      message:
        `${subject} timed out after ${formatDuration(idleTimeoutMs)} without output` +
        `${await removeUnfinishedClone(path)}; skipped` +
        approvalNote(`${error.stderr}\n${error.stdout}`),
    };
  }
}

/** Creates `path` as an empty directory; false when something is already there. */
async function claimPath(path: string): Promise<boolean> {
  try {
    await mkdir(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

/**
 * Removes the directory a clone that did not finish was given, and says so when the clone had
 * left something in it. git empties it when the transfer fails or it is stopped with SIGTERM,
 * but not when it is killed, and it keeps the repository when only the checkout fails; gh fails
 * after a complete clone when its fork setup does.
 */
async function removeUnfinishedClone(path: string): Promise<string> {
  try {
    const leftovers = (await readdir(path)).length > 0;
    await rm(path, { recursive: true, force: true });
    return leftovers ? "; removed the unfinished clone" : "";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    const reason = error instanceof Error ? error.message : String(error);
    return `; could not remove the unfinished clone: ${reason}`;
  }
}
