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

If Herakles discovers a hosted repository clone at a different local path than the canonical checkout path, validation reports `hosted-clone-path-mismatch`. The user resolves that conflict explicitly with the Use Canonical Path flow after reviewing the existing and canonical paths; `up` and Sync Workspace do not silently move, delete, or duplicate repositories.

## CLI Surface

Herakles is operated through the `herakles` CLI, a thin Stricli command layer over the core services in `src/app.ts`. Commands print human-readable output by default and structured JSON with `--json`; they do not run a long-lived server or expose a network API.

`herakles add` is the primary project entry point. Existing GitHub repositories are the default add path when `--repo owner/name` is provided. Hosted add/import writes minimal tracked-project config and checks out the project automatically. `herakles remove` stops tracking a project after confirmation; it does not delete local files or hosted repositories.

`herakles projects import` bulk-imports known GitHub repositories, listing accessible repositories for configured users/organizations plus the authenticated GitHub user's account and organizations, and writes the requested lifecycle, group, and tags before workspace spin-up starts.

Project refresh, validation, and doctor checks are separate commands. Lifecycle changes, local promotion, and same-owner renames are plan-first: `projects set-state --dry-run` prints the typed plan, and `projects promote` and `projects rename` print theirs until `--apply` is passed.
