import { buildCommand, buildRouteMap, type Command, type CommandContext } from "@stricli/core";
import { loadConfig } from "../config/load";
import { HeraklesWorkspaceNotFoundError, selectHeraklesWorkspace } from "../config/workspace";
import type { AnyPluginCommand, HeraklesPlugin } from "../plugin-host/api";
import { loadPlugins, type PluginRegistry } from "../plugin-host/load";
import type { CoreCommandTree } from "../plugin-host/mount";
import { errorMessage } from "../utils/errors";
import { booleanFlag, optionalFlag } from "./flags";
import { createPluginContext } from "./pluginContext";

type StricliCommand = Command<CommandContext>;

/**
 * Plugin state for one CLI run. `skipped` means the invoked route is a core
 * command that does not need plugins, so no plugin code was imported.
 */
export type CliPlugins =
  | { kind: "skipped" }
  | { kind: "unavailable"; error: unknown }
  | { kind: "loaded"; workspaceRoot: string; registry: PluginRegistry<StricliCommand> };

/** Core routes that report plugin status and therefore always load plugins. */
const statusRoutes = new Set(["doctor", "plugins"]);
const helpFlags = new Set(["--help", "-h", "--help-all", "-H"]);
const versionFlags = new Set(["--version", "-v"]);
/** Global flags that take a value, so the value is not mistaken for a route word. */
const valueFlags = new Set(["--root"]);

export async function loadCliPlugins(
  args: readonly string[],
  core: CoreCommandTree,
  options: { bundled?: readonly HeraklesPlugin[]; stderr?: { write(text: string): unknown } } = {},
): Promise<CliPlugins> {
  if (!routeNeedsPlugins(args, core)) return { kind: "skipped" };
  const stderr = options.stderr ?? process.stderr;
  const reportsStatus = statusRoutes.has(routeWords(args)[0] ?? "");
  let workspaceRoot: string;
  let registry: PluginRegistry<StricliCommand>;
  try {
    workspaceRoot = selectHeraklesWorkspace(explicitRoot(args));
    const loaded = await loadConfig(workspaceRoot);
    const root = workspaceRoot;
    registry = await loadPlugins(loaded, {
      core,
      build: (plugin, _path, command) => buildPluginCommand(plugin, command, root),
      ...(options.bundled === undefined ? {} : { bundled: options.bundled }),
    });
  } catch (error) {
    // Status routes rethrow the error themselves; outside a workspace there is nothing to report.
    if (!reportsStatus && !(error instanceof HeraklesWorkspaceNotFoundError)) {
      stderr.write(`herakles: plugins not loaded: ${errorMessage(error)}\n`);
    }
    return { kind: "unavailable", error };
  }
  if (!reportsStatus) {
    for (const status of registry.statuses.filter((entry) => entry.state === "failed")) {
      stderr.write(`herakles: plugin ${status.name} not loaded: ${status.message}\n`);
    }
  }
  return { kind: "loaded", workspaceRoot, registry };
}

/**
 * Whether the invoked route could reach a plugin command or report plugin
 * status. Core commands, `--version`, and a bare core group running its core
 * default command skip plugin loading entirely, so a broken plugin cannot
 * affect them. Flags between route words do not change the route.
 */
export function routeNeedsPlugins(args: readonly string[], core: CoreCommandTree): boolean {
  const [first, second] = routeWords(args);
  if (first === undefined) return !args.some((arg) => versionFlags.has(arg));
  if (statusRoutes.has(first)) return true;
  if (core.commands.includes(first)) return false;
  if (!Object.hasOwn(core.groups, first)) return true;
  if (second === undefined) return args.some((arg) => helpFlags.has(arg));
  return !core.groups[first]!.includes(second);
}

/** The first two non-flag words, skipping values of global flags such as `--root`. */
function routeWords(args: readonly string[]): string[] {
  const words: string[] = [];
  for (let index = 0; index < args.length && words.length < 2; index += 1) {
    const arg = args[index]!;
    if (arg === "--") break;
    if (valueFlags.has(arg)) index += 1;
    else if (!arg.startsWith("-")) words.push(arg);
  }
  return words;
}

function explicitRoot(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--root") return args[index + 1];
    if (arg.startsWith("--root=")) return arg.slice("--root=".length);
  }
  return undefined;
}

/** Stricli commands for the mounted plugin commands, grouped by route. */
export function pluginRoutes(plugins: CliPlugins) {
  const topLevel = new Map<string, StricliCommand>();
  const grouped = new Map<string, Map<string, StricliCommand>>();
  const groupBriefs = new Map<string, string>();
  if (plugins.kind !== "loaded") return { topLevel, grouped, groupBriefs };
  for (const mounted of plugins.registry.commands) {
    const [first, second] = mounted.path;
    if (second === undefined) {
      topLevel.set(first, mounted.built);
      continue;
    }
    const group = grouped.get(first) ?? new Map();
    grouped.set(first, group.set(second, mounted.built));
    if (!groupBriefs.has(first)) {
      groupBriefs.set(
        first,
        mounted.plugin.description ?? `Commands from the ${mounted.plugin.name} plugin.`,
      );
    }
  }
  return { topLevel, grouped, groupBriefs };
}

/** A route map for a group a plugin owns. */
export function pluginGroupRoute(brief: string, routes: ReadonlyMap<string, StricliCommand>) {
  return buildRouteMap({ docs: { brief }, routes: Object.fromEntries(routes) });
}

/** Build the Stricli command for a plugin command; Stricli rejections throw here. */
function buildPluginCommand(
  plugin: HeraklesPlugin,
  command: AnyPluginCommand,
  workspaceRoot: string,
): StricliCommand {
  const parameters = command.parameters as { flags?: Record<string, unknown> };
  return buildCommand<Record<string, unknown>, unknown[]>({
    docs: command.docs,
    parameters: {
      ...(command.parameters as object),
      flags: {
        ...parameters.flags,
        root: optionalFlag(String, "Workspace root containing _herakles/herakles.toml.", "path"),
        json: booleanFlag("Print JSON output."),
      },
    } as never,
    async func(this: CommandContext, flags, ...args) {
      const { root: _root, json, ...ownFlags } = flags;
      const context = createPluginContext({
        pluginName: plugin.name,
        workspaceRoot,
        json: json === true,
        stdout: this.process.stdout,
        stderr: this.process.stderr,
      });
      await command.func(context, ownFlags, ...args);
    },
  });
}
