# Herakles

Herakles is a Bun-first TypeScript orchestrator for a personal Herakles Workspace: `_herakles/herakles.toml`, lifecycle folders, GitHub-backed projects, and local experiments from one CLI.

## Install

```sh
bun install
```

## Usage

Create a workspace, add a project, and spin it up from source:

```sh
bun run herakles init --root ~/Code
bun run herakles add --root ~/Code --repo frostney/tool
bun run herakles up --root ~/Code
```

Move configuration between machines with Config Exchange:

```sh
bun run herakles config show --root ~/Code > herakles.toml
bun run herakles config apply --root ~/Code herakles.toml
```

Build a standalone CLI executable with Bun (`dist/herakles`), then run it or put it on `PATH`:

```sh
bun run build
./dist/herakles --help
```

See [Quick Start](docs/quick-start.md) for add/import, rename, Config Exchange, and drift flows, and [Deployment](docs/deployment.md) for bundled executable details.

## Background

Herakles treats GitHub as the source for hosted repository facts and keeps `_herakles/herakles.toml` as the sparse tracked-project list. Local experiments stay local unless explicitly promoted. Generated caches and worktrees live under `_herakles` but outside the synced TOML.

## Contribution

Use Bun for local development. See [Tooling](docs/tooling.md) for checks.

## References

- [Documentation](docs/README.md)
- [Decision Records](docs/adr/)
- [Agent Instructions](AGENTS.md)
- [License](LICENSE)
