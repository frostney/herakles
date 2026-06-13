# Herakles

Herakles is a Bun-first TypeScript workspace orchestrator for managing many GitHub repositories, local experiments, sync plans, reports, approvals, and recurring automation from one CLI and local browser UI.

## Install

```sh
bun install
```

## Usage

Create the workspace scaffold:

```sh
bun run herakles init --root ~/Code
```

Inspect and sync repositories:

```sh
bun run herakles inventory refresh --root ~/Code
bun run herakles repo list --root ~/Code
bun run herakles sync --root ~/Code --dry-run
bun run herakles sync --root ~/Code
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

Herakles treats GitHub as the source for repository facts and keeps `_herakles/herakles.toml` sparse. Local experiments stay local unless explicitly promoted. Remote synchronization happens through token-protected Herakles server sync plans rather than synced machine profiles.

## Contribution

For local development, use Bun and run `bun test`, `bun run lint`, `bunx tsc --noEmit`, and `bun run quality` before handoff.

## References

- [Architecture](docs/architecture.md)
- [Decision Records](docs/adr/)
- [License](LICENSE)
