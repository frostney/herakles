export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export async function runCommand(
  argv: readonly string[],
  options: { cwd?: string; allowFailure?: boolean; stdin?: string } = {},
): Promise<CommandResult> {
  const proc = Bun.spawn([...argv], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    env: process.env,
    stdin: options.stdin === undefined ? "ignore" : new Response(options.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0 && !options.allowFailure) {
    throw new Error(`${argv.join(" ")} failed with ${exitCode}: ${stderr.trim()}`);
  }
  return { exitCode, stdout, stderr };
}
