# Herakles v2 Architecture

## Executive Summary

- Herakles is a Bun-first orchestrator for a personal Herakles Workspace.
- `_herakles/herakles.toml` is the canonical synced configuration.
- Project paths are derived from lifecycle, optional group, and repository name.
- The CLI is the only control surface and stays a thin layer over the core services.

Herakles v2 is a Bun-first TypeScript orchestrator for a personal Herakles Workspace. The CLI calls the core services for configuration, project discovery, project resolution, validation, and workspace spin-up.

The canonical configuration is `_herakles/herakles.toml`. It describes hosted repository discovery, tracked projects, and lifecycle defaults. Herakles does not support project-local config, machine profiles, `herakles.local.toml`, or a remote sync API.

`--root` identifies the Herakles Workspace: the folder containing `_herakles` and the mandatory lifecycle folders `open-source/`, `commercial/`, `experiment/`, `candidate/`, and `archived/`. Generated Herakles state lives inside `_herakles/cache` and `_herakles/worktrees`; `_herakles/.gitignore` keeps those folders out of synced configuration.

When `--root` is omitted, the CLI discovers the Herakles Workspace by
looking for `_herakles/herakles.toml` in the current directory and its
ancestors. An explicit `--root` remains exact, and `herakles init` creates a
workspace at the explicit path or current directory instead of discovering an
ancestor.

For setup commands, see [Quick Start](quick-start.md). For development commands and quality gates, see [Tooling](tooling.md). For implementation conventions, see [Code Style](code-style.md).

`herakles init` creates the workspace scaffold, lifecycle folders, `.gitignore`, and minimal `herakles.toml`. Existing config is left untouched so setup can be rerun safely.

## Core Model

A repository is a Git or GitHub source-control unit. A project is Herakles's resolved model over a repository or local experiment, including lifecycle state, derived local path, group, tags, workspace-up eligibility, and validation.

Tracked hosted projects identify their repository with `repo = "owner/name"`. Tracked local projects use only minimal project config such as `source = "local"`, lifecycle, group, tags, or learning evidence. Arbitrary per-project paths are not supported. A project's local path is derived as `<workspace>/<lifecycle>/<group?>/<repo>`.

Public GitHub repositories suggest `open-source`. Private hosted repositories and local projects suggest `experiment`. GitHub archived repositories suggest `archived`. `candidate` and `commercial` are deliberate lifecycle settings. Project settings can change lifecycle, group, and tags through plan-first TOML writes; Herakles reports any move that would be needed but does not move repositories automatically.

Project discovery reads GitHub repositories with `gh repo list` for configured owners plus authenticated user/organization import flows. Local discovery scans root-level repositories for mismatch detection and lifecycle-folder repositories at either `lifecycle/repo` or `lifecycle/group/repo`.

Lifecycle changes are checked against Herakles's transition table. Unusual transitions require an explicit force option so deliberate exceptions are visible.

Same-owner hosted repository renames use one typed plan/apply service behind the CLI. The plan validates the hosted identity, local checkout, destination, and config key before applying the GitHub rename, origin update, Canonical Checkout Path move, and alphabetized tracked-project config re-key. Completed steps are recognized on retry rather than rolled back automatically.

## Spin Up Workspace

`herakles up --dry-run` and `herakles up` make the local Herakles Workspace match `herakles.toml` by creating required folders, cloning missing hosted projects, fetching and fast-forwarding clean existing clones, and reporting validation-only items.

The default eligible set is all non-archived hosted projects unless their topics match `up.exclude_topics`. Local experiments are not cloned by `up`. Validation issues such as path collisions, missing archive evidence, and hosted clone path mismatches become validation-only up items instead of Git work.

`up` fetches an existing clone's remotes one after another, like `git fetch --all`, with `git fetch --progress`. It fetches the remotes `git fetch --all` would, so `remote.<name>.skipFetchAll` still applies, as git's own boolean parser reads it, plus the checked-out branch's own remote even when that is marked `skipFetchAll`, because the fast-forward below needs a current ref from it; that remote goes last. A remote that stays silent for `up.fetch_idle_timeout_seconds` (default 60) is given up on, so N silent remotes cost up to N times that limit. The limit is inactivity, not total time: any output on stdout or stderr starts the wait over, so a slow fetch of a large repository that keeps reporting progress finishes, while a fetch that prints nothing (an `ssh` session waiting for a login approval) is stopped. A server that stays silent that long while it computes a very large pack is stopped too, and so is an ssh fetch that waits for a person at a passphrase prompt, because prompts use the terminal and not the pipes `up` watches; give such a remote an agent, or raise the limit. Fetches run with `GIT_TERMINAL_PROMPT=0`, so an HTTPS remote without a credential helper fails at once with git's own error. ssh configuration is left alone.

A remote that times out or fails is skipped, the other remotes and projects carry on, and the project's result is `skipped` with a message naming the remote, such as `fetch from remote 'backup' timed out after 60s without output; skipped`. A timed-out command's whole process tree is stopped, since an `ssh` child can outlive `git` and keep waiting; a command that has already exited is never signalled. When the fetch's output holds a Tailscale SSH check URL (`https://login.tailscale.com/...`), the message includes it whether the fetch timed out or failed, because a tailnet in check mode holds the session open until someone approves that login. The message says `fetched` only when at least one remote was fetched.

After the fetches, a clean worktree on a branch with an upstream is fast-forwarded with the local `git merge --ff-only`, which needs no network and so has no timeout. The result says `fast-forwarded` only when HEAD moved, and `already up to date` otherwise. If the upstream's own remote did not answer, the upstream ref is whatever an earlier run fetched; the merge still runs, because it can only move the branch forward, and the message says the upstream may be out of date. If the upstream branch no longer exists (deleted on the remote and pruned), the branch is left alone and the message says so. A branch whose merge ref has no remote-tracking branch (a single-branch clone, or a ref outside `remote.<name>.fetch`) has no `@{upstream}`, so, as `git pull` does, `up` merges `FETCH_HEAD` from the branch's own remote's fetch, which git fills with that merge ref; if that remote was not fetched in this run (its fetch failed, or `branch.<name>.remote` is a URL or path that `git remote` does not list) the branch is left alone, since there is no older ref to fall back on. A detached HEAD, a branch with no commits yet, and a branch with no upstream at all are reported as such and not merged.

If Herakles discovers a hosted repository clone at a different local path than the canonical checkout path, validation reports `hosted-clone-path-mismatch`. The user resolves that conflict explicitly: the bundled `fix-path` plugin's `herakles projects fix-path <project>` ([docs](plugins/fix-path.md)), after reviewing the existing and canonical paths. Core owns the safety checks and offers them to plugins as the `canonicalPath` context service: planning runs them without touching disk, and the plan's apply re-runs them before moving the checkout, so a path that changed in between is refused. `up` does not silently move, delete, or duplicate repositories.

The CLI reports progress through `executeUpPlan`'s `onItemStart(item, index, total)` and `onProgress(result)` hooks, which `app.up`, `app.upProject` and `app.upProjects` pass through. A hook that throws is ignored: it cannot abort the run or fail an item. `app.upProjects` builds and executes one plan across several projects, which `projects import` uses so its counter spans the whole import. `src/cli/progress.ts` turns the hooks into a single live line on stderr, drawn only when stderr is an interactive terminal (a TTY, `TERM` not `dumb`, `CI` unset, empty, `0` or `false`) and always cleared before results are printed or on Ctrl-C; other output is unchanged.

## Plugins

Optional features are plugins that add CLI commands on top of core. Core keeps workspace configuration, projects, `up`, `validate`, `doctor` and Config Exchange. [ADR 0018](adr/0018-plugin-system.md) records the design.

Bundled plugins are compiled into Herakles and stay off until `[plugins.<name>]` in `_herakles/herakles.toml` enables them. External plugins name a tracked project and an entry file inside it. Herakles finds the file at the project's Canonical Checkout Path, derived from synced config alone, so `herakles up` brings the plugin to every machine. A hosted plugin project therefore needs an explicit `state`, and a local plugin project must sit at its derived path. Core config accepts any `[plugins]` tables; each entry is checked on its own, so a bad entry fails only its plugin and unknown keys are ignored. The compiled executable imports external `.ts` and `.js` entries from disk at runtime.

A plugin declares the plugin `apiVersion` it targets and contributes Stricli command specs keyed by route path, such as `prs` or `projects sync`. Herakles adds `--root` and `--json` and builds the commands. A plugin may add top-level commands, add commands to a core group, or own a group of its own. It never replaces a core route or another plugin's route or adds to the core `plugins` group, and any collision rejects the whole plugin.

Plugin commands receive a context with project resolution, validation, a read-only copy of the config, `git` and `gh` argument-list runners that work in project checkouts found without discovery, output and prompt helpers, a plugin cache folder under `_herakles/cache/plugins/<name>`, the `canonicalPath` plan service, and `applyPlan` for confirmed repository operations. The context parses no shell strings and has no config writer. It is a capability contract, not a sandbox: plugins run in the Herakles process, and git config or aliases can still run commands.

Core commands, `--version`, and a bare core group that runs its default command do not load plugins. Bare `herakles`, help, plugin routes, `herakles plugins list` and `herakles doctor` do. A plugin whose entry is malformed, that fails to resolve, throws while loading, targets another API version or collides is reported, not loaded: `herakles plugins list` shows its state and `herakles doctor` adds a check for each configured plugin.

## CLI Surface

Herakles is operated through the `herakles` CLI, a thin Stricli command layer over the core services in `src/app.ts`. Commands print human-readable output by default and structured JSON with `--json`; they do not run a long-lived server or expose a network API.

`herakles add` is the primary project entry point. Existing GitHub repositories are the default add path when `--repo owner/name` is provided. Hosted add/import writes minimal tracked-project config and checks out the project automatically. `herakles remove` stops tracking a project after confirmation; it does not delete local files or hosted repositories.

`herakles projects import` bulk-imports known GitHub repositories, listing accessible repositories for configured users/organizations plus the authenticated GitHub user's account and organizations, and writes the requested lifecycle, group, and tags before workspace spin-up starts.

Project refresh, validation, and doctor checks are separate commands. Lifecycle changes, local promotion, and same-owner renames are plan-first: `projects set-state --dry-run` prints the typed plan, and `projects promote` and `projects rename` print theirs until `--apply` is passed. Config Exchange moves `_herakles/herakles.toml` text between machines: `herakles config show` prints the stored TOML and `herakles config apply` validates TOML with Bun's parser and the Herakles schema, previews a line diff, and asks for confirmation before writing.
