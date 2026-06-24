export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

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
                reject(new Error(`${argv.join(" ")} timed out after ${options.timeoutMs}ms`));
              }, options.timeoutMs);
            }),
          ]);
    if (exitCode !== 0 && !options.allowFailure) {
      throw new Error(`${argv.join(" ")} failed with ${exitCode}: ${stderr.trim()}`);
    }
    return { exitCode, stdout, stderr };
  } finally {
    if (timeout) clearTimeout(timeout);
    result.catch(() => undefined);
  }
}
