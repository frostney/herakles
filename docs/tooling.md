# Tooling

## Executive Summary

- Bun 1.4.3 is the only package manager and runtime for local development.
- Biome 2.5.x owns formatting and linting.
- TypeScript 7 is checked with `bunx tsc --noEmit`.
- Fallow audit is the changed-file quality gate in GitHub Actions.
- There is intentionally no `bun run ci`; CI means the GitHub Actions workflow.
- Release packaging belongs in a separate GitHub Actions workflow from CI.

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

Build and smoke the compiled executable:

```sh
bun run build
# or: bun run build:cli
./dist/herakles --help
```

## GitHub Actions

CI is defined in `.github/workflows/ci.yml`. The workflow installs Bun 1.4.3, runs tests, runs Biome, type-checks, runs Fallow audit against an explicit base ref, and records a whole-repo Fallow health report.

Do not add a package-level `ci` script. If the full CI workflow is needed, trigger GitHub Actions.

## Release Workflow Design

Releases use their own workflow instead of adding publishing behavior to `.github/workflows/ci.yml`. Keep CI read-only with `contents: read`; grant `contents: write` only to the release workflow jobs that create or update GitHub Releases.

The release flow is tag-driven:

- Trigger on semantic version tags.
- Validate the tag as `MAJOR.MINOR.PATCH`, check out the tagged commit, and install with `bun install --frozen-lockfile`.
- Run the local gate bundle or require the matching CI run to be green before building artifacts.
- Build the CLI executables and attach them to a GitHub Release for the tag.

## Code Review (CodeRabbit)

CodeRabbit reads `.coderabbit.config.ts`, which inherits the central `frostney/coderabbit` settings and the web-UI settings (`inheritance: true`) and excludes the vendored Agent Skills from review, using the shared `excludeVendoredSkills` function from `frostney/coderabbit`. Every skill listed in `skills-lock.json` is installed from upstream by the skills CLI, so findings on it belong upstream. A skill under `.agents/skills` that the lock does not list is project-authored and is reviewed like any other file. The config reads the lock through `skills-lock.yaml`, a symlink, because the config sandbox imports `.yaml` but not `.json`. Only CodeRabbit resolves the config's imports, so Biome and Fallow skip the file.

## Tool Choices

Herakles prefers Bun APIs for TOML, serving, bundling, tests, subprocesses, and runtime services. Stricli powers the CLI. Biome 2.5 handles formatting and linting. TypeScript 7 type-checks with `bunx tsc --noEmit`. Fallow handles repository quality evidence in CI.
