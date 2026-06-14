# Herakles

Herakles is a Bun-first TypeScript orchestrator for a personal Herakles Workspace: `_herakles/herakles.toml`, lifecycle folders, GitHub-backed projects, local experiments, generated reports, and recurring agent-runtime automation from one CLI and local browser UI.

## Install

```sh
bun install
```

## Usage

Create a workspace, add a project, and spin it up:

```sh
bun run herakles init --root ~/Code
bun run herakles add --root ~/Code --repo frostney/tool
bun run herakles up --root ~/Code
```

Open the local UI:

```sh
bun run ui -- --root ~/Code --no-open
```

Run automation explicitly:

```sh
bun run herakles automate tick --root ~/Code
```

See [Quick Start](docs/quick-start.md) for add/import, drift, UI, and automation flows.

## Background

Herakles treats GitHub as the source for hosted repository facts and keeps `_herakles/herakles.toml` as the sparse tracked-project list plus orchestration config. Local experiments stay local unless explicitly promoted. Generated reports, caches, worktrees, locks, and run ledgers live under `_herakles` but outside the synced TOML.

## Contribution

Use Bun for local development. See [Tooling](docs/tooling.md) for checks.

## References

- [Documentation](docs/README.md)
- [Decision Records](docs/adr/)
- [Agent Instructions](AGENTS.md)
- [License](LICENSE)
