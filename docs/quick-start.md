# Quick Start

## Executive Summary

- Install dependencies with Bun.
- Run `herakles init` once for a Herakles Workspace.
- Add or import projects, then let `herakles up` scaffold missing hosted project folders.
- Preview and apply same-owner hosted project renames through one coordinated flow.
- Move `_herakles/herakles.toml` between machines with `herakles config show` and `herakles config apply`.
- Use the CLI for add/import, rename, drift checks, and workspace spin-up.
- Enable optional features as plugins in `_herakles/herakles.toml`.

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
commands can therefore be run from a managed project without passing
`--root`:

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

The plan shows the GitHub rename, local origin update, Canonical Checkout Path move, and alphabetized tracked-project config re-key. Apply refuses dirty worktrees and can resume safely when an earlier attempt completed only some steps.

## Config Exchange

Config Exchange copies `_herakles/herakles.toml` text into or out of a Herakles Workspace. It moves configuration text only, not repositories, runtime state, or remote commands.

Print the stored TOML. The output is the file byte for byte, so redirecting it round-trips:

```sh
bun run herakles config show --root ~/Code > herakles.toml
bun run herakles config show --root ~/Code --json   # { path, toml }
```

Validate and apply TOML from another machine:

```sh
bun run herakles config apply --root ~/Code herakles.toml
cat herakles.toml | bun run herakles config apply --root ~/Code --yes -
```

`apply` parses the TOML with Bun's parser and the Herakles schema, then normalizes tracked project order. Invalid input prints each issue to stderr, exits 1, and writes nothing. If the normalized TOML equals the current file it prints `No changes.`. Otherwise it previews a line diff and asks for confirmation; `--yes` skips the prompt, and reading from stdin (`-`) requires `--yes`. With `--json`, the preview and prompt go to stderr and stdout carries the plan (declined) or the applied result.

## Spin Up

Preview workspace changes:

```sh
bun run herakles up --root ~/Code --dry-run
```

Create missing folders, clone missing hosted projects, and fast-forward clean existing clones:

```sh
bun run herakles up --root ~/Code
```

When stderr is an interactive terminal, `up` (including `--dry-run`), `add` and `projects import` show one live progress line on stderr: a spinner reading "Resolving workspace…" until the first item starts, then `[3/42] clone frostney-tool` for the current item. `projects import` spins up all imported projects as one plan, one after another, so its count runs across the whole import. The line is cleared before the table or JSON is printed, and `--json` stdout is unchanged. No progress is written when stderr is not a terminal, when `TERM=dumb`, or when `CI` is set to anything other than empty, `0` or `false`, so scripted output stays byte-identical. Ctrl-C clears the line and exits with code 130.

`up` does not silently move, delete, or duplicate repositories. Workspace drift is reported so the user can choose to scaffold from configuration or sync the workspace.

## Enable Plugins

Optional features are plugins. List the bundled plugins and any configured ones with their state:

```sh
bun run herakles plugins list --root ~/Code
```

Bundled plugins stay off until `_herakles/herakles.toml` enables them. Add a `[plugins.<name>]` table for a bundled plugin that `plugins list` shows; set `enabled = false` in it to keep the table but turn the plugin off.

An external plugin lives in a tracked project. Name the project and the entry file inside it. A hosted project needs an explicit `state` so Herakles can find its checkout without a GitHub read, and a local project must sit at its derived path:

```toml
[project.example-herakles-release-notes]
source = "github"
repo = "example/herakles-release-notes"
state = "experiment"

[plugins.release-notes]
project = "example-herakles-release-notes"
entry = "src/plugin.ts"
```

Run `herakles up` to check the project out, then its commands appear in `herakles --help`. If a plugin cannot load, core commands keep working; `herakles plugins list` and `herakles doctor` show the reason.
