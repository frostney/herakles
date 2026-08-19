# Quick Start

## Executive Summary

- Install dependencies with Bun.
- Run `herakles init` once for a Herakles Workspace.
- Add or import projects, then let `herakles up` scaffold missing hosted project folders.
- Preview and apply same-owner hosted project renames through one coordinated flow.
- Use the UI for add/import, pull request review, project settings, drift checks, and config exchange.

## Install

```sh
bun install
```

## Create A Workspace

```sh
bun run herakles init --root ~/Code
```

`--root` is the Herakles Workspace. `init` creates `_herakles`, `_herakles/herakles.toml`, and the default lifecycle folders:

- `open-source/`
- `commercial/`
- `experiment/`
- `candidate/`
- `archived/`

## Run From Inside A Workspace

After initialization, Herakles discovers the Herakles Workspace by looking for
`_herakles/herakles.toml` in the current directory and its ancestors. CLI
commands and the UI can therefore be started from a managed project without
passing `--root`:

```sh
cd ~/Code/open-source/tool
herakles projects show tool
```

Pass `--root <workspace>` to select an exact Herakles Workspace explicitly.
`herakles init` does not search ancestors; it initializes the explicit
`--root` path or the current directory.

## Add Projects

Add an existing GitHub repository:

```sh
bun run herakles add --root ~/Code --repo frostney/tool
```

Add a local experiment:

```sh
bun run herakles add --root ~/Code --source local --name local-spike
```

Bulk import known GitHub repositories:

```sh
bun run herakles projects import --root ~/Code --repo frostney/tool --repo frostney/app
```

Hosted add/import writes the minimal project config and runs workspace spin-up for the new project. GitHub is implied for hosted repositories.

## Rename Projects

Preview a same-owner hosted repository rename:

```sh
bun run herakles projects rename frostney-tool frostney/new-tool --root ~/Code
```

Apply the validated plan:

```sh
bun run herakles projects rename frostney-tool frostney/new-tool --root ~/Code --apply
```

The plan shows the GitHub rename, local origin update, Canonical Checkout Path move, and alphabetized tracked-project config re-key. Apply refuses dirty worktrees and can resume safely when an earlier attempt completed only some steps. Project Settings exposes the same preview-before-apply flow in the Workbench.

## Spin Up

Preview workspace changes:

```sh
bun run herakles up --root ~/Code --dry-run
```

Create missing folders, clone missing hosted projects, and fast-forward clean existing clones:

```sh
bun run herakles up --root ~/Code
```

`up` does not silently move, delete, or duplicate repositories. Workspace drift is reported so the user can choose to scaffold from configuration or sync the workspace.

## Open The UI

```sh
bun run ui -- --root ~/Code --no-open
```

The UI covers project add/import, pull request review, project settings, workspace drift, validation, doctor checks, and Config Exchange.
