export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandOptions = {
  cwd?: string;
  allowFailure?: boolean;
  stdin?: string;
  /** Added to the environment the command inherits. */
  env?: Record<string, string>;
  /**
   * Longest the command may run. With `resetTimeoutOnOutput` it is the longest the command may
   * stay silent instead: every chunk on stdout or stderr starts the wait over.
   */
  timeoutMs?: number;
  resetTimeoutOnOutput?: boolean;
  /**
   * Treat the command as finished when it exits, even if a descendant it started (an ssh
   * ControlPersist master, say) still holds its output pipes open. After the exit the pipes are
   * read until they have been quiet for a moment (and for at most a few seconds in all, however
   * long output keeps arriving), then released so they cannot keep this process alive. Without it the output is always read to its end, which is what a caller that needs all
   * of it wants.
   */
  releasePipesAfterExit?: boolean;
};

/** How long a timed-out command gets to exit after SIGTERM before its process tree is killed. */
const KILL_GRACE_MS = 2000;
/** How long a pipe may stay quiet after the command is gone before it is given up on. */
const OUTPUT_DRAIN_MS = 500;
/** The most time the pipes get after the command is gone, even while output keeps arriving. */
const MAX_DRAIN_MS = 5000;

const TIMED_OUT = Symbol("timed out");

/**
 * Thrown when a command exceeds `timeoutMs`. It carries the output captured before the process
 * tree was stopped, so callers can still surface what the command said (an ssh prompt, say).
 */
export class CommandTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly stdout: string;
  readonly stderr: string;

  constructor(argv: readonly string[], timeoutMs: number, output: Omit<CommandResult, "exitCode">) {
    super(`${argv.join(" ")} timed out after ${timeoutMs}ms`);
    this.name = "CommandTimeoutError";
    this.timeoutMs = timeoutMs;
    this.stdout = output.stdout;
    this.stderr = output.stderr;
  }
}

export async function runCommand(
  argv: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  const spawned = spawnProcess(argv, options);
  if ("failure" in spawned) return spawned.failure;
  const { proc } = spawned;
  const { timeoutMs } = options;
  const startedAt = Date.now();
  const lastOutput = { at: startedAt };
  const watchdog =
    timeoutMs === undefined
      ? undefined
      : startWatchdog(timeoutMs, () => (options.resetTimeoutOnOutput ? lastOutput.at : startedAt));
  const onChunk = () => {
    lastOutput.at = Date.now();
  };
  const stdout = collectText(proc.stdout, onChunk);
  const stderr = collectText(proc.stderr, onChunk);
  const streamsClosed = Promise.all([stdout.done, stderr.done]);
  streamsClosed.catch(() => undefined);
  const releasePipes = () => Promise.all([stdout.cancel(), stderr.cancel()]);
  const finished = options.releasePipesAfterExit
    ? proc.exited.then(async (code) => {
        watchdog?.stop();
        lastOutput.at = Date.now();
        await drainWhileActive(
          streamsClosed,
          lastOutput,
          Math.min(MAX_DRAIN_MS, timeoutMs ?? MAX_DRAIN_MS),
        );
        await releasePipes();
        return code;
      })
    : Promise.all([proc.exited, streamsClosed]).then(([code]) => code);
  try {
    let outcome = await Promise.race([finished, ...(watchdog ? [watchdog.expired] : [])]);
    // The command can exit just as the timer fires; with pipes released on exit, an exited
    // command is never a timeout.
    if (outcome === TIMED_OUT && options.releasePipesAfterExit && hasExited(proc)) {
      outcome = await finished;
    }
    if (outcome === TIMED_OUT) {
      await terminateProcessTree(proc, streamsClosed);
      await settleWithin(streamsClosed, OUTPUT_DRAIN_MS);
      await releasePipes();
      throw new CommandTimeoutError(argv, timeoutMs ?? 0, {
        stdout: stdout.text(),
        stderr: stderr.text(),
      });
    }
    if (outcome !== 0 && !options.allowFailure) {
      throw new Error(`${argv.join(" ")} failed with ${outcome}: ${stderr.text().trim()}`);
    }
    return { exitCode: outcome, stdout: stdout.text(), stderr: stderr.text() };
  } finally {
    watchdog?.stop();
    finished.catch(() => undefined);
    await releasePipes();
  }
}

function hasExited(proc: Bun.Subprocess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}

/**
 * One timer for a running command. When it fires it checks how long the command has been idle
 * since `idleSince()`: if the limit is reached, `expired` resolves; otherwise the timer waits
 * out the remainder. Output that arrives in between therefore costs nothing, not a timer reset.
 */
function startWatchdog(timeoutMs: number, idleSince: () => number) {
  let timer: Timer | undefined;
  let stopped = false;
  let expire: (reason: typeof TIMED_OUT) => void = () => undefined;
  const expired = new Promise<typeof TIMED_OUT>((resolve) => {
    expire = resolve;
  });
  const check = () => {
    if (stopped) return;
    const remaining = idleSince() + timeoutMs - Date.now();
    if (remaining <= 0) expire(TIMED_OUT);
    else timer = setTimeout(check, remaining);
  };
  timer = setTimeout(check, timeoutMs);
  return {
    expired,
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

/** Waits for `promise` (a rejection counts as settled) for at most `ms`; true if it settled. */
async function settleWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: Timer | undefined;
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Waits until the pipes close, or have been quiet for the drain period; data extends the wait,
 * but never past `maxMs` in total, so a descendant that keeps writing cannot hold the caller.
 */
async function drainWhileActive(
  streamsClosed: Promise<unknown>,
  lastOutput: { at: number },
  maxMs: number,
) {
  const hardStop = Date.now() + maxMs;
  for (;;) {
    const remaining = Math.min(lastOutput.at + OUTPUT_DRAIN_MS, hardStop) - Date.now();
    if (remaining <= 0 || (await settleWithin(streamsClosed, remaining))) return;
  }
}

/**
 * Reads a stream to the end while keeping what has arrived so far available. `cancel` stops
 * reading and releases the pipe, which a process that holds the write end open would otherwise
 * keep alive (and with it this process) for as long as it runs.
 */
function collectText(stream: ReadableStream<Uint8Array>, onChunk: () => void) {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let text = "";
  const done = (async () => {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      text += decoder.decode(chunk.value, { stream: true });
      onChunk();
    }
    text += decoder.decode();
  })();
  return {
    done,
    text: () => text,
    cancel: () => reader.cancel().catch(() => undefined),
  };
}

/**
 * Stops a timed-out command and every process it started. Killing only the command is not
 * enough: an ssh child that git started can outlive it, hold the output pipes open and keep
 * waiting on the remote. Descendants are listed before the signal, because they are re-parented
 * once their parent dies. SIGTERM goes first so git can release its lock files; whatever is
 * still running after a short grace period gets SIGKILL, but only the processes that are still
 * the ones first listed (same pid, same start time), since a pid can be reused in between. The
 * command's own pid is signalled only while the command has not exited, for the same reason.
 */
async function terminateProcessTree(proc: Bun.Subprocess, streamsClosed: Promise<unknown>) {
  if (hasExited(proc)) return;
  const first = processTable();
  const descendants = descendantPids(first, proc.pid);
  const signalTree = (pids: readonly number[], signal: NodeJS.Signals) => {
    signalAll(pids, signal);
    if (!hasExited(proc)) signalAll([proc.pid], signal);
  };
  signalTree(descendants, "SIGTERM");
  const stopped = await settleWithin(
    Promise.all([proc.exited, streamsClosed, waitUntilGone(descendants, KILL_GRACE_MS)]),
    KILL_GRACE_MS,
  );
  if (stopped) return;
  const second = processTable();
  const survivors = descendants.filter((pid) => {
    const before = first.get(pid);
    const now = second.get(pid);
    return before !== undefined && now !== undefined && before.started === now.started;
  });
  signalTree(survivors, "SIGKILL");
  // A killed process stays visible until it is reaped; give that a moment.
  await waitUntilGone(survivors, OUTPUT_DRAIN_MS);
}

/** Polls until none of `pids` is running any more, or `ms` have passed. */
async function waitUntilGone(pids: readonly number[], ms: number) {
  const deadline = Date.now() + ms;
  while (pids.some(isRunning) && Date.now() < deadline) await Bun.sleep(25);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalAll(pids: readonly number[], signal: NodeJS.Signals) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone, or not ours to signal
    }
  }
}

type ProcessEntry = { ppid: number; started: string };

/**
 * The process table: pid to parent and start time (`ps` exists on macOS and Linux). Empty when
 * `ps` cannot be run, which leaves nothing to signal rather than something unverified.
 */
function processTable(): Map<number, ProcessEntry> {
  const table = new Map<number, ProcessEntry>();
  let listing: string;
  try {
    const result = Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid=,lstart="], {
      stdout: "pipe",
      stderr: "ignore",
    });
    if (result.exitCode !== 0) return table;
    listing = result.stdout.toString();
  } catch {
    return table;
  }
  for (const line of listing.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S.*?)\s*$/.exec(line);
    if (match) table.set(Number(match[1]), { ppid: Number(match[2]), started: match[3] ?? "" });
  }
  return table;
}

/** Every transitive child of `root` in the table, breadth first. */
function descendantPids(table: ReadonlyMap<number, ProcessEntry>, root: number): number[] {
  const childrenOf = new Map<number, number[]>();
  for (const [pid, entry] of table) {
    const siblings = childrenOf.get(entry.ppid);
    if (siblings) siblings.push(pid);
    else childrenOf.set(entry.ppid, [pid]);
  }
  // `queue` is read by index, so each pid is visited once.
  const queue = [root];
  for (let next = 0; next < queue.length; next++) {
    queue.push(...(childrenOf.get(queue[next] as number) ?? []));
  }
  return queue.slice(1);
}

function spawnProcess(argv: readonly string[], options: CommandOptions) {
  try {
    const proc = Bun.spawn([...argv], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      env: { ...process.env, ...options.env },
      stdin: options.stdin === undefined ? "ignore" : new Response(options.stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    return { proc };
  } catch (error) {
    if (!options.allowFailure) throw error;
    // The executable could not be started (for example not found on PATH). Report it the way a
    // shell does, so allowFailure callers handle it like any other failed command.
    const reason = error instanceof Error ? error.message : String(error);
    const failure: CommandResult = {
      exitCode: 127,
      stdout: "",
      stderr: `${argv[0] ?? "command"}: ${reason}`,
    };
    return { failure };
  }
}
