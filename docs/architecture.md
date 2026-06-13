# Herakles v2 Architecture

Herakles v2 is a Bun-first TypeScript orchestrator for a personal multi-repository workspace. The CLI and UI call the same core services for configuration, project discovery, project resolution, validation, sync planning, reports, and automation ticks.

The canonical configuration is `_herakles/herakles.toml`. It describes the remote repository universe and orchestration defaults; it is not supplemented by project-local config files or synced machine profiles. Local configuration is optional and limited to UI-only machine preferences such as host, port, browser opening, and access token location.

`herakles init` creates the canonical config scaffold, local support directories, `_herakles/herakles.local.toml`, `_herakles/.gitignore`, and default report-only automation jobs with inline prompts in `herakles.toml`. Existing config is left untouched so setup can be rerun safely and a synced config repository can customize its orchestration assets.

Operational commands auto-pull the `_herakles` Git checkout when `config.auto_pull` is true and the config directory is a Git checkout. A successful fast-forward pull reloads `herakles.toml` before project discovery, project resolution, validation, sync planning, reports, or automation continue. Non-Git scaffolds are left alone, and `herakles config pull` remains the explicit command that fails loudly when `_herakles` is not a checkout.

Synced config mutations can auto-push when `config.auto_push` is true. App-level tracked-project config writes and repo move writes stage `herakles.toml`, create a Herakles-authored commit, and push the config repository. Cache, report, local experiment state, run ledger, and lock writes are not auto-pushed because they are generated or machine-local state rather than synced configuration.

## Core Model

Herakles distinguishes repositories from projects. A repository is a Git or GitHub source-control unit. A project is Herakles's resolved model over a repository or local experiment, including lifecycle state, local path, sync decision, automation eligibility, reports, and validation. A tracked project is represented by the smallest necessary `[project."id"]` entry in `_herakles/herakles.toml`.

Lifecycle states are:

- `experiment`
- `candidate`
- `commercial`
- `open-source`
- `archived`

Public GitHub repositories suggest `open-source` by default. Private hosted repositories and local experiments suggest `experiment`. GitHub archived repositories suggest `archived`. The user can set `candidate`, `commercial`, or another lifecycle state explicitly when adding/importing a project or later through project settings.

Project discovery reads GitHub repositories with `gh repo list` for each configured owner. By default Herakles asks GitHub CLI for source repositories only so forks are excluded; setting `github.include_forks = true` removes that source-only filter. When `github.include_archived = false`, Herakles also asks `gh` to omit archived repositories before local resolution.

Tracked hosted projects identify their repository with `repo = "owner/name"`. Tracked local projects identify their workspace-relative path with `path = "..."`. Project ids are stable Herakles handles and do not need to match the repository name, though import defaults to an owner-repo slug.

Lifecycle changes are checked against Herakles's built-in transition table. `experiment` may become `candidate`, `commercial`, `open-source`, or `archived`; `candidate` may become `experiment`, `commercial`, or `archived`; `commercial` and `open-source` normally move only to `archived`; `archived` may be restored to `experiment` or `open-source`. Unusual transitions require an explicit force option in the CLI or API so deliberate exceptions are visible.

## Synchronization

The default sync plan includes non-archived remote repositories. Local experiments are hidden from remote clients and are not included in sync plans. A Herakles client may request a token-protected sync plan from a Herakles UI server and then executes clone, fetch, and safe fast-forward pull operations locally; Herakles does not become a file sync protocol.

Remote sync plans use workspace-relative project paths. The server does not send its local absolute clone paths, and the client localizes each relative path under its own workspace root before executing clone, fetch, or pull. Client-side localization rejects paths that would escape the workspace root.

Sync eligibility is evaluated against the resolved project model with a deliberately small filter expression language. The default synced filter is `not archived`; project config can set `sync = true` or `sync = false` to replace the expression result. The first supported expression features are `and`, `or`, `not`, `==`, `!=`, `contains`, `in`, parentheses, string/boolean literals, and `has_topic`, `has_tag`, and `has_language`.

Project-level validation issues become validation-only sync items. This keeps dry-runs and sync reports tied to the same roadmap vocabulary as validation, while preventing Herakles from doing Git work for projects that first need human correction. Path collisions, missing archive evidence, and hosted clone path mismatches all surface this way.

If Herakles discovers a hosted repository clone at a different local path than the resolved project path, validation reports `hosted-clone-path-mismatch`. Sync planning turns that project into a validation-only item instead of cloning a second copy. The user must explicitly run the repo move flow to align the clone path.

Archive-note validation is relaxed by default for hosted repositories that are not cloned locally, because the learning file cannot be inspected on that machine. `herakles validate --strict` and `/api/validate?strict=true` promote those missing-evidence warnings to errors.

Sync never deletes local folders implicitly. `herakles sync --prune-plan` reports hosted clones that are archived or no longer sync-eligible but still exist locally. `herakles prune --repo <project>` is the explicit action; it moves the clone into `_cache/pruned/<timestamp>/...` instead of deleting it.

## UI and API

The UI is launched through its own `herakles-ui` CLI entrypoint, with `herakles ui` kept as a convenience command, so it can stay open while normal CLI commands continue to run. It uses Bun's fullstack dev server model: HTML entrypoints are imported into `Bun.serve`, frontend assets are bundled by Bun, and typed API routes live in the same UI server process. The React UI uses TanStack Router semantics and Start-style route organization without adopting a Vite-backed Start runtime.

Remote sync routes can be exposed by the UI server, but remote callers remain read/sync-only and must use an access token. When the UI server is bound to a non-loopback host, Herakles puts the API in remote-sync-only mode: `/api/sync/remote/*` remains available with bearer-token authentication, while the broader command API is refused instead of becoming remote control. The remote namespace serves hosted-only project/status reads, sync plans, report reads, and automation status mirrors. These payloads use workspace-relative paths for projects and generated reports, and they do not expose local experiment projects.

Mutating API routes validate request bodies with Zod at the server boundary. Invalid JSON and schema mismatches return structured `400` responses before any core service is invoked.

The Settings screen is the UI control surface for typed workspace operations such as project refresh, validation, explicit config pull, prune planning, and doctor checks. These actions call the same core services as the CLI and publish status events through the server stream. Doctor checks cover both local runtime tools and synced configuration bootstrap health, including whether `_herakles` is a Git checkout, has an origin, and ignores `.herakles-state/`.

Settings also surfaces the active workspace root plus the synced and local UI config paths. This makes machine-local UI configuration visible without turning the UI into a raw TOML editor or allowing local config to override project orchestration.

Project discovery results distinguish hosted repositories, hosted clones already present locally, and local-only experiments. The hosted-clone bucket is used for diagnostics such as clone path mismatches without incorrectly treating those directories as local experiments.

The Reports screen lists generated local Markdown reports and links to a report detail view that renders the same report body returned by the shared report API. It can also create local Markdown notes under `_reports/notes/` through a typed service. Report content stays local under the configured reports path and is not synced configuration.

Project lifecycle and path settings are plan-first writes. The plan includes the TOML that would be written, any lifecycle transition metadata, and a projected validation result computed against the in-memory project model before the synced config file changes. Repository move plans use the same projected validation contract because they are tracked path changes plus a filesystem move.

The Projects screen and `herakles add` are the primary project entry points. Adding a project prompts for whether the project is an existing hosted repository, a new local experiment, or a hosted project to be created. The first implemented paths write minimal tracked-project config for existing GitHub repositories and local experiments. Hosted projects can be checked out immediately after add/import or later through the same project surface. `herakles remove` and the UI remove action stop tracking a project after confirmation; they do not delete local files or hosted repositories.

GitHub bulk import opens from the Projects screen as a focused dialog. It lists accessible repositories from configured GitHub users or organizations plus the authenticated GitHub user's account and organizations, then lets the user select which ones become tracked projects. Import defaults lifecycle state from hosted facts such as visibility and archive state, while still allowing an explicit lifecycle state during import and optional checkout after import.

Local project archive and promotion controls live in project settings rather than a separate local-projects surface. Archiving writes local machine state after verifying the configured learning file exists in that project, and does not write synced configuration. Promotion to GitHub is a separate plan-first action: Herakles previews the `gh repo create` command, and only an explicit promote action runs it. Promotion still does not write synced config; after the next project refresh, the hosted repository is discovered from GitHub facts.

The UI server also exposes `/api/events` as a server-sent event stream. Events are emitted around typed Herakles operations such as project refresh, sync, validation, automation runs, and report creation; the stream is a live status surface, not a command channel or persistence layer.

## Automation

`herakles automate tick` is the unit of scheduling. The UI server runs in-process Bun cron ticks while it is open and runs a bounded catch-up tick on startup. Startup catch-up looks at the run ledger, enumerates missed scheduled slots inside `automation.catch_up_window_minutes`, and still uses the normal lock and successful-run checks before doing work. OS-level Bun cron installation is available from the CLI but must be explicit. By default that command writes a generated worker script under the local cache path and registers it with Bun's OS-level cron API; the worker calls the shared Herakles automation service for the current workspace. Herakles owns due-slot calculation, lock claims, duplicate prevention, and run recording.

Cron matching is timezone-aware. Four-hour schedules use UTC slots, while daily and weekly schedules use `job.<id>.slot_timezone` when present and otherwise the workspace `timezone`. Local daily and weekly slot ids include a safe timezone key such as `Europe-London/2026-06-12`, and report path placeholders derive `{date}` and `{iso_week}` from that slot key rather than the raw UTC due time.

When `automation.enabled` is false, Herakles still loads and displays configured jobs, but scheduled due-slot calculation and UI in-process cron ticks are disabled. Explicit job runs remain separate commands.

Automation eligibility also uses project filters. The default automation filter is `sync == true`, then automation-level excluded topics are applied. Local experiments remain local-only and are not automation eligible through synced config by default.

Automation jobs live in `_herakles/herakles.toml` and can declare `repo_filter`, `issue_labels`, `skill`, and an inline prompt. Herakles parses these as orchestration metadata, evaluates `repo_filter` against the resolved project model, and includes the eligible project context in generated reports or AI harness prompts. `implementation-plan` jobs use this same eligible project set to generate issue recommendation reports. `coderabbit-review` jobs scan unresolved CodeRabbit review threads on eligible pull requests and generate review-context reports. Recommendation jobs write a Markdown report for review plus a JSON sidecar for tooling. This keeps the AI harness as the worker over prepared context while Herakles owns project selection, scheduling, locks, GitHub lookup, and report recording.

Prompt-driven report-only jobs receive a Herakles-authored context block on stdin after the configured prompt. That context includes slot metadata, eligible project evidence such as lifecycle state, visibility, path, topics, languages, detected package managers, roadmap presence, and recent generated reports. The configured AI harness writes only to the configured report path in these modes; Herakles still owns scheduling, GitHub lookup, locking, and run recording. Herakles does not model harness-specific implementation branches, review resolution, or publishing.

The Automation screen surfaces configured jobs, editable prompts, due slots, recent runs, scheduled ticks, and explicit manual runs for a selected job. Prompt and job edits write back to `_herakles/herakles.toml` through the same synced config mutation path as other project settings. Manual UI runs call the same `runAutomationJob` service as `herakles automate run`; they still claim slots, record runs, and emit automation/report events.

Lock payloads use deterministic state branches in the same config repository when a config remote is available. Local fallback locks live under ignored `.herakles-state`, honor `expiresAt` before a new claim, and are hidden from the current-locks list after expiry. `herakles init` writes `.herakles-state/` into `_herakles/.gitignore`, and `herakles config doctor` warns when an existing config checkout lacks that ignore rule. Local run ledgers live under `_cache`; neither local scratch path is written to `herakles.toml`.

## Tooling

Herakles prefers Bun APIs for TOML, cron, serving, bundling, tests, subprocesses, and runtime services. Stricli powers the CLI. Biome handles formatting and linting. Fallow is reserved as a CI pull-request quality gate.
