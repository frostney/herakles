import { buildCommand, buildRouteMap, type Command, type CommandContext } from "@stricli/core";
import { ZodError } from "zod";
import { loadConfig } from "../config/load";
import { HeraklesWorkspaceNotFoundError, selectHeraklesWorkspace } from "../config/workspace";
import type { HeraklesPlugin } from "../plugin-host/api";
import { loadPlugins, type PluginRegistry } from "../plugin-host/load";
import type { CoreCommandTree, MountedPluginCommand } from "../plugin-host/mount";
import { booleanFlag, optionalFlag } from "./flags";
import { createPluginContext } from "./pluginContext";

/**
 * Plugin state for one CLI run. `skipped` means the invoked route is a core
 * command that does not need plugins, so no plugin code was imported.
 */
export type CliPlugins =
  | { kind: "skipped" }
  | { kind: "unavailable"; error: unknown }
  | { kind: "loaded"; workspaceRoot: string; registry: PluginRegistry };

const helpFlags = new Set(["--help", "-h", "--help-all", "-H"]);

/** Core routes that report plugin status and therefore always load plugins. */
const statusRoutes = new Set(["doctor", "plugins"]);

export async function loadCliPlugins(
  args: readonly string[],
  core: CoreCommandTree,
  options: { bundled?: readonly HeraklesPlugin[]; stderr?: { write(text: string): unknown } } = {},
): Promise<CliPlugins> {
  if (!routeNeedsPlugins(args, core)) return { kind: "skipped" };
  const stderr = options.stderr ?? process.stderr;
  const reportsStatus = statusRoutes.has(routeTokens(args)[0] ?? "");
  let workspaceRoot: string;
  let registry: PluginRegistry;
  try {
    workspaceRoot = selectHeraklesWorkspace(explicitRoot(args));
    const loaded = await loadConfig(workspaceRoot);
    registry = await loadPlugins(loaded, {
      core,
      checkCommands: stricliProblem,
      ...(options.bundled === undefined ? {} : { bundled: options.bundled }),
    });
  } catch (error) {
    // Status routes rethrow the error themselves; outside a workspace there is nothing to report.
    if (!reportsStatus && !(error instanceof HeraklesWorkspaceNotFoundError)) {
      stderr.write(`herakles: plugins not loaded: ${loadErrorMessage(error)}\n`);
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
 * status. Core commands skip plugin loading entirely, so a broken plugin
 * cannot affect them. A bare core group runs its core default command, so it
 * loads plugins only to list their group commands in help.
 */
export function routeNeedsPlugins(args: readonly string[], core: CoreCommandTree): boolean {
  const [first, second] = routeTokens(args);
  if (first === undefined || statusRoutes.has(first)) return true;
  if (core.commands.includes(first)) return false;
  if (!Object.hasOwn(core.groups, first)) return true;
  if (second === undefined) return args.some((arg) => helpFlags.has(arg));
  return !core.groups[first]!.includes(second);
}

/** Build a plugin's Stricli commands once so parameters Stricli rejects fail that plugin only. */
function stricliProblem(plugin: HeraklesPlugin): string | undefined {
  for (const [path, command] of Object.entries(plugin.commands ?? {})) {
    try {
      buildPluginCommand({ plugin, path: [path], command }, "");
    } catch (error) {
      return `Command "${path}": ${loadErrorMessage(error)}`;
    }
  }
  return undefined;
}

function loadErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "(top level)"}: ${issue.message}`)
      .join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

function routeTokens(args: readonly string[]): string[] {
  const end = args.findIndex((arg) => arg.startsWith("-"));
  return end === -1 ? [...args] : args.slice(0, end);
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
  const topLevel = new Map<string, Command<CommandContext>>();
  const grouped = new Map<string, Map<string, Command<CommandContext>>>();
  const groupBriefs = new Map<string, string>();
  if (plugins.kind !== "loaded") return { topLevel, grouped, groupBriefs };
  for (const mounted of plugins.registry.commands) {
    const command = buildPluginCommand(mounted, plugins.workspaceRoot);
    const [first, second] = mounted.path;
    if (second === undefined) {
      topLevel.set(first, command);
      continue;
    }
    const group = grouped.get(first) ?? new Map();
    grouped.set(first, group.set(second, command));
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
export function pluginGroupRoute(
  brief: string,
  routes: ReadonlyMap<string, Command<CommandContext>>,
) {
  return buildRouteMap({ docs: { brief }, routes: Object.fromEntries(routes) });
}

function buildPluginCommand(mounted: MountedPluginCommand, workspaceRoot: string) {
  const { command, plugin } = mounted;
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
