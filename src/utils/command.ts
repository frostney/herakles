export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandOptions = {
  cwd?: string;
  allowFailure?: boolean;
  stdin?: string;
  /**
   * Longest the command may run. With `resetTimeoutOnOutput` it is the longest the command may
   * stay silent instead: every chunk on stdout or stderr starts the wait over.
   */
  timeoutMs?: number;
  resetTimeoutOnOutput?: boolean;
};

/** How long a timed-out command gets to exit after SIGTERM before its process tree is killed. */
const KILL_GRACE_MS = 2000;
/** How long a command's output pipes get to close once it has exited or been stopped. */
const OUTPUT_DRAIN_MS = 500;

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
  const watchdog = timeoutMs === undefined ? undefined : startWatchdog(proc, timeoutMs);
  const onOutput = options.resetTimeoutOnOutput ? () => watchdog?.restart() : undefined;
  const stdout = collectText(proc.stdout, onOutput);
  const stderr = collectText(proc.stderr, onOutput);
  const streamsClosed = Promise.all([stdout.done, stderr.done]);
  streamsClosed.catch(() => undefined);
  // The command is finished when it exits, not when its output ends: a descendant that outlives
  // it (an ssh ControlPersist master, say) can hold the pipes open for good. Output already
  // written is read within the grace period; after that the pipes are left alone.
  const finished = proc.exited.then(async (code) => {
    watchdog?.stop();
    await settleWithin(streamsClosed, OUTPUT_DRAIN_MS);
    return code;
  });
  try {
    let outcome = await Promise.race([finished, ...(watchdog ? [watchdog.expired] : [])]);
    // The command can exit just as the timer fires; an exited command is never a timeout.
    if (outcome === TIMED_OUT && hasExited(proc)) outcome = await finished;
    if (outcome === TIMED_OUT) {
      await terminateProcessTree(proc, streamsClosed);
      await settleWithin(streamsClosed, OUTPUT_DRAIN_MS);
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
  }
}

function hasExited(proc: Bun.Subprocess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}

/**
 * A timer for a running command. `expired` resolves once the timer runs out while the command is
 * still running; `restart` starts the wait over and `stop` ends it for good.
 */
function startWatchdog(proc: Bun.Subprocess, timeoutMs: number) {
  let timer: Timer | undefined;
  let stopped = false;
  let expire: (reason: typeof TIMED_OUT) => void = () => undefined;
  const expired = new Promise<typeof TIMED_OUT>((resolve) => {
    expire = resolve;
  });
  const restart = () => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!hasExited(proc)) expire(TIMED_OUT);
    }, timeoutMs);
  };
  restart();
  return {
    expired,
    restart,
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

/** Reads a stream to the end while keeping what has arrived so far available. */
function collectText(stream: ReadableStream<Uint8Array>, onChunk?: () => void) {
  const decoder = new TextDecoder();
  let text = "";
  const done = (async () => {
    for await (const chunk of stream) {
      text += decoder.decode(chunk, { stream: true });
      onChunk?.();
    }
    text += decoder.decode();
  })();
  return { done, text: () => text };
}

/**
 * Stops a timed-out command and every process it started. Killing only the command is not
 * enough: an ssh child that git started can outlive it, hold the output pipes open and keep
 * waiting on the remote. Descendants are listed before the signal, because they are re-parented
 * once their parent dies. SIGTERM goes first so git can release its lock files; whatever is
 * still running after a short grace period gets SIGKILL. The command's own pid is signalled only
 * while the command has not exited, because the pid could be reused afterwards.
 */
async function terminateProcessTree(proc: Bun.Subprocess, streamsClosed: Promise<unknown>) {
  if (hasExited(proc)) return;
  const descendants = descendantPids(proc.pid);
  const signalTree = (signal: NodeJS.Signals) => {
    signalAll(descendants, signal);
    if (!hasExited(proc)) signalAll([proc.pid], signal);
  };
  signalTree("SIGTERM");
  const stopped = await settleWithin(
    Promise.all([proc.exited, streamsClosed, waitUntilGone(descendants, KILL_GRACE_MS)]),
    KILL_GRACE_MS,
  );
  if (stopped) return;
  signalTree("SIGKILL");
  // A killed process stays visible until it is reaped; give that a moment.
  await waitUntilGone(descendants, OUTPUT_DRAIN_MS);
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

/** Every transitive child of `root`, read from the process table (`ps` exists on macOS and Linux). */
function descendantPids(root: number): number[] {
  let table: string;
  try {
    const listing = Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid="], {
      stdout: "pipe",
      stderr: "ignore",
    });
    if (listing.exitCode !== 0) return [];
    table = listing.stdout.toString();
  } catch {
    return [];
  }
  const childrenOf = new Map<number, number[]>();
  for (const line of table.split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid === undefined || ppid === undefined || Number.isNaN(pid) || Number.isNaN(ppid)) {
      continue;
    }
    const siblings = childrenOf.get(ppid);
    if (siblings) siblings.push(pid);
    else childrenOf.set(ppid, [pid]);
  }
  // Breadth-first walk: `queue` is read by index, so each pid is visited once.
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
      env: process.env,
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
