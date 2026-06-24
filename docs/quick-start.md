# Quick Start

## Executive Summary

- Install dependencies with Bun.
- Run `herakles init` once for a Herakles Workspace.
- Add or import projects, then let `herakles up` scaffold missing hosted project folders.
- Use the UI for add/import, pull request review, project settings, drift checks, automation, reports, and config exchange.
- Run automation manually with `automate tick` or a named `automate run`.

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

The UI covers project add/import, pull request review, project settings, workspace drift, validation, doctor checks, automation editing, manual automation runs, reports, and Config Exchange.

## Run Automation

List due automation slots:

```sh
bun run herakles automate due --root ~/Code
```

Run the due tick:

```sh
bun run herakles automate tick --root ~/Code
```

Run one job immediately:

```sh
bun run herakles automate run morning_next_work --root ~/Code --slot now
```
