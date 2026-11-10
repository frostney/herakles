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
import type { CanonicalPathPlan, Project, ValidationResult } from "../domain";
import type { RemoteFetchFailure, RemoteFetchResult } from "../up/fetch";

export type {
  CanonicalPathPlan,
  HeraklesConfig,
  Project,
  RemoteFetchFailure,
  RemoteFetchResult,
  ValidationResult,
};

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

/** What a confirmed canonical-path move did. */
export type CanonicalPathResult = CanonicalPathPlan & { readonly moved: true };

/**
 * A planned move of a hosted clone to its Canonical Checkout Path. It is an
 * `OperationPlan`, so it reaches disk only through `applyPlan`. `apply`
 * reloads the workspace and re-runs every check, so a path that changed since
 * planning is refused instead of moved over.
 */
export type CanonicalPathOperation = OperationPlan<CanonicalPathResult> & CanonicalPathPlan;

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
  readonly canonicalPath: {
    /**
     * Plan moving a hosted clone to its Canonical Checkout Path. Changes
     * nothing on disk. Throws when the project has no hosted clone path
     * mismatch, when the selector is ambiguous, or when a workspace
     * containment or destination check fails. Core owns these checks.
     */
    plan(selector: string): Promise<CanonicalPathOperation>;
  };
  readonly config: {
    /** A detached copy of the parsed synced configuration. */
    read(): Promise<HeraklesConfig>;
  };
  readonly git: {
    /**
     * Run `git` with an argument list in the project's checkout, derived from
     * synced config for its source and repository. The first argument must be
     * a subcommand, not a global option.
     */
    run(
      project: Project,
      args: readonly string[],
      options?: ToolRunOptions,
    ): Promise<CommandResult>;
    /**
     * Fetch the project's remotes the way `herakles up` does: the remotes
     * `git fetch --all` would, one after another, with `git fetch --prune`.
     * A remote that stays silent for `up.fetch_idle_timeout_seconds` is
     * stopped, and a remote that fails or is stopped does not stop the
     * others. Each one gets a failure whose message names the remote and,
     * when the output holds one, a Tailscale SSH check URL. Those failures
     * are returned; it throws when the checkout is missing, git cannot run,
     * or git cannot list the remotes or read their `remote.<name>.skipFetchAll`
     * settings.
     * `trackingRemote` is fetched even when that setting is true, and last.
     */
    fetchRemotes(
      project: Project,
      options?: { trackingRemote?: string },
    ): Promise<RemoteFetchResult>;
  };
  readonly gh: {
    /** Run the GitHub CLI with an argument list, optionally in a project's checkout. */
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
