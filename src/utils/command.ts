export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandFailure =
  | { kind: "exit"; exitCode: number; stderr: string }
  | { kind: "timeout"; timeoutMs: number };

/** A failed command. The message is for logs and carries the argv; `failure` is safe to show. */
export class CommandError extends Error {
  readonly failure: CommandFailure;

  constructor(message: string, failure: CommandFailure) {
    super(message);
    this.name = "CommandError";
    this.failure = failure;
  }
}

export async function runCommand(
  argv: readonly string[],
  options: { cwd?: string; allowFailure?: boolean; stdin?: string; timeoutMs?: number } = {},
): Promise<CommandResult> {
  const proc = Bun.spawn([...argv], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    env: process.env,
    stdin: options.stdin === undefined ? "ignore" : new Response(options.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const result = Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  let timeout: Timer | undefined;
  try {
    const [stdout, stderr, exitCode] =
      options.timeoutMs === undefined
        ? await result
        : await Promise.race([
            result,
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => {
                proc.kill();
                const timeoutMs = options.timeoutMs ?? 0;
                reject(
                  new CommandError(`${argv.join(" ")} timed out after ${timeoutMs}ms`, {
                    kind: "timeout",
                    timeoutMs,
                  }),
                );
              }, options.timeoutMs);
            }),
          ]);
    if (exitCode !== 0 && !options.allowFailure) {
      throw new CommandError(`${argv.join(" ")} failed with ${exitCode}: ${stderr.trim()}`, {
        kind: "exit",
        exitCode,
        stderr,
      });
    }
    return { exitCode, stdout, stderr };
  } finally {
    if (timeout) clearTimeout(timeout);
    result.catch(() => undefined);
  }
}
