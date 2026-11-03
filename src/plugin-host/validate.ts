import { pluginNameSchema } from "../config/schema";
import { type HeraklesPlugin, PLUGIN_API_VERSION } from "./api";

export type PluginProblem =
  | "unknown-plugin"
  | "invalid-source"
  | "missing-entry"
  | "load-error"
  | "invalid-plugin"
  | "incompatible-api"
  | "command-collision";

export type PluginCheck =
  | { ok: true; plugin: HeraklesPlugin }
  | { ok: false; problem: PluginProblem; message: string };

/** Flags Herakles adds to every plugin command. */
const reservedPluginFlags = ["root", "json"] as const;

const routeSegmentPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * Check an untrusted plugin value against the plugin API. The API version is
 * checked first so a plugin written for another API reports as incompatible
 * rather than as malformed.
 */
export function checkPlugin(value: unknown, expectedName: string): PluginCheck {
  if (!isRecord(value)) return invalid("The plugin module has no default export object.");
  if (typeof value.apiVersion !== "number")
    return invalid("The plugin does not declare apiVersion.");
  if (value.apiVersion !== PLUGIN_API_VERSION) {
    return {
      ok: false,
      problem: "incompatible-api",
      message: `The plugin targets plugin API ${value.apiVersion}; this Herakles supports plugin API ${PLUGIN_API_VERSION}.`,
    };
  }
  if (typeof value.name !== "string" || !pluginNameSchema.safeParse(value.name).success) {
    return invalid("The plugin name must be lowercase kebab-case.");
  }
  if (value.name !== expectedName) {
    return invalid(`The plugin declares name ${value.name} but is configured as ${expectedName}.`);
  }
  const optionalText = checkOptionalText(value);
  if (optionalText) return invalid(optionalText);
  const commandProblem = checkCommands(value.commands);
  if (commandProblem) return invalid(commandProblem);
  return { ok: true, plugin: value as HeraklesPlugin };
}

/** Split a command path such as `projects sync` into validated route segments. */
export function commandPathSegments(path: string): string[] | undefined {
  const segments = path.split(" ");
  if (segments.length < 1 || segments.length > 2) return undefined;
  return segments.every((segment) => routeSegmentPattern.test(segment)) ? segments : undefined;
}

function checkOptionalText(value: Record<string, unknown>): string | undefined {
  for (const key of ["version", "description"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "string") {
      return `The plugin ${key} must be a string.`;
    }
  }
  return undefined;
}

function checkCommands(commands: unknown): string | undefined {
  if (commands === undefined) return undefined;
  if (!isRecord(commands)) return "The plugin commands must be an object keyed by command path.";
  for (const [path, command] of Object.entries(commands)) {
    if (!commandPathSegments(path)) {
      return `Command path "${path}" must be one or two lowercase kebab-case words.`;
    }
    const problem = checkCommand(command);
    if (problem) return `Command "${path}": ${problem}`;
  }
  return undefined;
}

function checkCommand(command: unknown): string | undefined {
  if (!isRecord(command)) return "must be an object.";
  if (!isRecord(command.docs) || typeof command.docs.brief !== "string") {
    return "docs.brief must be a string.";
  }
  if (!isRecord(command.parameters)) return "parameters must be an object.";
  if (typeof command.func !== "function") return "func must be a function.";
  const flags = command.parameters.flags;
  if (flags !== undefined && !isRecord(flags)) return "parameters.flags must be an object.";
  const reserved = reservedPluginFlags.find((flag) => flags !== undefined && flag in flags);
  return reserved ? `--${reserved} is reserved by Herakles.` : undefined;
}

function invalid(message: string): PluginCheck {
  return { ok: false, problem: "invalid-plugin", message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
