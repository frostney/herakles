# Tooling

## Executive Summary

- Bun is the only package manager and runtime for local development.
- Biome owns formatting and linting.
- TypeScript is checked with `bunx tsc --noEmit`.
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

Run the Electrobun desktop shell locally:

```sh
bun run desktop
```

Build unsigned macOS desktop artifacts:

```sh
bun run desktop:build
bun run desktop:build:nightly
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

CI is defined in `.github/workflows/ci.yml`. The workflow installs with Bun, runs tests, runs Biome, type-checks, runs Fallow audit against an explicit base ref, and records a whole-repo Fallow health report.

Do not add a package-level `ci` script. If the full CI workflow is needed, trigger GitHub Actions.

## Release Workflow Design

Desktop releases use `.github/workflows/desktop.yml` instead of adding publishing behavior to `.github/workflows/ci.yml`. Keep CI read-only with `contents: read`; grant `contents: write` only to the release workflow jobs that create or update GitHub Releases.

The stable release flow is tag-driven:

- Trigger on semantic version tags.
- Check out the tagged commit and install with `bun install --frozen-lockfile`.
- Run the local gate bundle or require the matching CI run to be green before building artifacts.
- Build the unsigned macOS Electrobun artifact in the stable channel.
- Create a GitHub Release for the tag and upload the unsigned macOS artifacts.

The nightly flow is a rolling prerelease from `main`:

- Trigger after successful `main` builds, by schedule, or by manual dispatch.
- Build from the exact `main` commit being published.
- Publish or replace the assets on a single `nightly` prerelease.
- Mark the release as prerelease and keep it separate from semantic stable tags.

The nightly GitHub release uses Electrobun's canary build channel internally, so generated filenames start with `canary-` even though the GitHub release tag is `nightly`.

Do not include auto-update feeds, delta-update publishing, signing credentials, notarization credentials, Windows packaging, or Linux packaging in the first release workflow. Add those only after the unsigned macOS artifact flow is proven.

## Tool Choices

Herakles prefers Bun APIs for TOML, cron, serving, bundling, tests, subprocesses, and runtime services. Stricli powers the CLI. Biome handles formatting and linting. Fallow handles repository quality evidence in CI.
