# Herakles

Herakles coordinates a personal multi-repository workspace across machines. Its language distinguishes source-control facts from the resolved operating model Herakles uses for workspace spin-up, validation, and review.

## Language

**Repository**:
A Git or GitHub source-control unit with facts such as owner, name, remote URL, visibility, topics, archive state, and default branch.
_Avoid_: Project when referring only to Git or GitHub facts

**Project**:
Herakles's resolved operating model for a repository or local experiment, including lifecycle state, derived local path, up eligibility, and validation.
_Avoid_: Repository when referring to Herakles-specific resolved state

**Tracked Project**:
A project that Herakles should remember through the minimal synced configuration needed to reproduce or understand it. Hosted repositories can still infer most facts from the host, while local experiments need enough config to be intentionally part of the workspace.

**Tracked Project Config**:
The minimal synced config entry that makes a project part of Herakles. It identifies the project source and location, while host facts and local discovery fill in the rest of the resolved project model.
_Avoid_: Sparse override as the primary project record

**Add Project**:
The primary Herakles flow for bringing work into the workspace, whether by importing an existing hosted repository, creating a local experiment, or creating a new hosted repository. Herakles asks for the missing choices, writes the smallest required tracked-project config, and then refreshes the resolved project model.

**Bulk Import**:
A guided add-project flow that lets the user select multiple accessible hosted repositories from configured GitHub users or organizations plus the authenticated GitHub user's own account and organizations, then create tracked-project config entries for them at once.

**Lifecycle Suggestion**:
A default lifecycle state Herakles proposes during add or bulk import from hosted facts such as visibility, archive state, topics, owner, and repository metadata. The user may accept or override the suggestion before the tracked-project config is written.
_Avoid_: Project type

Archived hosted repositories suggest `archived`; public non-archived hosted repositories suggest `open-source`; private hosted repositories and local projects suggest `experiment`. `commercial` and `candidate` are suggested only from explicit configured evidence such as topics, tags, name rules, or owner rules.

**Remove Project**:
The primary Herakles flow for stopping tracking of a project. Removal requires confirmation and removes the Herakles project entry without deleting local files or hosted repositories by default.
_Avoid_: Delete project

**Rename Project**:
The primary Herakles flow for changing the name of a tracked hosted repository within its existing owner while preserving the project's tracked state and derived workspace identity.
_Avoid_: Transfer Project, Remove and re-add

**Spin Up Workspace**:
The Herakles flow that makes a local Herakles Workspace match its configuration by creating required folders, checking out missing projects, safely updating existing projects, and reporting conflicts without destructive cleanup.
_Avoid_: File sync, apply config, slay

Spin up is a workspace-level flow, not a per-project checkout action. Add Project, Bulk Import, and explicit workspace spin-up may invoke it; normal project lists should not present checkout as an independent project operation.

**Workspace Drift**:
A Herakles Workspace state where synced configuration expects lifecycle folders or hosted project folders that are missing, stale, misplaced, or blocked by conflicts on disk. Drift is surfaced as a blocking message that shows the exact mismatch and offers the right workspace recovery action or a local ignore.
_Avoid_: Sync mismatch, checkout task

**Canonical Checkout Path**:
The derived local path where Herakles expects a project repository to live inside a Herakles Workspace, based on lifecycle state, optional project group, and repository name.
_Avoid_: Expected path, target path, configured path

**Scaffold from Configuration**:
The user-facing action that makes a fresh Herakles Workspace with synced configuration but no matching local structure create its expected lifecycle folders and hosted project folders.
_Avoid_: Run Up, Apply Config

**Sync Workspace**:
The user-facing action that makes an existing Herakles Workspace match its synced configuration after it has drifted from the expected local structure.
_Avoid_: Run Up, Remote sync

**Config Exchange**:
The user-directed act of copying Herakles configuration into or out of the UI. It moves configuration text, not repositories, runtime state, or remote commands.
_Avoid_: Remote sync, machine profile, file sync

**Project Discovery**:
The Herakles refresh flow that reads hosted repositories and local Git folders, then updates the resolved project model. It is user-facing as project discovery or project refresh; implementation details stay out of user-facing terminology.

**Herakles Workbench**:
The local graphical surface for inspecting and operating a Herakles Workspace, including projects, pull requests, settings, and workspace recovery flows.
_Avoid_: Console, Dashboard as the whole-app name, terminal console

**Project Settings**:
The user-facing place for changing a project's connection and interpretation, including lifecycle state, project group, project tags, archive evidence, up behavior, promotion from a local experiment to a hosted repository, and same-owner hosted repository renames.
_Avoid_: Separate promotion workflow

**Starred Project**:
A tracked project the user has marked as important for Workbench attention and ordering. Starred status does not change lifecycle or workspace path.
_Avoid_: Pinned repository

**Pull Request Review**:
The Herakles Workbench surface for reviewing open pull requests across tracked hosted projects. It is a triage view over hosted repository work, not a replacement for GitHub review.
_Avoid_: Task list, internal project list

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

**Synced Configuration**:
The desired Herakles workspace configuration stored in `_herakles/herakles.toml`. It is configuration as code and should be sufficient to bootstrap the Herakles orchestrator, but Herakles does not require a specific storage or synchronization provider for it.
_Avoid_: Project-local config

**Herakles Workspace**:
The initialized local directory that contains `_herakles` and mandatory lifecycle folders where project repositories are checked out. It is the orchestrator workspace from which editors and other development tools can open or operate on managed repositories.
_Avoid_: Config root, workspace root, inventory root

**Herakles Folder**:
The `_herakles` folder inside a Herakles Workspace. It contains Herakles configuration as code plus Herakles-owned runtime artifacts such as caches and worktrees.
_Avoid_: Local config folder, hidden project

**Lifecycle Folder**:
A mandatory top-level Herakles Workspace folder for projects in a lifecycle state, with at most one optional grouping level inside it. Projects move between lifecycle folders when their lifecycle changes.
_Avoid_: Arbitrary repository root, project-local root

**Project Group**:
An optional single grouping level inside a lifecycle folder. It changes where a project repository is checked out in the Herakles Workspace, but it is not inferred by default.
_Avoid_: Nested path, owner folder, arbitrary path

**Project Tag**:
A user-defined project label used for filtering, search, and lightweight classification without changing where the repository is checked out.
_Avoid_: Folder, lifecycle state, GitHub topic

**Remote Repository**:
A hosted repository discovered by Herakles, such as a GitHub repository. Non-archived remote repositories are included in the default `herakles up` eligible set unless excluded by configured topics.
_Avoid_: Local experiment
