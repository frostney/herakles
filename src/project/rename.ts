import { existsSync } from "node:fs";
import { mkdir, realpath, rename } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { LoadedConfig } from "../config/load";
import { resolveInside } from "../config/paths";
import {
  applyProjectConfigRenamePlan,
  createRenameProjectConfigPlan,
  type ProjectConfigRenamePlan,
} from "../config/projects";
import type {
  Project,
  ProjectRenamePlan,
  ProjectRenamePlanStep,
  ProjectRenameResult,
  ProjectRenameStepResult,
} from "../domain";
import { runCommand } from "../utils/command";

type Runner = typeof runCommand;

type GitHubRepositoryIdentity = {
  id: string;
  nameWithOwner: string;
};

type ParsedGitHubRemote = {
  owner: string;
  repo: string;
  style: "ssh" | "https";
};

type PreparedProjectRename = {
  plan: ProjectRenamePlan;
  configPlan: ProjectConfigRenamePlan;
  workspaceRoot: string;
};

export class InvalidProjectRenameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProjectRenameError";
  }
}

export async function createProjectRenamePlan(
  loaded: LoadedConfig,
  project: Project,
  targetRepo: string,
): Promise<ProjectRenamePlan> {
  return (await prepareProjectRename(loaded, project, targetRepo, runCommand)).plan;
}

export async function createProjectRenamePlanWithRunner(
  loaded: LoadedConfig,
  project: Project,
  targetRepo: string,
  runner: Runner,
): Promise<ProjectRenamePlan> {
  return (await prepareProjectRename(loaded, project, targetRepo, runner)).plan;
}

export async function renameProject(
  loaded: LoadedConfig,
  project: Project,
  targetRepo: string,
): Promise<ProjectRenameResult> {
  return renameProjectWithRunner(loaded, project, targetRepo, runCommand);
}

export async function renameProjectWithRunner(
  loaded: LoadedConfig,
  project: Project,
  targetRepo: string,
  runner: Runner,
): Promise<ProjectRenameResult> {
  const prepared = await prepareProjectRename(loaded, project, targetRepo, runner);
  const results: ProjectRenameStepResult[] = [];
  for (const step of prepared.plan.steps) {
    if (step.status !== "pending") {
      results.push({
        kind: step.kind,
        status: step.status,
        message:
          step.status === "already-satisfied"
            ? `${step.label} is already satisfied`
            : `${step.label} is not applicable`,
      });
      continue;
    }
    const result = await applyRenameStep(prepared, step, runner);
    results.push(result);
    if (result.status === "failed") {
      return {
        plan: prepared.plan,
        status: "failed",
        message: `${step.label} failed: ${result.message}`,
        steps: results,
      };
    }
  }
  return {
    plan: prepared.plan,
    status: "renamed",
    message: `Renamed ${prepared.plan.oldRepo} to ${prepared.plan.newRepo}`,
    steps: results,
  };
}

async function prepareProjectRename(
  loaded: LoadedConfig,
  project: Project,
  targetRepo: string,
  runner: Runner,
): Promise<PreparedProjectRename> {
  if (project.source !== "github" || !project.owner) {
    throw new InvalidProjectRenameError("Only tracked hosted projects can be renamed.");
  }
  const [targetOwner, newName] = splitOwnerRepo(targetRepo);
  if (targetOwner.toLowerCase() !== project.owner.toLowerCase()) {
    throw new InvalidProjectRenameError(
      `Rename must keep the existing owner ${project.owner}; repository transfers are not supported.`,
    );
  }
  if (newName.toLowerCase() === project.repo.toLowerCase()) {
    throw new InvalidProjectRenameError(
      "The new repository name must differ from the current name.",
    );
  }

  const owner = project.owner;
  const oldRepo = `${owner}/${project.repo}`;
  const newRepo = `${owner}/${newName}`;
  const oldConfigKey = trackedProjectConfigKey(loaded, oldRepo);
  const newConfigKey = `${owner}-${newName}`;
  const configPlan = createRenameProjectConfigPlan(loaded, oldConfigKey, newConfigKey, newRepo);
  const oldPath = project.path;
  const newPath = resolveInside(
    loaded.paths.workspaceRoot,
    join(project.state, ...(project.group ? [project.group] : []), newName),
  );

  const [oldIdentity, newIdentity] = await Promise.all([
    readGitHubRepository(oldRepo, runner),
    readGitHubRepository(newRepo, runner),
  ]);
  const hostStatus = hostRenameStatus(oldRepo, newRepo, oldIdentity, newIdentity);
  const checkout = await inspectCheckout(
    loaded.paths.workspaceRoot,
    oldPath,
    newPath,
    oldRepo,
    newRepo,
    runner,
  );
  const steps: ProjectRenamePlanStep[] = [
    {
      kind: "rename-host",
      status: hostStatus,
      label: "Rename GitHub repository",
      from: oldRepo,
      to: newRepo,
      command: ["gh", "api", "--method", "PATCH", `repos/${oldRepo}`, "-f", `name=${newName}`],
    },
    {
      kind: "update-remote",
      status: checkout.remoteStatus,
      label: "Update local origin remote",
      ...(checkout.remote === undefined ? {} : { from: checkout.remote }),
      ...(checkout.newRemote === undefined ? {} : { to: checkout.newRemote }),
      ...(checkout.path === undefined || checkout.newRemote === undefined
        ? {}
        : {
            command: [
              "git",
              "-C",
              checkout.path,
              "remote",
              "set-url",
              "origin",
              checkout.newRemote,
            ],
          }),
    },
    {
      kind: "move-checkout",
      status: checkout.moveStatus,
      label: "Move checkout to Canonical Checkout Path",
      from: oldPath,
      to: newPath,
    },
    {
      kind: "rekey-config",
      status: "pending",
      label: "Re-key tracked project config",
      from: oldConfigKey,
      to: newConfigKey,
    },
  ];
  const notes = [
    "Apply revalidates the complete plan before running any mutation.",
    "Run the same resumable rename in other workspaces with an existing checkout before exchanging the new synced config.",
  ];
  if (!checkout.path) {
    notes.unshift("No local checkout exists; remote update and directory move are not applicable.");
  }
  return {
    plan: {
      projectId: project.id,
      owner,
      oldName: project.repo,
      newName,
      oldRepo,
      newRepo,
      oldConfigKey,
      newConfigKey,
      oldPath,
      newPath,
      configPath: configPlan.configPath,
      configDiff: configPlan.diff,
      steps,
      notes,
    },
    configPlan,
    workspaceRoot: loaded.paths.workspaceRoot,
  };
}

async function applyRenameStep(
  prepared: PreparedProjectRename,
  step: ProjectRenamePlanStep,
  runner: Runner,
): Promise<ProjectRenameStepResult> {
  try {
    if (step.kind === "rename-host") {
      return commandStepResult(
        step,
        await runner(step.command ?? [], { allowFailure: true }),
        "GitHub repository renamed",
      );
    }
    if (step.kind === "update-remote") {
      return commandStepResult(
        step,
        await runner(required(step.command, "update remote command"), { allowFailure: true }),
        "origin remote updated",
      );
    }
    if (step.kind === "move-checkout") {
      await assertMoveInsideWorkspace(
        prepared.workspaceRoot,
        prepared.plan.oldPath,
        prepared.plan.newPath,
      );
      await mkdir(dirname(prepared.plan.newPath), { recursive: true });
      await rename(prepared.plan.oldPath, prepared.plan.newPath);
      return { kind: step.kind, status: "done", message: "checkout moved" };
    }
    if (step.kind === "rekey-config") {
      await applyProjectConfigRenamePlan(prepared.configPlan);
      return { kind: step.kind, status: "done", message: "tracked project config re-keyed" };
    }
    const unexpected: never = step.kind;
    throw new Error(`Unsupported rename step: ${String(unexpected)}`);
  } catch (error) {
    return {
      kind: step.kind,
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function commandStepResult(
  step: ProjectRenamePlanStep,
  result: Awaited<ReturnType<Runner>>,
  successMessage: string,
): ProjectRenameStepResult {
  return {
    kind: step.kind,
    status: result.exitCode === 0 ? "done" : "failed",
    message:
      result.exitCode === 0
        ? successMessage
        : result.stderr.trim() || result.stdout.trim() || `command exited with ${result.exitCode}`,
  };
}

async function inspectCheckout(
  workspaceRoot: string,
  oldPath: string,
  newPath: string,
  oldRepo: string,
  newRepo: string,
  runner: Runner,
): Promise<{
  path?: string;
  remote?: string;
  newRemote?: string;
  remoteStatus: ProjectRenamePlanStep["status"];
  moveStatus: ProjectRenamePlanStep["status"];
}> {
  const oldExists = existsSync(oldPath);
  const newExists = existsSync(newPath);
  if (oldExists && newExists) {
    throw new InvalidProjectRenameError(`Canonical checkout path already exists: ${newPath}`);
  }
  if (!oldExists && !newExists) {
    await assertDestinationInsideWorkspace(workspaceRoot, newPath);
    return { remoteStatus: "not-applicable", moveStatus: "not-applicable" };
  }
  const path = oldExists ? oldPath : newPath;
  await assertExistingPathInsideWorkspace(workspaceRoot, path);
  await assertDestinationInsideWorkspace(workspaceRoot, newPath);
  const [status, remoteResult] = await Promise.all([
    runner(["git", "status", "--porcelain"], { cwd: path, allowFailure: true }),
    runner(["git", "remote", "get-url", "origin"], { cwd: path, allowFailure: true }),
  ]);
  if (status.exitCode !== 0) {
    throw new InvalidProjectRenameError(`Not a readable Git repository: ${path}`);
  }
  if (status.stdout.trim()) {
    throw new InvalidProjectRenameError(`Refusing to rename a dirty worktree: ${path}`);
  }
  if (remoteResult.exitCode !== 0 || !remoteResult.stdout.trim()) {
    throw new InvalidProjectRenameError(`Checkout has no readable origin remote: ${path}`);
  }
  const remote = remoteResult.stdout.trim();
  const parsed = parseGitHubRemote(remote);
  const normalized = `${parsed.owner}/${parsed.repo}`.toLowerCase();
  const expectedOld = oldRepo.toLowerCase();
  const expectedNew = newRepo.toLowerCase();
  if (normalized !== expectedOld && normalized !== expectedNew) {
    throw new InvalidProjectRenameError(
      `Checkout origin ${remote} does not match ${oldRepo} or ${newRepo}.`,
    );
  }
  const newRemote = renderGitHubRemote(parsed.style, newRepo);
  return {
    path,
    remote,
    newRemote,
    remoteStatus: normalized === expectedNew ? "already-satisfied" : "pending",
    moveStatus: oldExists ? "pending" : "already-satisfied",
  };
}

async function readGitHubRepository(
  repo: string,
  runner: Runner,
): Promise<GitHubRepositoryIdentity | undefined> {
  const result = await runner(["gh", "api", `repos/${repo}`], { allowFailure: true });
  if (result.exitCode !== 0) {
    if (/\b404\b|not found/i.test(`${result.stderr}\n${result.stdout}`)) return undefined;
    throw new InvalidProjectRenameError(
      result.stderr.trim() || result.stdout.trim() || `Unable to read GitHub repository ${repo}.`,
    );
  }
  try {
    const value = JSON.parse(result.stdout) as {
      id?: number | string;
      node_id?: string;
      full_name?: string;
    };
    const id = value.node_id ?? value.id;
    if (id === undefined || !value.full_name) throw new Error("missing identity");
    return { id: String(id), nameWithOwner: value.full_name };
  } catch {
    throw new InvalidProjectRenameError(
      `GitHub repository response did not include identity for ${repo}.`,
    );
  }
}

function hostRenameStatus(
  oldRepo: string,
  newRepo: string,
  oldIdentity: GitHubRepositoryIdentity | undefined,
  newIdentity: GitHubRepositoryIdentity | undefined,
): ProjectRenamePlanStep["status"] {
  if (!oldIdentity) {
    if (newIdentity) {
      throw new InvalidProjectRenameError(
        `GitHub target ${newRepo} exists, but it cannot be proven to be the renamed ${oldRepo}.`,
      );
    }
    throw new InvalidProjectRenameError(`GitHub repository does not exist: ${oldRepo}`);
  }
  if (oldIdentity.nameWithOwner.toLowerCase() === newRepo.toLowerCase()) {
    if (!newIdentity || newIdentity.id !== oldIdentity.id) {
      throw new InvalidProjectRenameError(`GitHub rename state is inconsistent for ${newRepo}.`);
    }
    return "already-satisfied";
  }
  if (oldIdentity.nameWithOwner.toLowerCase() !== oldRepo.toLowerCase()) {
    throw new InvalidProjectRenameError(
      `GitHub repository ${oldRepo} resolved to ${oldIdentity.nameWithOwner}.`,
    );
  }
  if (newIdentity) {
    throw new InvalidProjectRenameError(`GitHub target repository already exists: ${newRepo}`);
  }
  return "pending";
}

function trackedProjectConfigKey(loaded: LoadedConfig, repo: string): string {
  const entry = Object.entries(loaded.config.project).find(
    ([, config]) => config.source === "github" && config.repo?.toLowerCase() === repo.toLowerCase(),
  );
  if (!entry) throw new InvalidProjectRenameError(`Project is not tracked in config: ${repo}`);
  return entry[0];
}

function splitOwnerRepo(value: string): [string, string] {
  const parts = value.split("/");
  if (
    parts.length !== 2 ||
    !parts[0] ||
    !parts[1] ||
    !parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== "." && part !== "..")
  ) {
    throw new InvalidProjectRenameError(
      `Expected hosted repository as owner/new-name, received: ${value}`,
    );
  }
  return [parts[0], parts[1]];
}

function parseGitHubRemote(value: string): ParsedGitHubRemote {
  const ssh = value.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
  if (ssh?.[1] && ssh[2]) {
    return { owner: ssh[1], repo: stripGitSuffix(ssh[2]), style: "ssh" };
  }
  try {
    const url = new URL(value);
    const parts = url.pathname.replace(/^\/|\/$/g, "").split("/");
    if (
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === "github.com" &&
      !url.username &&
      !url.password &&
      parts.length === 2 &&
      parts[0] &&
      parts[1]
    ) {
      return { owner: parts[0], repo: stripGitSuffix(parts[1]), style: "https" };
    }
  } catch {
    // Report the normalized domain error below.
  }
  throw new InvalidProjectRenameError(`Unsupported GitHub origin remote: ${value}`);
}

function stripGitSuffix(value: string): string {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
}

function renderGitHubRemote(style: ParsedGitHubRemote["style"], repo: string): string {
  return style === "ssh" ? `git@github.com:${repo}.git` : `https://github.com/${repo}.git`;
}

async function assertMoveInsideWorkspace(workspaceRoot: string, from: string, to: string) {
  if (!existsSync(from)) throw new Error(`Existing checkout is missing: ${from}`);
  if (existsSync(to)) throw new Error(`Canonical checkout path already exists: ${to}`);
  await assertExistingPathInsideWorkspace(workspaceRoot, from);
  await assertDestinationInsideWorkspace(workspaceRoot, to);
}

async function assertExistingPathInsideWorkspace(workspaceRoot: string, path: string) {
  assertLexicallyInside(workspaceRoot, path);
  const workspaceRealPath = await realpath(workspaceRoot);
  const pathRealPath = await realpath(path);
  if (!pathIsInside(workspaceRealPath, pathRealPath)) {
    throw new InvalidProjectRenameError(`Refusing to operate outside workspace: ${path}`);
  }
}

async function assertDestinationInsideWorkspace(workspaceRoot: string, path: string) {
  assertLexicallyInside(workspaceRoot, path);
  const workspaceRealPath = await realpath(workspaceRoot);
  const ancestorRealPath = await realpath(nearestExistingAncestor(path));
  if (!pathIsInside(workspaceRealPath, ancestorRealPath)) {
    throw new InvalidProjectRenameError(`Refusing to operate outside workspace: ${path}`);
  }
}

function assertLexicallyInside(workspaceRoot: string, path: string) {
  if (!pathIsInside(workspaceRoot, path)) {
    throw new InvalidProjectRenameError(`Refusing to operate outside workspace: ${path}`);
  }
}

function pathIsInside(base: string, path: string) {
  const offset = relative(base, path);
  return offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset);
}

function nearestExistingAncestor(path: string): string {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing ${label}.`);
  return value;
}
