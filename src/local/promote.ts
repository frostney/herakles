import type { LoadedConfig } from "../config/load";
import type { LocalPromotionPlan, LocalPromotionResult, Project } from "../domain";
import { runCommand } from "../utils/command";

export type LocalPromotionOptions = {
  owner?: string;
  repo?: string;
  visibility?: "public" | "private";
};

export function createLocalPromotionPlan(
  loaded: LoadedConfig,
  project: Project,
  options: LocalPromotionOptions = {},
): LocalPromotionPlan {
  if (project.source !== "local") {
    throw new Error("Promotion plans can only target local experiments.");
  }
  const owner = options.owner ?? loaded.config.github.owners[0];
  if (!owner) throw new Error("Promotion requires a GitHub owner.");
  const repo = options.repo ?? project.repo;
  assertRepoName(repo);
  const visibility = options.visibility ?? "private";
  const remote = `git@github.com:${owner}/${repo}.git`;
  const command = [
    "gh",
    "repo",
    "create",
    `${owner}/${repo}`,
    visibility === "private" ? "--private" : "--public",
    "--source",
    project.path,
    "--remote",
    "origin",
    "--push",
  ];
  return {
    projectId: project.id,
    localPath: project.path,
    owner,
    repo,
    visibility,
    remote,
    command,
    writesSyncedConfig: false,
    notes: notes(project),
  };
}

export async function promoteLocalProject(
  loaded: LoadedConfig,
  project: Project,
  options: LocalPromotionOptions = {},
): Promise<LocalPromotionResult> {
  const plan = createLocalPromotionPlan(loaded, project, options);
  const result = await runCommand(plan.command, { cwd: plan.localPath, allowFailure: true });
  return {
    plan,
    status: result.exitCode === 0 ? "promoted" : "failed",
    message:
      result.exitCode === 0
        ? `Promoted ${project.repo} to ${plan.owner}/${plan.repo}`
        : result.stderr.trim() || result.stdout.trim() || `gh exited with ${result.exitCode}`,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function assertRepoName(value: string) {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error(`Invalid GitHub repository name: ${value}`);
  }
}

function notes(project: Project): string[] {
  const result = [
    "Promotion is explicit and does not write the synced Herakles config.",
    "After project refresh, the promoted repository is discovered as a hosted project.",
  ];
  if (project.remote) {
    result.push(`The local project already has an origin remote: ${project.remote}`);
  }
  return result;
}
