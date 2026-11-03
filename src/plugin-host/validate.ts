import { kebabCasePattern, pluginNameSchema } from "../config/schema";
import { errorMessage } from "../utils/errors";
import { type AnyPluginCommand, type HeraklesPlugin, PLUGIN_API_VERSION } from "./api";

export type PluginProblem =
  | "unknown-plugin"
  | "invalid-config"
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

/**
 * Check an untrusted plugin export against the plugin API and return a plain
 * snapshot of it. Every read of the export happens here, inside one guard, so
 * a throwing getter or a hostile Proxy fails only this plugin. The API version
 * is checked first so a plugin written for another API reports as
 * incompatible rather than as malformed.
 */
export function checkPlugin(value: unknown, expectedName: string): PluginCheck {
  try {
    return snapshotPlugin(value, expectedName);
  } catch (error) {
    return invalid(`Reading the plugin export failed: ${errorMessage(error)}`);
  }
}

/** Split a command path such as `projects sync` into validated route segments. */
export function commandPathSegments(path: string): string[] | undefined {
  const segments = path.split(" ");
  if (segments.length < 1 || segments.length > 2) return undefined;
  return segments.every((segment) => kebabCasePattern.test(segment)) ? segments : undefined;
}

function snapshotPlugin(value: unknown, expectedName: string): PluginCheck {
  if (!isRecord(value)) return invalid("The plugin module has no default export object.");
  const apiVersion = value.apiVersion;
  if (typeof apiVersion !== "number") return invalid("The plugin does not declare apiVersion.");
  if (apiVersion !== PLUGIN_API_VERSION) {
    return {
      ok: false,
      problem: "incompatible-api",
      message: `The plugin targets plugin API ${apiVersion}; this Herakles supports plugin API ${PLUGIN_API_VERSION}.`,
    };
  }
  const name = value.name;
  if (typeof name !== "string" || !pluginNameSchema.safeParse(name).success) {
    return invalid("The plugin name must be lowercase kebab-case.");
  }
  if (name !== expectedName) {
    return invalid(`The plugin declares name ${name} but is configured as ${expectedName}.`);
  }
  const version = optionalText(value.version, "version");
  const description = optionalText(value.description, "description");
  const commands = snapshotCommands(value.commands);
  for (const result of [version, description, commands]) {
    if (result instanceof Problem) return invalid(result.message);
  }
  return {
    ok: true,
    plugin: {
      apiVersion,
      name,
      ...(typeof version === "string" ? { version } : {}),
      ...(typeof description === "string" ? { description } : {}),
      commands: commands as Record<string, AnyPluginCommand>,
    },
  };
}

class Problem {
  constructor(readonly message: string) {}
}

function optionalText(value: unknown, key: string): string | undefined | Problem {
  if (value === undefined || typeof value === "string") return value;
  return new Problem(`The plugin ${key} must be a string.`);
}

function snapshotCommands(commands: unknown): Record<string, AnyPluginCommand> | Problem {
  if (commands === undefined) return {};
  if (!isRecord(commands)) {
    return new Problem("The plugin commands must be an object keyed by command path.");
  }
  const snapshot: Record<string, AnyPluginCommand> = {};
  for (const [path, command] of Object.entries(commands)) {
    if (!commandPathSegments(path)) {
      return new Problem(`Command path "${path}" must be one or two lowercase kebab-case words.`);
    }
    const result = snapshotCommand(command);
    if (typeof result === "string") return new Problem(`Command "${path}": ${result}`);
    snapshot[path] = result;
  }
  return snapshot;
}

function snapshotCommand(command: unknown): AnyPluginCommand | string {
  if (!isRecord(command)) return "must be an object.";
  const docs = command.docs;
  if (!isRecord(docs) || typeof docs.brief !== "string") return "docs.brief must be a string.";
  const fullDescription = docs.fullDescription;
  if (fullDescription !== undefined && typeof fullDescription !== "string") {
    return "docs.fullDescription must be a string.";
  }
  const parameters = command.parameters;
  if (!isRecord(parameters)) return "parameters must be an object.";
  const func = command.func;
  if (typeof func !== "function") return "func must be a function.";
  const flags = parameters.flags;
  if (flags !== undefined && !isRecord(flags)) return "parameters.flags must be an object.";
  const reserved = reservedPluginFlags.find(
    (flag) => flags !== undefined && Object.hasOwn(flags, flag),
  );
  if (reserved) return `--${reserved} is reserved by Herakles.`;
  return {
    docs: { brief: docs.brief, ...(fullDescription === undefined ? {} : { fullDescription }) },
    parameters,
    func: func as AnyPluginCommand["func"],
  };
}

function invalid(message: string): PluginCheck {
  return { ok: false, problem: "invalid-plugin", message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
