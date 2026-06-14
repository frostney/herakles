# Herakles

Herakles is a Bun-first TypeScript orchestrator for a personal Herakles Workspace: `_herakles/herakles.toml`, lifecycle folders, GitHub-backed projects, local experiments, generated reports, and recurring AI-harness automation from one CLI and local browser UI.

## Install

```sh
bun install
```

## Usage

Create the workspace scaffold:

```sh
bun run herakles init --root ~/Code
```

`--root` points at the Herakles Workspace. `init` creates `_herakles` plus the default lifecycle folders: `open-source/`, `commercial/`, `experiment/`, `candidate/`, and `archived/`.

Add, import, inspect, and spin up projects:

```sh
bun run herakles add --root ~/Code --repo frostney/tool
bun run herakles add --root ~/Code --source local --name local-spike
bun run herakles projects import --root ~/Code --repo frostney/tool --repo frostney/app
bun run herakles up --root ~/Code --dry-run
bun run herakles up --root ~/Code
bun run herakles projects refresh --root ~/Code
bun run herakles projects list --root ~/Code
bun run herakles remove local-spike --root ~/Code --yes
```

Hosted projects are checked out under lifecycle-derived paths such as `open-source/tool` or `commercial/clients/tool`. Project settings can change lifecycle, group, and tags through plan-first config writes.

Open the local UI:

```sh
bun run herakles ui --root ~/Code --no-open
bun run ui -- --root ~/Code --no-open
```

The UI includes project add/import flows, project settings, automation editing, manual automation runs, reports, validation, doctor checks, and a config exchange panel for copy-pasting `_herakles/herakles.toml`.

Run automation explicitly:

```sh
bun run herakles automate due --root ~/Code
bun run herakles automate tick --root ~/Code
bun run herakles automate run coderabbit --root ~/Code --slot now
```

See [docs/architecture.md](docs/architecture.md) for the domain model, workspace layout, UI/API boundaries, and automation design.

## Background

Herakles treats GitHub as the source for hosted repository facts and keeps `_herakles/herakles.toml` as the sparse tracked-project list plus orchestration config. Local experiments stay local unless explicitly promoted. Generated reports, caches, worktrees, locks, and run ledgers live under `_herakles` but outside the synced TOML.

## Contribution

For local development, use Bun and run `bun test`, `bun run lint`, `bunx tsc --noEmit`, and `bun run quality` before handoff.

## References

- [Architecture](docs/architecture.md)
- [Decision Records](docs/adr/)
- [License](LICENSE)
