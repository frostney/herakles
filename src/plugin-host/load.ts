import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import type { LoadedConfig } from "../config/load";
import { pathIsInside, resolveInside } from "../config/paths";
import type { PluginConfig } from "../config/schema";
import { bundledPlugins } from "../plugins";
import { configuredCheckoutPath } from "../project/resolve";
import type { HeraklesPlugin } from "./api";
import { type CoreCommandTree, type MountedPluginCommand, PluginRouteTable } from "./mount";
import { checkPlugin, type PluginCheck, type PluginProblem } from "./validate";

export type PluginSource =
  | { kind: "bundled" }
  | {
      kind: "project";
      project: string;
      entry: string;
      /** Resolved entry file, when Herakles got far enough to find it. */
      path?: string;
    };

export type PluginStatus = {
  name: string;
  source: PluginSource;
  state: "loaded" | "disabled" | "failed";
  /** Whether `_herakles/herakles.toml` names the plugin in `[plugins]`. */
  configured: boolean;
  problem?: PluginProblem;
  message: string;
  version?: string;
  description?: string;
  /** Mounted command paths, such as `projects sync`. */
  commands: string[];
};

export type PluginRegistry = {
  statuses: PluginStatus[];
  commands: MountedPluginCommand[];
};

type Candidate = { status: PluginStatus; plugin: unknown };

class PluginLoadError extends Error {
  constructor(
    readonly problem: PluginProblem,
    message: string,
    readonly path?: string,
  ) {
    super(message);
  }
}

/**
 * Resolve, import, check and mount the plugins `_herakles/herakles.toml`
 * enables. Never throws: every plugin failure becomes a status so core
 * commands keep working.
 */
export async function loadPlugins(
  loaded: LoadedConfig,
  options: {
    core: CoreCommandTree;
    bundled?: readonly HeraklesPlugin[];
    /** Surface-specific command check, such as building the Stricli commands. */
    checkCommands?: (plugin: HeraklesPlugin) => string | undefined;
  },
): Promise<PluginRegistry> {
  const bundled = options.bundled ?? bundledPlugins;
  const bundledNames = new Set(bundled.map((plugin) => plugin.name));
  const configured = loaded.config.plugins;
  const statuses: PluginStatus[] = [];
  const candidates: Candidate[] = [];
  for (const plugin of bundled) {
    const result = bundledCandidate(plugin, configured[plugin.name]);
    if ("plugin" in result) candidates.push(result);
    statuses.push(result.status);
  }
  const externalNames = Object.keys(configured)
    .filter((name) => !bundledNames.has(name))
    .sort();
  for (const name of externalNames) {
    const result = await externalCandidate(loaded, name, configured[name]!);
    if ("plugin" in result) candidates.push(result);
    statuses.push(result.status);
  }
  return { statuses, commands: mountCandidates(candidates, options) };
}

function bundledCandidate(
  plugin: HeraklesPlugin,
  config: PluginConfig | undefined,
): Candidate | { status: PluginStatus } {
  const status = baseStatus(plugin.name, { kind: "bundled" }, config !== undefined);
  if (config?.project !== undefined) {
    return failed(status, "invalid-source", `${plugin.name} is a bundled plugin name.`);
  }
  if (config === undefined || !config.enabled) {
    return {
      status: {
        ...status,
        ...describe(plugin),
        state: "disabled",
        message:
          config === undefined
            ? `Not enabled; add [plugins.${plugin.name}] to enable it.`
            : "Disabled in config.",
      },
    };
  }
  return { status, plugin };
}

async function externalCandidate(
  loaded: LoadedConfig,
  name: string,
  config: PluginConfig,
): Promise<Candidate | { status: PluginStatus }> {
  if (config.project === undefined || config.entry === undefined) {
    return failed(
      baseStatus(name, { kind: "bundled" }),
      "unknown-plugin",
      `No bundled plugin is named ${name}; an external plugin needs project and entry.`,
    );
  }
  const source: Extract<PluginSource, { kind: "project" }> = {
    kind: "project",
    project: config.project,
    entry: config.entry,
  };
  const status = baseStatus(name, source);
  if (!config.enabled)
    return { status: { ...status, state: "disabled", message: "Disabled in config." } };
  try {
    const path = await externalEntryPath(loaded, config.project, config.entry);
    source.path = path;
    return { status, plugin: await importDefault(path) };
  } catch (error) {
    if (!(error instanceof PluginLoadError)) {
      return failed(status, "invalid-source", errorMessage(error));
    }
    if (error.path) source.path = error.path;
    return failed(status, error.problem, error.message);
  }
}

async function externalEntryPath(loaded: LoadedConfig, project: string, entry: string) {
  let projectPath: string;
  try {
    projectPath = configuredCheckoutPath(loaded, project);
  } catch (error) {
    throw new PluginLoadError("invalid-source", errorMessage(error));
  }
  if (!existsSync(projectPath)) {
    throw new PluginLoadError(
      "missing-entry",
      `Project ${project} is not checked out at ${projectPath}; run herakles up.`,
    );
  }
  const entryPath = resolveInside(projectPath, entry);
  if (!existsSync(entryPath)) {
    throw new PluginLoadError("missing-entry", `Plugin entry not found: ${entryPath}`, entryPath);
  }
  const [realProject, realEntry] = await Promise.all([realpath(projectPath), realpath(entryPath)]);
  if (!pathIsInside(realProject, realEntry)) {
    throw new PluginLoadError(
      "invalid-source",
      `Plugin entry resolves outside project ${project}: ${realEntry}`,
      entryPath,
    );
  }
  return realEntry;
}

async function importDefault(path: string): Promise<unknown> {
  try {
    const module = (await import(path)) as { default?: unknown };
    return module.default;
  } catch (error) {
    throw new PluginLoadError("load-error", `Failed to load: ${errorMessage(error)}`, path);
  }
}

function mountCandidates(
  candidates: Candidate[],
  options: {
    core: CoreCommandTree;
    checkCommands?: (plugin: HeraklesPlugin) => string | undefined;
  },
): MountedPluginCommand[] {
  const routes = new PluginRouteTable(options.core);
  const mounted: MountedPluginCommand[] = [];
  for (const candidate of candidates) {
    const check = checkCandidate(candidate, options.checkCommands);
    if (!check.ok) {
      Object.assign(
        candidate.status,
        failed(candidate.status, check.problem, check.message).status,
      );
      continue;
    }
    Object.assign(candidate.status, describe(check.plugin));
    const mount = routes.mount(check.plugin);
    if (!mount.ok) {
      Object.assign(
        candidate.status,
        failed(candidate.status, "command-collision", mount.message).status,
      );
      continue;
    }
    mounted.push(...mount.commands);
    candidate.status.commands = mount.commands.map((command) => command.path.join(" "));
    candidate.status.state = "loaded";
    candidate.status.message = `Loaded ${candidate.status.commands.length} command(s).`;
  }
  return mounted;
}

function checkCandidate(
  candidate: Candidate,
  checkCommands: ((plugin: HeraklesPlugin) => string | undefined) | undefined,
): PluginCheck {
  const check = checkPlugin(candidate.plugin, candidate.status.name);
  if (!check.ok || !checkCommands) return check;
  const problem = checkCommands(check.plugin);
  return problem ? { ok: false, problem: "invalid-plugin", message: problem } : check;
}

function baseStatus(name: string, source: PluginSource, configured = true): PluginStatus {
  return { name, source, state: "failed", configured, message: "", commands: [] };
}

function describe(plugin: HeraklesPlugin): Pick<PluginStatus, "version" | "description"> {
  return {
    ...(typeof plugin.version === "string" ? { version: plugin.version } : {}),
    ...(typeof plugin.description === "string" ? { description: plugin.description } : {}),
  };
}

function failed(status: PluginStatus, problem: PluginProblem, message: string) {
  return { status: { ...status, state: "failed" as const, problem, message } };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
