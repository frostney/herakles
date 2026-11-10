import { lstat, mkdir, mkdtemp, readdir, rename, rm, rmdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { CommandTimeoutError, runCommand } from "../utils/command";
import { formatDuration } from "../utils/text";
import { approvalNote, failureDetail } from "./output";

export type CloneOutcome = {
  status: "done" | "skipped" | "failed";
  message: string;
};

const PATH_TAKEN = "something is already at the clone path";

/**
 * Clones `repository` (`owner/name`) to `path` with `gh repo clone`, bounded by inactivity like
 * a remote fetch: `--progress` makes git report on stderr while it transfers and checks out, and
 * any output starts the wait over, so a large clone that keeps reporting finishes, while one that
 * goes silent (an ssh session waiting for a login approval) is stopped after `idleTimeoutMs`.
 * gh's own steps print nothing: its API lookup before the clone and, for a fork, its fetch of
 * the `upstream` remote afterwards; either one staying silent that long stops the clone too.
 *
 * Nothing is created at `path` until the clone is complete: gh clones into a new hidden
 * directory beside it (git accepts an empty destination, and discovery skips hidden folders),
 * which is moved to `path` when gh succeeds. Only that staging directory is ever removed, so a
 * clone that times out (skipped) or fails (failed) leaves nothing that the next `up` would take
 * for an existing clone, and nothing another process put at `path`, not even an empty
 * directory, is touched. If something is at `path` before the clone starts or by the time it
 * finishes, the project is skipped and `path` is left alone. Failures are returned, not thrown.
 */
export async function cloneRepository(
  repository: string,
  path: string,
  idleTimeoutMs: number,
): Promise<CloneOutcome> {
  if (await pathExists(path))
    return { status: "skipped", message: `not cloned because ${PATH_TAKEN}` };
  await mkdir(dirname(path), { recursive: true });
  const staging = await mkdtemp(join(dirname(path), `.${basename(path)}.clone-`));
  const subject = `clone of ${repository}`;
  try {
    const result = await runCommand(
      ["gh", "repo", "clone", repository, staging, "--", "--progress"],
      {
        allowFailure: true,
        timeoutMs: idleTimeoutMs,
        resetTimeoutOnOutput: true,
        releasePipesAfterExit: true,
        // An HTTPS clone whose credential helper has nothing fails at once instead of waiting on
        // the terminal until the idle limit. ssh is left alone, as for fetches.
        env: { GIT_TERMINAL_PROMPT: "0" },
      },
    );
    if (result.exitCode === 0) return await moveIntoPlace(staging, path);
    const detail = failureDetail(result.stderr);
    return {
      status: "failed",
      message:
        `${subject} failed with ${result.exitCode}${detail ? `: ${detail}` : ""}` +
        (await removeStaging(staging, "the unfinished clone")) +
        approvalNote(`${result.stderr}\n${result.stdout}`),
    };
  } catch (error) {
    if (!(error instanceof CommandTimeoutError)) {
      await removeStaging(staging, "the unfinished clone");
      throw error;
    }
    return {
      status: "skipped",
      message:
        `${subject} timed out after ${formatDuration(idleTimeoutMs)} without output` +
        `${await removeStaging(staging, "the unfinished clone")}; skipped` +
        approvalNote(`${error.stderr}\n${error.stdout}`),
    };
  }
}

/**
 * Moves the finished clone to `path`. A plain rename would replace an empty directory another
 * process created there meanwhile, and Node has no rename that refuses to, so `path` is first
 * claimed with a non-recursive mkdir, which fails if anything is there, and the clone is renamed
 * onto that empty directory of our own. If the rename still fails (another process wrote into
 * the claimed directory), the claim is undone with rmdir, which removes only an empty directory.
 * Whatever was in the way is left alone and the new clone is removed.
 */
async function moveIntoPlace(staging: string, path: string): Promise<CloneOutcome> {
  const taken = async () => ({
    status: "skipped" as const,
    message: `not moved into place because ${PATH_TAKEN}${await removeStaging(staging, "the new clone")}`,
  });
  try {
    await mkdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return taken();
    return cannotMove(staging, error);
  }
  try {
    await rename(staging, path);
    return { status: "done", message: "cloned" };
  } catch (error) {
    await rmdir(path).catch(() => undefined);
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOTEMPTY" || code === "EEXIST") return taken();
    return cannotMove(staging, error);
  }
}

/** The clone could not be moved into place for a reason other than something in the way. */
async function cannotMove(staging: string, error: unknown): Promise<CloneOutcome> {
  const removed = await removeStaging(staging, "the new clone");
  const reason = error instanceof Error ? error.message : String(error);
  return { status: "failed", message: `could not move the clone into place: ${reason}${removed}` };
}

/**
 * Removes this clone's staging directory, which no other process knows about, and says so when
 * the clone had left something in it. git empties it when the transfer fails or it is stopped
 * with SIGTERM, but not when it is killed, and it keeps the repository when only the checkout
 * fails; gh fails after a complete clone when its fork setup does.
 */
async function removeStaging(staging: string, what: string): Promise<string> {
  try {
    const leftovers = (await readdir(staging)).length > 0;
    await rm(staging, { recursive: true, force: true });
    return leftovers ? `; removed ${what}` : "";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    const reason = error instanceof Error ? error.message : String(error);
    return `; could not remove ${what} at ${staging}: ${reason}`;
  }
}

/** Whether anything is at `path`, a dangling symlink included. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}
