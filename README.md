# Herakles

Herakles is a Bun-first TypeScript workspace orchestrator for managing many GitHub repositories, local experiments, sync plans, reports, and recurring AI-harness automation from one CLI and local browser UI.

## Install

```sh
bun install
```

## Usage

Create the workspace scaffold:

```sh
bun run herakles init --root ~/Code
```

Add, import, inspect, and sync projects:

```sh
bun run herakles add --root ~/Code --source github --repo frostney/tool
bun run herakles add --root ~/Code --source local --path local-spike --id local-spike
bun run herakles projects import --root ~/Code --repo frostney/tool --repo frostney/app
bun run herakles projects refresh --root ~/Code
bun run herakles projects list --root ~/Code
bun run herakles sync --root ~/Code --dry-run
bun run herakles sync --root ~/Code
bun run herakles remove local-spike --root ~/Code --yes
```

Open the local UI:

```sh
bun run herakles ui --root ~/Code --no-open
bun run ui -- --root ~/Code --no-open
```

Run automation explicitly:

```sh
bun run herakles automate due --root ~/Code
bun run herakles automate tick --root ~/Code
bun run herakles automate run coderabbit --root ~/Code --slot now
```

See [docs/architecture.md](docs/architecture.md) for the domain model, sync contract, UI/API boundaries, and automation design.

## Background

Herakles treats GitHub as the source for hosted repository facts and keeps `_herakles/herakles.toml` as the sparse tracked-project list plus orchestration config. Local experiments stay local unless explicitly promoted. Remote synchronization happens through token-protected Herakles server sync plans rather than synced machine profiles.

## Contribution

For local development, use Bun and run `bun test`, `bun run lint`, `bunx tsc --noEmit`, and `bun run quality` before handoff.

## References

- [Architecture](docs/architecture.md)
- [Decision Records](docs/adr/)
- [License](LICENSE)
