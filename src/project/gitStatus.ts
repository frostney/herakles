import { existsSync } from "node:fs";

const decoder = new TextDecoder();

export function readDefaultBranchBehind(
  projectPath: string,
  defaultBranchRef?: string,
): number | undefined {
  if (!defaultBranchRef || !existsSync(projectPath)) return undefined;
  const result = Bun.spawnSync(
    [
      "git",
      "rev-list",
      "--count",
      remoteBranchRef(defaultBranchRef),
      "--not",
      localBranchRef(defaultBranchRef),
    ],
    { cwd: projectPath, env: process.env, stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) return undefined;
  const count = Number(decoder.decode(result.stdout).trim());
  return Number.isFinite(count) ? count : undefined;
}

function localBranchRef(branch: string): string {
  return `refs/heads/${branch}`;
}

function remoteBranchRef(branch: string): string {
  return `refs/remotes/origin/${branch}`;
}
