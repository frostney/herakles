import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as app from "../app";
import { loadConfig } from "../config/load";
import { pathIsInside, resolveWorkspacePaths } from "../config/paths";
import type { Project } from "../domain";
import type {
  OperationOutcome,
  OperationPlan,
  PluginContext,
  ToolRunOptions,
} from "../plugin-host/api";
import { runCommand } from "../utils/command";
import { definedProperties } from "../utils/definedProperties";
import { formatTable } from "./output";
import { ask } from "./prompt";

type TextStream = { write(text: string): unknown };

export type PluginContextOptions = {
  pluginName: string;
  workspaceRoot: string;
  json: boolean;
  stdout: TextStream;
  stderr: TextStream;
};

/**
 * Build the context a plugin command receives: core services for the active
 * Herakles Workspace plus output and prompt helpers bound to the command's
 * streams. With `--json`, previews and prompts go to stderr.
 */
export function createPluginContext(options: PluginContextOptions): PluginContext {
  const { workspaceRoot, json, stdout, stderr } = options;
  const promptStream = json ? stderr : stdout;
  const confirm = async (question: string) =>
    (await ask(`${question} (yes/no): `, promptStream)).toLowerCase() === "yes";
  return {
    plugin: { name: options.pluginName },
    json,
    workspace: {
      root: workspaceRoot,
      cacheDir: join(resolveWorkspacePaths(workspaceRoot).cacheDir, "plugins", options.pluginName),
    },
    projects: {
      list: () => app.projects(workspaceRoot),
      get: (selector) => app.project(workspaceRoot, selector),
      validate: (validationOptions) => app.validation(workspaceRoot, validationOptions),
    },
    config: {
      read: async () => structuredClone((await loadConfig(workspaceRoot)).config),
    },
    git: {
      run: async (project, args, runOptions) =>
        runCommand(["git", ...args], {
          ...toolOptions(runOptions),
          cwd: await projectDirectory(workspaceRoot, project),
        }),
    },
    gh: {
      run: async (args, runOptions = {}) =>
        runCommand(["gh", ...args], {
          ...toolOptions(runOptions),
          ...(runOptions.project === undefined
            ? {}
            : { cwd: await projectDirectory(workspaceRoot, runOptions.project) }),
        }),
    },
    output: {
      json: (value) => stdout.write(`${JSON.stringify(value, null, 2)}\n`),
      table: (rows) => stdout.write(`${formatTable(rows)}\n`),
      line: (text) => stdout.write(`${text}\n`),
      warn: (text) => stderr.write(`${text}\n`),
      progress: (text) => stderr.write(`${text}\n`),
    },
    prompt: {
      confirm,
      text: (question) => ask(question, promptStream),
    },
    applyPlan: <RESULT>(plan: OperationPlan<RESULT>, applyOptions: { yes?: boolean } = {}) =>
      applyPlan(plan, applyOptions.yes === true, promptStream, confirm),
    setExitCode: (code) => {
      process.exitCode = code;
    },
  };
}

async function applyPlan<RESULT>(
  plan: OperationPlan<RESULT>,
  yes: boolean,
  previewStream: TextStream,
  confirm: (question: string) => Promise<boolean>,
): Promise<OperationOutcome<RESULT>> {
  if (!yes) {
    previewStream.write(`${formatTable(plan.steps.map(planStepRow))}\n`);
    if (!(await confirm(plan.summary))) return { applied: false };
  }
  return { applied: true, result: await plan.apply() };
}

function planStepRow(step: OperationPlan<unknown>["steps"][number]) {
  return { action: step.action, target: step.target, detail: step.detail ?? "" };
}

function toolOptions(options: ToolRunOptions = {}) {
  const { allowFailure, stdin, timeoutMs } = options;
  return definedProperties({ allowFailure, stdin, timeoutMs });
}

/** A project checkout directory, refused when it is outside the workspace. */
async function projectDirectory(workspaceRoot: string, project: Project): Promise<string> {
  const directory = resolve(project.path);
  const inside =
    pathIsInside(workspaceRoot, directory) &&
    (!existsSync(directory) ||
      pathIsInside(await realpath(workspaceRoot), await realpath(directory)));
  if (!inside) throw new Error(`Refusing to run outside the Herakles Workspace: ${directory}`);
  return directory;
}
