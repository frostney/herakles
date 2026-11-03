/**
 * Public Herakles plugin API.
 *
 * Bundled plugins under `src/plugins/` and external plugins import only this
 * module. It has no runtime imports, so an external plugin can import it from
 * an installed `herakles/plugin` package, use type-only imports, or export a
 * plain object that matches `HeraklesPlugin`.
 */
import type { BaseArgs, CommandContext, TypedCommandParameters } from "@stricli/core";
import type { HeraklesConfig } from "../config/schema";
import type { Project, ValidationResult } from "../domain";

export type { HeraklesConfig, Project, ValidationResult };

/**
 * The plugin API version this Herakles build implements. Additive changes keep
 * the number; a removal or an incompatible change increments it.
 */
export const PLUGIN_API_VERSION = 1;

export type PluginFlags = Readonly<Record<string, unknown>>;

/**
 * One command a plugin contributes. `parameters` uses Stricli's parameter
 * vocabulary; Herakles adds `--root` and `--json` and builds the Stricli
 * command itself, so a plugin never needs its own copy of Stricli.
 */
export type PluginCommand<FLAGS extends PluginFlags, ARGS extends BaseArgs> = {
  readonly docs: PluginCommandDocs;
  readonly parameters: TypedCommandParameters<FLAGS, ARGS, CommandContext>;
  readonly func: (context: PluginContext, flags: FLAGS, ...args: ARGS) => void | Promise<void>;
};

export type PluginCommandDocs = { readonly brief: string; readonly fullDescription?: string };

/** A plugin command with its flag and positional types erased, as plugins export it. */
export type AnyPluginCommand = {
  readonly docs: PluginCommandDocs;
  readonly parameters: object;
  readonly func: (context: PluginContext, flags: any, ...args: any[]) => void | Promise<void>;
};

export type HeraklesPlugin = {
  /** Plugin API version the plugin was written against. */
  readonly apiVersion: number;
  /** Lowercase kebab-case name; must match the `[plugins.<name>]` config key. */
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  /**
   * Commands keyed by route path: `"name"` for a top-level command, or
   * `"group name"` to add a command to a core group such as `projects`, or to
   * a group the plugin owns.
   */
  readonly commands?: Readonly<Record<string, AnyPluginCommand>>;
};

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type ToolRunOptions = {
  /** Return a non-zero exit instead of throwing. */
  allowFailure?: boolean;
  stdin?: string;
  timeoutMs?: number;
};

/** One line of a repository operation plan, shown before confirmation. */
export type OperationStep = {
  readonly action: string;
  readonly target: string;
  readonly detail?: string;
};

/**
 * A typed repository operation. Herakles shows `steps`, asks for
 * confirmation unless the caller passes `yes`, and only then calls `apply`.
 */
export type OperationPlan<RESULT> = {
  readonly summary: string;
  readonly steps: readonly OperationStep[];
  readonly apply: () => Promise<RESULT>;
};

export type OperationOutcome<RESULT> =
  | { readonly applied: true; readonly result: RESULT }
  | { readonly applied: false };

/**
 * What a plugin command can reach. It exposes core services and output
 * helpers, not a generic shell or a config writer.
 */
export type PluginContext = {
  readonly plugin: { readonly name: string };
  /** True when the command was run with `--json`. */
  readonly json: boolean;
  readonly workspace: {
    readonly root: string;
    /** Ignored, plugin-owned generated state: `_herakles/cache/plugins/<name>`. */
    readonly cacheDir: string;
  };
  readonly projects: {
    list(): Promise<readonly Project[]>;
    /** Resolve a project by id, slug, or repository name; throws when unknown. */
    get(selector: string): Promise<Project>;
    validate(options?: { strict?: boolean }): Promise<ValidationResult>;
  };
  readonly config: {
    /** A detached copy of the parsed synced configuration. */
    read(): Promise<HeraklesConfig>;
  };
  readonly git: {
    /** Run `git` with an argument list inside a project checkout. */
    run(
      project: Project,
      args: readonly string[],
      options?: ToolRunOptions,
    ): Promise<CommandResult>;
  };
  readonly gh: {
    /** Run the GitHub CLI with an argument list, optionally inside a project checkout. */
    run(
      args: readonly string[],
      options?: ToolRunOptions & { project?: Project },
    ): Promise<CommandResult>;
  };
  readonly output: {
    /** Print a value as formatted JSON to stdout. */
    json(value: unknown): void;
    table(rows: readonly Record<string, unknown>[]): void;
    line(text: string): void;
    /** Diagnostics go to stderr so `--json` stdout stays parseable. */
    warn(text: string): void;
    progress(text: string): void;
  };
  readonly prompt: {
    /** Ask a yes/no question. Only `yes` confirms; closed input declines. */
    confirm(question: string): Promise<boolean>;
    /** Ask for text. Closed input returns an empty string. */
    text(question: string): Promise<string>;
  };
  /** Show a repository operation plan, confirm it unless `yes`, then apply it. */
  applyPlan<RESULT>(
    plan: OperationPlan<RESULT>,
    options?: { yes?: boolean },
  ): Promise<OperationOutcome<RESULT>>;
  setExitCode(code: number): void;
};

/** Type helper for a plugin definition; returns its argument unchanged. */
export function definePlugin<const PLUGIN extends HeraklesPlugin>(plugin: PLUGIN): PLUGIN {
  return plugin;
}

/** Type helper for a plugin command with explicit flag and positional types. */
export function defineCommand<
  FLAGS extends PluginFlags = NonNullable<unknown>,
  ARGS extends BaseArgs = [],
>(command: PluginCommand<FLAGS, ARGS>): PluginCommand<FLAGS, ARGS> {
  return command;
}
