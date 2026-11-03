import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import type { LoadedConfig } from "../config/load";
import { pathIsInside, resolveInside } from "../config/paths";
import { type PluginConfig, pluginEntrySchema, pluginNameSchema } from "../config/schema";
import { bundledPlugins } from "../plugins";
import { configuredCheckoutPath } from "../project/resolve";
import { errorMessage } from "../utils/errors";
import type { AnyPluginCommand, HeraklesPlugin } from "./api";
import { type CoreCommandTree, type MountedPluginCommand, PluginRouteTable } from "./mount";
import { checkPlugin, type PluginProblem } from "./validate";

export type PluginSource =
  | { kind: "bundled" }
  /** A `[plugins]` entry that names no bundled plugin and no usable external source. */
  | { kind: "unknown" }
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

/** A mounted plugin command plus what the surface built from it. */
export type LoadedPluginCommand<BUILT> = MountedPluginCommand & { built: BUILT };

export type PluginRegistry<BUILT = undefined> = {
  statuses: PluginStatus[];
  commands: LoadedPluginCommand<BUILT>[];
};

/**
 * Builds a surface command, such as a Stricli command, from a checked plugin
 * command. A throw fails that plugin only.
 */
export type PluginCommandBuilder<BUILT> = (
  plugin: HeraklesPlugin,
  path: string,
  command: AnyPluginCommand,
) => BUILT;

type Candidate = { status: PluginStatus; plugin: unknown; ignoredKeys: string[] };
type Outcome = Candidate | { status: PluginStatus };
type Entry =
  | { ok: true; config: PluginConfig; ignoredKeys: string[] }
  | { ok: false; message: string };

const knownEntryKeys = new Set(["enabled", "project", "entry"]);

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
 * Resolve, import, check, build and mount the plugins `_herakles/herakles.toml`
 * enables. Never throws: every plugin failure, including a malformed
 * `[plugins]` entry, becomes that plugin's status so core commands keep working.
 */
export async function loadPlugins<BUILT = undefined>(
  loaded: LoadedConfig,
  options: {
    core: CoreCommandTree;
    bundled?: readonly HeraklesPlugin[];
    build?: PluginCommandBuilder<BUILT>;
  },
): Promise<PluginRegistry<BUILT>> {
  const bundled = options.bundled ?? bundledPlugins;
  const bundledNames = new Set(bundled.map((plugin) => plugin.name));
  const configured = loaded.config.plugins;
  const outcomes: Outcome[] = [];
  for (const plugin of bundled) {
    outcomes.push(bundledOutcome(plugin, configuredEntry(configured, plugin.name)));
  }
  const externalNames = Object.keys(configured)
    .filter((name) => !bundledNames.has(name))
    .sort();
  for (const name of externalNames) {
    outcomes.push(await externalOutcome(loaded, name, configured[name]));
  }
  const commands = mountCandidates(
    outcomes.filter((outcome): outcome is Candidate => "plugin" in outcome),
    options,
  );
  for (const outcome of outcomes) {
    if ("ignoredKeys" in outcome && outcome.ignoredKeys.length > 0) {
      outcome.status.message += ` Ignored unknown config keys: ${outcome.ignoredKeys.join(", ")}.`;
    }
  }
  return { statuses: outcomes.map((outcome) => outcome.status), commands };
}

function configuredEntry(configured: Record<string, unknown>, name: string): Entry | undefined {
  return Object.hasOwn(configured, name) ? parseEntry(configured[name]) : undefined;
}

function parseEntry(raw: unknown): Entry {
  const parsed = pluginEntrySchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, message: `Invalid config: ${errorMessage(parsed.error)}` };
  const ignoredKeys = Object.keys(raw as object).filter((key) => !knownEntryKeys.has(key));
  return { ok: true, config: parsed.data, ignoredKeys };
}

function bundledOutcome(plugin: HeraklesPlugin, entry: Entry | undefined): Outcome {
  const status = baseStatus(plugin.name, { kind: "bundled" }, entry !== undefined);
  if (entry === undefined) {
    return disabled(status, plugin, `Not enabled; add [plugins.${plugin.name}] to enable it.`);
  }
  if (!entry.ok) return failed(status, "invalid-config", entry.message);
  if (entry.config.project !== undefined) {
    return failed(status, "invalid-source", `${plugin.name} is a bundled plugin name.`);
  }
  if (!entry.config.enabled) {
    return { ...disabled(status, plugin, "Disabled in config."), ignoredKeys: entry.ignoredKeys };
  }
  return { status, plugin, ignoredKeys: entry.ignoredKeys };
}

async function externalOutcome(loaded: LoadedConfig, name: string, raw: unknown): Promise<Outcome> {
  const unknownStatus = baseStatus(name, { kind: "unknown" });
  if (!pluginNameSchema.safeParse(name).success) {
    return failed(unknownStatus, "invalid-config", "Plugin names must be lowercase kebab-case.");
  }
  const entry = parseEntry(raw);
  if (!entry.ok) return failed(unknownStatus, "invalid-config", entry.message);
  const { config, ignoredKeys } = entry;
  if (config.project === undefined || config.entry === undefined) {
    return failed(
      unknownStatus,
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
  if (!config.enabled) {
    return {
      status: { ...status, state: "disabled", message: "Disabled in config." },
      ignoredKeys,
    };
  }
  try {
    const path = await externalEntryPath(loaded, config.project, config.entry);
    source.path = path;
    const { exported } = await importDefault(path);
    return { status, plugin: exported, ignoredKeys };
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
  if (!existsSync(projectPath)) throw missingProject(loaded, project, projectPath);
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

function missingProject(loaded: LoadedConfig, project: string, projectPath: string) {
  const message =
    loaded.config.project[project]?.source === "local"
      ? `Local project ${project} is not at its derived path ${projectPath}; a local plugin project must live there.`
      : `Project ${project} is not checked out at ${projectPath}; run herakles up.`;
  return new PluginLoadError("missing-entry", message);
}

/**
 * Import an entry's default export. The export is boxed so a promise never
 * probes it for `then`, which would run a hostile getter outside the check.
 */
async function importDefault(path: string): Promise<{ exported: unknown }> {
  try {
    const module = (await import(path)) as { default?: unknown };
    return { exported: module.default };
  } catch (error) {
    throw new PluginLoadError("load-error", `Failed to load: ${errorMessage(error)}`, path);
  }
}

function mountCandidates<BUILT>(
  candidates: Candidate[],
  options: { core: CoreCommandTree; build?: PluginCommandBuilder<BUILT> },
): LoadedPluginCommand<BUILT>[] {
  const routes = new PluginRouteTable(options.core);
  const mounted: LoadedPluginCommand<BUILT>[] = [];
  for (const candidate of candidates) {
    const check = checkPlugin(candidate.plugin, candidate.status.name);
    if (!check.ok) {
      Object.assign(
        candidate.status,
        failed(candidate.status, check.problem, check.message).status,
      );
      continue;
    }
    Object.assign(candidate.status, describe(check.plugin));
    const built = buildCommands(check.plugin, options.build);
    if (typeof built === "string") {
      Object.assign(candidate.status, failed(candidate.status, "invalid-plugin", built).status);
      continue;
    }
    const mount = routes.mount(check.plugin);
    if (!mount.ok) {
      Object.assign(
        candidate.status,
        failed(candidate.status, "command-collision", mount.message).status,
      );
      continue;
    }
    for (const command of mount.commands) {
      mounted.push({ ...command, built: built.get(command.path.join(" ")) as BUILT });
    }
    candidate.status.commands = mount.commands.map((command) => command.path.join(" "));
    candidate.status.state = "loaded";
    candidate.status.message = `Loaded ${candidate.status.commands.length} command(s).`;
  }
  return mounted;
}

/** Build every command of a plugin once; a failure message fails the plugin. */
function buildCommands<BUILT>(
  plugin: HeraklesPlugin,
  build: PluginCommandBuilder<BUILT> | undefined,
): Map<string, BUILT> | string {
  const built = new Map<string, BUILT>();
  if (!build) return built;
  for (const [path, command] of Object.entries(plugin.commands ?? {})) {
    try {
      built.set(path, build(plugin, path, command));
    } catch (error) {
      return `Command "${path}": ${errorMessage(error)}`;
    }
  }
  return built;
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

function disabled(status: PluginStatus, plugin: HeraklesPlugin, message: string) {
  return { status: { ...status, ...describe(plugin), state: "disabled" as const, message } };
}

function failed(status: PluginStatus, problem: PluginProblem, message: string) {
  return { status: { ...status, state: "failed" as const, problem, message } };
}
