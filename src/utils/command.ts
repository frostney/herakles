export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

/** How long a timed-out command gets to exit after SIGTERM before its process tree is killed. */
const KILL_GRACE_MS = 2000;
/** How long a killed command's output pipes get to close before the output read so far is used. */
const OUTPUT_DRAIN_MS = 500;

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
  options: { cwd?: string; allowFailure?: boolean; stdin?: string; timeoutMs?: number } = {},
): Promise<CommandResult> {
  const spawned = spawnProcess(argv, options);
  if ("failure" in spawned) return spawned.failure;
  const { proc } = spawned;
  const stdout = collectText(proc.stdout);
  const stderr = collectText(proc.stderr);
  const result = Promise.all([stdout.done, stderr.done, proc.exited]);
  const { timeoutMs } = options;
  let timeout: Timer | undefined;
  let timedOut = false;
  try {
    const exited = result.then(([, , code]) => code);
    const exitCode =
      timeoutMs === undefined
        ? await exited
        : await Promise.race([
            exited,
            // Resolves, never rejects, once the process tree is stopped, so it cannot go
            // unhandled when the command finishes first.
            new Promise<undefined>((resolve) => {
              timeout = setTimeout(async () => {
                timedOut = true;
                await terminateProcessTree(proc, result);
                // The output pipes close with the tree; do not wait on one that never does.
                await Promise.race([result.catch(() => undefined), Bun.sleep(OUTPUT_DRAIN_MS)]);
                resolve(undefined);
              }, timeoutMs);
            }),
          ]);
    // The command can also exit from the kill itself, which would look like an ordinary failure.
    if ((timedOut || exitCode === undefined) && timeoutMs !== undefined) {
      throw new CommandTimeoutError(argv, timeoutMs, {
        stdout: stdout.text(),
        stderr: stderr.text(),
      });
    }
    if (exitCode === undefined) throw new Error(`${argv.join(" ")} did not report an exit code`);
    if (exitCode !== 0 && !options.allowFailure) {
      throw new Error(`${argv.join(" ")} failed with ${exitCode}: ${stderr.text().trim()}`);
    }
    return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
  } finally {
    if (timeout) clearTimeout(timeout);
    result.catch(() => undefined);
  }
}

/** Reads a stream to the end while keeping what has arrived so far available. */
function collectText(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let text = "";
  const done = (async () => {
    for await (const chunk of stream) text += decoder.decode(chunk, { stream: true });
    text += decoder.decode();
  })();
  return { done, text: () => text };
}

/**
 * Stops a timed-out command and every process it started. Killing only the command is not
 * enough: an ssh child that git started can outlive it, hold the output pipes open and keep
 * waiting on the remote. Descendants are listed before the signal, because they are re-parented
 * once their parent dies. SIGTERM goes first so git can release its lock files; whatever is
 * still running after a short grace period gets SIGKILL.
 */
async function terminateProcessTree(proc: Bun.Subprocess, settled: Promise<unknown>) {
  const tree = [...descendantPids(proc.pid), proc.pid];
  signalAll(tree, "SIGTERM");
  let grace: Timer | undefined;
  const settledInTime = await Promise.race([
    settled.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => {
      grace = setTimeout(() => resolve(false), KILL_GRACE_MS);
    }),
  ]);
  clearTimeout(grace);
  if (!settledInTime) signalAll(tree, "SIGKILL");
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
    childrenOf.set(ppid, [...(childrenOf.get(ppid) ?? []), pid]);
  }
  const found: number[] = [];
  const queue = [root];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const child of childrenOf.get(next) ?? []) {
      found.push(child);
      queue.push(child);
    }
  }
  return found;
}

function spawnProcess(
  argv: readonly string[],
  options: { cwd?: string; allowFailure?: boolean; stdin?: string },
) {
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
