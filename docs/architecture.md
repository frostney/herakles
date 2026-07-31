# Herakles v2 Architecture

## Executive Summary

- Herakles is a Bun-first orchestrator for a personal Herakles Workspace.
- `_herakles/herakles.toml` is the canonical synced configuration.
- Project paths are derived from lifecycle, optional group, and repository name.
- CLI and UI call the same core services rather than owning separate behavior.
- Herakles Workbench surfaces cross-project review, including open pull requests for tracked hosted projects.
- Automation schedules prompt-driven agent runtime runs; Herakles owns scheduling and reports, not implementation workflows.

Herakles v2 is a Bun-first TypeScript orchestrator for a personal Herakles Workspace. The CLI and UI call the same core services for configuration, project discovery, project resolution, validation, workspace spin-up, reports, and automation ticks.

The canonical configuration is `_herakles/herakles.toml`. It describes hosted repository discovery, tracked projects, lifecycle defaults, automation jobs, and agent runtime settings. Herakles does not support project-local config, machine profiles, `herakles.local.toml`, or a remote sync API.

`--root` identifies the Herakles Workspace: the folder containing `_herakles` and the mandatory lifecycle folders `open-source/`, `commercial/`, `experiment/`, `candidate/`, and `archived/`. Generated Herakles state lives inside `_herakles/cache`, `_herakles/reports`, `_herakles/worktrees`, and `_herakles/state`; `_herakles/.gitignore` keeps those folders out of synced configuration.

When `--root` is omitted, the CLI and UI discover the Herakles Workspace by
looking for `_herakles/herakles.toml` in the current directory and its
ancestors. An explicit `--root` remains exact, and `herakles init` creates a
workspace at the explicit path or current directory instead of discovering an
ancestor.

For setup commands, see [Quick Start](quick-start.md). For development commands and quality gates, see [Tooling](tooling.md). For implementation conventions, see [Code Style](code-style.md).

`herakles init` creates the workspace scaffold, lifecycle folders, `.gitignore`, schemas, and default report-only automation jobs with inline prompts in `herakles.toml`. Existing config is left untouched so setup can be rerun safely.

## Core Model

A repository is a Git or GitHub source-control unit. A project is Herakles's resolved model over a repository or local experiment, including lifecycle state, derived local path, group, tags, workspace-up eligibility, automation eligibility, reports, and validation.

Tracked hosted projects identify their repository with `repo = "owner/name"`. Tracked local projects use only minimal project config such as `source = "local"`, lifecycle, group, tags, or learning evidence. Arbitrary per-project paths are not supported. A project's local path is derived as `<workspace>/<lifecycle>/<group?>/<repo>`.

Public GitHub repositories suggest `open-source`. Private hosted repositories and local projects suggest `experiment`. GitHub archived repositories suggest `archived`. `candidate` and `commercial` are deliberate lifecycle settings. Project settings can change lifecycle, group, and tags through plan-first TOML writes; Herakles reports any move that would be needed but does not move repositories automatically.

Project discovery reads GitHub repositories with `gh repo list` for configured owners plus authenticated user/organization import flows. Local discovery scans root-level repositories for mismatch detection and lifecycle-folder repositories at either `lifecycle/repo` or `lifecycle/group/repo`.

Lifecycle changes are checked against Herakles's transition table. Unusual transitions require an explicit force option so deliberate exceptions are visible.

Same-owner hosted repository renames use one typed plan/apply service shared by the CLI and UI. The plan validates the hosted identity, local checkout, destination, and config key before applying the GitHub rename, origin update, Canonical Checkout Path move, and alphabetized tracked-project config re-key. Completed steps are recognized on retry rather than rolled back automatically.

## Spin Up Workspace

`herakles up --dry-run` and `herakles up` make the local Herakles Workspace match `herakles.toml` by creating required folders, cloning missing hosted projects, fetching and fast-forwarding clean existing clones, and reporting validation-only items.

The default eligible set is all non-archived hosted projects unless their topics match `up.exclude_topics`. Local experiments are not cloned by `up`. Validation issues such as path collisions, missing archive evidence, and hosted clone path mismatches become validation-only up items instead of Git work.

If Herakles discovers a hosted repository clone at a different local path than the canonical checkout path, validation reports `hosted-clone-path-mismatch`. The user resolves that conflict explicitly with the Use Canonical Path action after reviewing the existing and canonical paths; `up` and Sync Workspace do not silently move, delete, or duplicate repositories.

## UI and API

The UI is launched through its own CLI/server path and can stay open while normal CLI commands continue to run. It uses Bun's fullstack server model: HTML entrypoints are imported into `Bun.serve`, frontend assets are bundled by Bun, and typed API routes live in the same server process. The React UI uses TanStack Router semantics without adopting a Vite-backed runtime.

The Projects screen is the default Herakles Workbench landing surface, and `herakles add` is the primary CLI project entry point. Existing GitHub repositories are the default add path when `--repo owner/name` is provided. Hosted add/import writes minimal tracked-project config and checks out the project automatically. `herakles remove` and the UI remove action stop tracking a project after confirmation; they do not delete local files or hosted repositories.

GitHub bulk import opens as a dialog. It lists accessible repositories for configured users/organizations plus the authenticated GitHub user's account and organizations, then lets the user select repositories and set lifecycle, group, and tags before tracked config is written and workspace spin-up starts.

The Pull Requests screen reviews open pull requests across tracked hosted projects. It uses the resolved project model for lifecycle, starred-project ordering, repository labels, and partial failure reporting; pull request and repository links lead back to GitHub. Pull request reads are cached briefly under `_herakles/cache` as generated local state, and explicit refresh bypasses that cache.

Settings exposes project refresh, validation, doctor checks, and Config Exchange. Project Settings provides preview-before-apply lifecycle, metadata, promotion, and same-owner rename actions through shared services. Config Exchange is a copy-paste editor for `_herakles/herakles.toml`; it validates TOML with Bun's parser and the Herakles schema before applying.

The Reports screen lists generated Markdown reports under `_herakles/reports` and can create local Markdown notes through a typed service. Reports are local generated records, not synced configuration.

The UI server exposes `/api/events` as a server-sent event stream. Events are emitted around typed Herakles operations such as project refresh, up, validation, automation runs, and report creation. The stream is a live status surface, not a command channel or persistence layer.

Project cards may expose narrow repository maintenance actions, such as fetching and fast-forwarding the local default branch. These actions report typed success, skipped, or failed results and emit terminal UI status events; they are not substitutes for Spin Up Workspace and do not broaden the UI into a generic shell surface.

## Automation

`herakles automate tick` is the unit of scheduling. The UI server runs in-process Bun cron ticks while it is open and runs a bounded catch-up tick on startup. OS-level Bun cron registration is available from the CLI but must be explicit. The generated worker lives under `_herakles/cache` and calls the shared Herakles automation service for the current workspace.

Cron matching uses the local machine timezone of the Herakles process that runs the automation tick. Timezone is runtime context and is not stored in synced configuration.

Automation eligibility uses project filters and tag filters. The default automation filter is `not archived`, then automation-level excluded topics are applied. Automation jobs live in `_herakles/herakles.toml` and can declare `runtime`, `repo_filter`, `include_tags`, `exclude_tags`, `skill`, `output`, and inline prompts. Herakles owns scheduling, project selection, locks, GitHub lookup, and report recording; the configured agent runtime owns the work performed from the prepared prompt and context.

Prompt-driven agent runtime jobs receive a Herakles-authored context block on stdin after the configured prompt. That context includes slot metadata, eligible project evidence, detected package managers, roadmap presence, and recent generated reports. Herakles does not model runtime-specific implementation branches, review resolution, or publishing. The UI leads with human-readable schedule summaries while keeping the cron expression as the precise editable form.

Automation locks are local file claims under `_herakles/state/locks` and honor their expiry before a slot can be claimed again. Run ledgers live under `_herakles/cache/runs`. Herakles does not coordinate automation through a config repository, remote sync endpoint, or branch-lock protocol.
