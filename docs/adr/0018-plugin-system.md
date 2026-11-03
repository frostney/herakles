# Plugin System

Optional Herakles features ship as plugins instead of growing core. Core keeps the workspace configuration, projects, `up`, `validate`, `doctor` and Config Exchange. Pull request review, canonical-path fixing, default-branch sync and worktree pruning move into first-party plugins in later changes.

There are two kinds of plugin:

- **Bundled plugins** are compiled into the Herakles executable and listed in `src/plugins/index.ts`.
- **External plugins** are loaded from disk at runtime, from a tracked project in the Herakles Workspace.

Both kinds use the same typed plugin API and reach core only through it.

## Configuration

Plugins are switched on in `_herakles/herakles.toml`, the only synced configuration ([ADR 0003](0003-synced-config-bootstraps-machines.md)):

```toml
# A bundled plugin: the table alone enables it.
[plugins.pull-requests]

# Keep the entry but turn the plugin off.
[plugins.prune-worktrees]
enabled = false

# An external plugin: a tracked project and a file inside it.
[plugins.release-notes]
project = "example-herakles-release-notes"
entry = "src/plugin.ts"
```

**Bundled plugins are off until enabled.** Opt-out would make every new bundled plugin appear on every machine with the next release, including ones that mutate repositories. Opt-in keeps the default command surface at core and makes the synced file a complete record of the features in use. The cost is one config line per feature and less discovery, so `herakles plugins list` shows every bundled plugin with the line that enables it. Nothing is lost by the change: the features moving into plugins were Workbench actions or unreleased CLI commands, and 3.0.0 is breaking anyway.

**External plugins are referenced by tracked project and project-relative entry.** The synced config must work on every machine, so it cannot hold an absolute path. Herakles derives the plugin's location from the project's Canonical Checkout Path, so `up` on a new machine also brings the plugin. The derivation uses synced config alone, without reading GitHub on every start: lifecycle folder, group and repository name come from the tracked project config. A local project needs nothing extra. A hosted project needs an explicit `state`, because its default lifecycle depends on hosted visibility. Because GitHub is not read, a plugin project that GitHub reports archived, or whose configured repository name differs in case from GitHub's, is looked for at the configured path rather than where `up` puts it; its config must match. The entry must stay inside the checkout after resolving symlinks.

Package specs installed into ignored `_herakles` state were rejected for now. They need an installer command, a lockfile, a registry trust policy and per-machine install state, while the external plugins expected first are the user's own repositories, which are already tracked projects. A `package` source can be added later without changing existing entries.

Enabling an external plugin runs its code on every machine that syncs the config and has the project checked out. Whatever commit `up` fast-forwards to is the code that runs. External plugins are trusted code: they run in the Herakles process with its privileges, and the plugin API is a capability contract, not a sandbox.

## Loading from the compiled executable

Herakles ships as `bun build --compile` single-file executables. A probe built with Bun 1.4.4 through the same `Bun.build({ compile })` call as `scripts/build.ts` ran from a directory with no `node_modules` and no `bun` on `PATH`:

- `import()` of an absolute path loaded `.js` and `.ts` plugin files, including a relative `.ts` import between plugin files.
- A bare import resolved from the plugin's own `node_modules`.
- A bare import of a package that Herakles bundles, `zod`, failed: the embedded modules are not visible to runtime imports.

So external plugins can be TypeScript or JavaScript without a build step. They bring their own dependencies, which the user installs in the plugin project; Herakles never installs anything. Everything a plugin needs from Herakles comes through the context object, not through imports. Stricli identifies commands with unregistered symbols, so a plugin's own copy of Stricli could not build commands that Herakles routes. Plugins therefore describe commands as data and Herakles builds the Stricli commands itself.

## Plugin API

The API lives in `src/plugin-host/api.ts`, which `package.json` exports as `herakles/plugin` for type checking. It has no runtime imports, so a plugin can also export a plain object without importing it.

```ts
export default definePlugin({
  apiVersion: 1,
  name: "pull-requests",
  description: "Review open pull requests across tracked hosted projects.",
  commands: { prs: pullRequestsCommand, "projects sync": syncCommand },
});
```

**`apiVersion` must equal the host's `PLUGIN_API_VERSION`.** Additive changes, such as a new context service, keep the number. A removal or an incompatible change increments it, and a plugin written for another version is reported as incompatible and not loaded. An exact match is simpler than version ranges while the API has one release line and few plugins. A future host can accept a list of versions if it keeps a shim.

**Commands are keyed by route path.** A key is one word for a top-level command (`prs`) or two words for a command in a group (`projects sync`). A command spec mirrors Stricli's `buildCommand` arguments: `docs`, Stricli `parameters`, and `func(context, flags, ...args)`. Herakles adds `--root` and `--json` to every plugin command and rejects a plugin that declares either. A plugin may add top-level commands, add commands to a core group such as `projects`, and create groups of its own. It may never replace a core route or another plugin's route, nest a command under a core command, or add to another plugin's group. A collision rejects the whole plugin with an error that names the route and its owner, so a plugin is either fully mounted or absent. Bundled plugins mount first in registry order, then external plugins in name order, so the result does not depend on the order of tables in the TOML.

**The context is narrow.** A plugin command receives:

- `workspace`: the workspace root and a plugin cache directory, `_herakles/cache/plugins/<name>`, for generated state.
- `projects`: list, get by selector, and validate, through the same core services as the CLI.
- `config.read()`: a detached copy of the parsed config. There is no config writer.
- `git.run(project, args)` and `gh.run(args)`: argument lists for those two binaries, never a shell string. Herakles resolves the project through core and uses its checkout, which must exist inside the workspace, as the working directory. `git.run` refuses arguments that start with a global git option such as `-C` or `-c`. This keeps the API from offering a shell; it is not containment, since git config and aliases in the checkout still apply.
- `output` helpers for JSON, tables, lines, warnings and progress. Diagnostics go to stderr so `--json` stdout stays parseable.
- `prompt.confirm()` and `prompt.text()`. Closed input declines.
- `applyPlan(plan, { yes })`, which always shows the typed steps, asks for confirmation unless `--yes`, and only then applies. With `--json` the steps and the question go to stderr.

Any operation that moves, deletes, prunes, pushes or publishes must go through `applyPlan`. Review enforces this for bundled plugins. Repository logic that guards a core invariant stays in core and reaches plugins as an additive context service. For example, the canonical-path plan and apply, with their workspace containment checks, become a context service when canonical-path fixing moves into a plugin. Feature logic moves into its plugin: pull request collection and its cache use `gh.run`, and default-branch sync uses `git.run`.

## Failure isolation

Before parsing, the CLI checks whether the invoked route is a core command. Core commands, including a bare core group such as `herakles projects` that runs its default command, do not load plugins at all, so a broken, hanging or exiting plugin cannot affect them. Plugins load only for help, plugin routes, unknown routes, `herakles plugins list` and `herakles doctor`.

Every plugin failure becomes a status instead of an error: unknown bundled name, unresolvable source, missing entry, a throw while loading, an invalid plugin object or command parameters that Stricli rejects, an incompatible `apiVersion`, or a command collision. Herakles prints one stderr line per failed plugin when it routes, `herakles plugins list` shows every bundled and configured plugin with its state, and `herakles doctor` adds one check per configured plugin. A `[plugins]` table that does not match the schema is a config error, like any other invalid config; on a plugin route Herakles prints it instead of reporting an unknown command.

Plugins are a CLI surface. The Workbench does not load them.

## Source ownership

- `src/plugin-host/` owns the plugin API (`api.ts`) and the core loader, checks and route table.
- `src/plugins/<name>/` holds each bundled plugin; `src/plugins/index.ts` is the registry.
- A bundled plugin imports only `src/plugin-host/api.ts`, its own files and package dependencies. Core imports bundled plugins only through the registry. Fallow boundary zones in `fallow.toml` enforce both rules.
- `src/cli/` builds the Stricli commands and the context for plugin commands, as it does for core commands.
