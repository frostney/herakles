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

Run the Electrobun desktop shell locally:

```sh
bun run desktop
```

Build unsigned macOS arm64 desktop artifacts:

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

Build and smoke the compiled executables:

```sh
bun run build
# or: bun run build:cli / bun run build:ui
./dist/herakles --help
./dist/herakles-ui --help
```

## GitHub Actions

CI is defined in `.github/workflows/ci.yml`. The workflow installs Bun 1.4.3, runs tests, runs Biome, type-checks, runs Fallow audit against an explicit base ref, and records a whole-repo Fallow health report.

Do not add a package-level `ci` script. If the full CI workflow is needed, trigger GitHub Actions.

## Release Workflow Design

CLI releases use `.github/workflows/release.yml` instead of adding publishing behavior to `.github/workflows/ci.yml`. Keep CI read-only with `contents: read`; grant `contents: write` only to the release job that creates or updates GitHub Releases.

The release flow is tag-driven:

- Trigger on semantic version tags.
- Validate the tag as `MAJOR.MINOR.PATCH`, check out the tagged commit, and fail unless the tag equals the `version` in `package.json`.
- Install with `bun install --frozen-lockfile` and run the local gate bundle before building.
- Cross-compile the CLI for `linux-x64` and `darwin-arm64` with `bun run build:cli -- --target=<bun-target> --outfile=<path>`, smoke-test the Linux binary, and write `SHA256SUMS`.
- Create a GitHub Release for the tag with generated notes and upload the binaries and checksums, or replace the assets when the release already exists.

The workflow pins Bun 1.4.3. There is no rolling `nightly` prerelease. Do not include auto-update feeds, signing credentials, notarization credentials or further platforms in the release workflow until the binary flow is proven.

## Code Review (CodeRabbit)

CodeRabbit reads `.coderabbit.config.ts`, which inherits the central `frostney/coderabbit` settings and the web-UI settings (`inheritance: true`) and excludes the vendored Agent Skills from review, using the shared `excludeVendoredSkills` function from `frostney/coderabbit`. Every skill listed in `skills-lock.json` is installed from upstream by the skills CLI, so findings on it belong upstream. A skill under `.agents/skills` that the lock does not list is project-authored and is reviewed like any other file. The config reads the lock through `skills-lock.yaml`, a symlink, because the config sandbox imports `.yaml` but not `.json`. Only CodeRabbit resolves the config's imports, so Biome and Fallow skip the file.

## Tool Choices

Herakles prefers Bun APIs for TOML, serving, bundling, tests, subprocesses, and runtime services. Stricli powers the CLI. Biome 2.5 handles formatting and linting. TypeScript 7 type-checks with `bunx tsc --noEmit`. Fallow handles repository quality evidence in CI.
