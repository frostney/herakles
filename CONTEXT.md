# Herakles

Herakles coordinates a personal multi-repository workspace across machines. Its language distinguishes source-control facts from the resolved operating model Herakles uses for sync, validation, automation, and review.

## Language

**Repository**:
A Git or GitHub source-control unit with facts such as owner, name, remote URL, visibility, topics, archive state, and default branch.
_Avoid_: Project when referring only to Git or GitHub facts

**Project**:
Herakles's resolved operating model for a repository or local experiment, including lifecycle state, local path, sync decision, automation eligibility, reports, and validation.
_Avoid_: Repository when referring to Herakles-specific resolved state

**Tracked Project**:
A project that Herakles should remember through the minimal synced configuration needed to reproduce or understand it. Hosted repositories can still infer most facts from the host, while local experiments need enough config to be intentionally part of the workspace.

**Tracked Project Config**:
The minimal synced config entry that makes a project part of Herakles. It identifies the project source and location, while host facts and local discovery fill in the rest of the resolved project model.
_Avoid_: Sparse override as the primary project record

**Add Project**:
The primary Herakles flow for bringing work into the workspace, whether by importing an existing hosted repository, creating a local experiment, or creating a new hosted repository. Herakles asks for the missing choices, writes the smallest required tracked-project config, and then refreshes the resolved project model.

**Bulk Import**:
A guided add-project flow that lets the user select multiple accessible hosted repositories from configured GitHub users or organizations and create tracked-project config entries for them at once.

**Lifecycle Suggestion**:
A default lifecycle state Herakles proposes during add or bulk import from hosted facts such as visibility, archive state, topics, owner, and repository metadata. The user may accept or override the suggestion before the tracked-project config is written.
_Avoid_: Project type

Archived hosted repositories suggest `archived`; public non-archived hosted repositories suggest `open-source`; private hosted repositories and local projects suggest `experiment`. `commercial` and `candidate` are suggested only from explicit configured evidence such as topics, tags, name rules, or owner rules.

**Remove Project**:
The primary Herakles flow for stopping tracking of a project. Removal requires confirmation and removes the Herakles project entry without deleting local files or hosted repositories by default.
_Avoid_: Delete project

**Project Discovery**:
The Herakles refresh flow that reads hosted repositories and local Git folders, then updates the resolved project model. It is user-facing as project discovery or project refresh; cached discovery data stays an implementation detail.

**Project Settings**:
The user-facing place for changing a project's connection and interpretation, including lifecycle state, path, archive evidence, sync behavior, and promotion from a local experiment to a hosted repository.
_Avoid_: Separate promotion workflow

**Hosted Visibility**:
Whether a hosted repository is public or private. Local experiments do not have hosted visibility until they are promoted to a host.
_Avoid_: local-only visibility, internal visibility

**Local Experiment**:
A local Git-backed project that has not been promoted to a hosted repository. It participates in Herakles workspace views and validation when it is tracked through minimal Herakles configuration.
_Avoid_: Local-only repository

**Commercial**:
A project lifecycle denotation for work that is operated as, or intended to become, a commercial product. It is set deliberately through project settings rather than inferred from repository metadata.
_Avoid_: commercial-product, commercial repository

**Experiment**:
A project lifecycle denotation for exploratory work. Whether an experiment is local-only or hosted privately is described by the project's source and hosted visibility, not by separate lifecycle states.
_Avoid_: local experiment state, private experiment state

**Open Source**:
A project lifecycle denotation for public hosted work. Public GitHub repositories are inferred as open source by default, unless project settings give the project a different lifecycle state.
_Avoid_: open-source-active

**Candidate**:
A project lifecycle denotation for work that is being evaluated for promotion beyond an experiment. It is set deliberately through project settings rather than inferred from repository visibility.
_Avoid_: product-candidate

**Archived**:
A project lifecycle denotation for work that should not be treated as active. A GitHub archived repository is inferred as archived even if other repository facts would normally imply an active lifecycle state.
_Avoid_: inactive, dormant

**Archive Note**:
A short explanation of why a project became archived, such as what was learned, where the work moved, or which alternative superseded it. It can come from a configured learning file or from hosted repository metadata when that metadata explains the archive.
_Avoid_: archivation note

**Learning File**:
A local Markdown file that records an archive note for a project. It is one valid source of archive evidence, but archived hosted repositories can also satisfy the rule through meaningful hosted metadata.
_Avoid_: archive file

**Report**:
A local generated record of Herakles analysis, automation output, or review context. Reports are surfaced in the UI but are not synced configuration.
_Avoid_: Synced report, config report

**AI Harness**:
The development-agent runtime that receives Herakles-prepared prompts and project context, performs the AI-assisted work, and returns reports or other outputs. Codex is one possible AI harness; Herakles schedules harness runs but does not own the harness's internal workflow.
_Avoid_: Automation harness, GitHub Actions harness, Codex-only automation

**Harness Run**:
A scheduled Herakles handoff to an AI harness for a prompt and a selected set of projects. Herakles prepares context, invokes the configured harness, records the returned report, and stops there.
_Avoid_: Herakles-owned implementation workflow

**Harness Report**:
The Herakles-owned output of a harness run. It records what the AI harness returned or where to inspect its result, without Herakles modeling the harness's implementation, review, or publishing workflow.
_Avoid_: Patch candidate, publish candidate

**Synced Configuration**:
The desired Herakles workspace and orchestration configuration stored in `_herakles/herakles.toml`. It should be sufficient to bootstrap the Herakles orchestrator for the configured remote repositories.
_Avoid_: Project-local config

**Local Configuration**:
Optional machine-specific Herakles settings stored outside synced configuration, limited to UI host, UI port, browser opening, and access token location.
_Avoid_: Required config

**Herakles Server**:
A Herakles UI server process that serves the local browser UI and its API, and can expose token-protected remote sync routes when configured for that role.
_Avoid_: Machine profile

**Herakles Client**:
A Herakles instance that syncs against a Herakles server endpoint instead of independently selecting repositories through a synced machine profile.
_Avoid_: Secondary machine profile

**Sync Plan**:
A server-provided description of which projects a Herakles client should clone, fetch, skip, or validate. The client executes the Git and filesystem operations locally.
_Avoid_: File sync

Remote sync plans carry workspace-relative paths. Clients resolve those paths under their own workspace root and reject paths that would escape it.

**Validation-Only Sync Item**:
A sync plan item that reports a project-level validation issue instead of executing Git work. It is used for correction-required conditions such as path collisions, missing archive evidence, and hosted clone path mismatches.
_Avoid_: Failed clone item, dry-run-only error

**Access Token**:
A local secret generated by a Herakles server and required by non-localhost clients that request sync plans or other remote API data.
_Avoid_: Synced token, config token

**Remote Sync API**:
The token-protected Herakles server API used by clients to read workspace state and sync plans. It does not allow a remote client to start automations or mutate another machine's workspace.
_Avoid_: Remote control API

Remote sync clients see hosted workspace state only. A server's local experiments are not exposed to remote clients. Remote project paths, report paths, and automation run report paths are workspace-relative so a server's local filesystem layout is not part of the API contract.
When a Herakles server binds beyond loopback, the exposed API remains sync-only: token-authenticated remote sync routes are served, and broader command routes are refused.

**Remote Repository**:
A hosted repository discovered by Herakles, such as a GitHub repository. Non-archived remote repositories are included in the default server-provided sync plan for clients.
_Avoid_: Local experiment

**Automation Tick**:
A Herakles scheduler wake-up that calculates due prompt runs and attempts to hand claimed runs to the configured AI harness. The UI server can run ticks in-process while it is open, and OS-level ticks must be installed explicitly.
_Avoid_: Cron job as duplicate-prevention mechanism

Default prompt templates live under `_herakles/prompts/` and are synced orchestration assets. `herakles init` creates the standard report-only prompt files when they are absent, but never overwrites customized prompts.

Startup catch-up is a special automation tick mode. It uses the local run ledger plus the configured catch-up window to enumerate missed slots, then still relies on normal lock claims and successful-run checks before executing anything.

Explicit OS-level cron installation writes a generated worker script under the local cache path and registers that script through Bun cron. The generated worker is local machine state, not synced configuration.

Implementation-shaped automation is delegated to the configured AI harness. Herakles may schedule the prompt and store the resulting report, but it should not model harness-specific implementation or review workflows as Herakles-owned concepts.

Disabled automation still surfaces configured jobs in the UI and CLI, but scheduled ticks produce no due slots and the UI server does not start its in-process Bun cron loop.

Local fallback automation locks honor their `expiresAt` timestamp before a slot is claimed again. Expired local locks are not shown as current locks.

Implementation-plan automation is recommendation-shaped work. A due `implementation-plan` slot evaluates the configured eligible repositories and issue labels, then asks the configured AI harness to produce an implementation planning report without Herakles running implementation.

CodeRabbit-review automation is recommendation-shaped work. A due `coderabbit-review` slot evaluates eligible pull requests, then asks the configured AI harness to produce unresolved review context or a report without Herakles pushing commits or resolving threads.
