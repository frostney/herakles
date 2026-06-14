# Tooling

## Executive Summary

- Bun is the only package manager and runtime for local development.
- Biome owns formatting and linting.
- TypeScript is checked with `bunx tsc --noEmit`.
- Fallow is a quality gate, with full audit run by GitHub Actions.
- There is intentionally no `bun run ci`; CI means the GitHub Actions workflow.

## Local Commands

Install dependencies:

```sh
bun install
```

Run the test suite:

```sh
bun test
```

Format:

```sh
bun run format
```

Lint:

```sh
bun run lint
```

Type check:

```sh
bunx tsc --noEmit
```

Run the local Fallow quality check:

```sh
bun run quality
```

## Smoke Checks

Run CLI commands through the package script:

```sh
bun run herakles -- <command>
```

Run the UI server without opening a browser:

```sh
bun run ui -- --root <workspace> --no-open
```

## GitHub Actions

CI is defined in `.github/workflows/ci.yml`. The workflow installs with Bun, runs tests, runs Biome, type-checks, runs a full Fallow audit, and records a Fallow health report.

Do not add a package-level `ci` script. If the full CI workflow is needed, trigger GitHub Actions.

## Tool Choices

Herakles prefers Bun APIs for TOML, cron, serving, bundling, tests, subprocesses, and runtime services. Stricli powers the CLI. Biome handles formatting and linting. Fallow handles repository quality evidence in CI.
