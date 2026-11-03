# Deployment

## Executive Summary

- Local development runs Herakles from source with Bun (`bun run herakles`).
- Shipped distribution uses a Bun `build --compile` single-file executable under `dist/`.
- Generated caches and worktrees stay under ignored `_herakles` folders.
- Releases are tag-driven.

## Local Runtime

Herakles is operated locally through the CLI from source during development:

```sh
bun run herakles -- <command>
```

## CLI Executable Distribution

Build a standalone Bun-native executable for the current platform:

```sh
bun run build
# or: bun run build:cli
```

This runs `scripts/build.ts`, which uses `Bun.build({ compile: ... })`. The artifact lands at `dist/herakles`.

The `package.json` `bin` entry is a thin wrapper under bin/ that prefers dist/ when present, else the TypeScript source for development. The source-dev script (`bun run herakles`) always runs from src/ and does not require a prior build.

Compiled artifacts remain ignored by git. Install by building locally and placing the artifact on PATH.

Run a built executable directly:

```sh
./dist/herakles --help
./dist/herakles --version
./dist/herakles doctor --root <workspace> --json
```

The CLI executable imports external plugin entries (`.ts` or `.js`) from tracked projects at runtime; it does not need Bun on `PATH` for that. Plugins resolve their own dependencies from their project's `node_modules`, not from packages bundled into Herakles ([ADR 0018](adr/0018-plugin-system.md)).

The binary is self-contained: copy `dist/herakles` to another directory without the source tree and run it from there.

`bun run build` compiles for the machine that runs it. `scripts/build.ts` does not take a cross-compile target, so artifacts for other operating systems or architectures must be built on that platform.

## Continuous Integration

GitHub Actions is the CI provider. See [Tooling](tooling.md) for the workflow and local verification commands.

## Release Status

CLI releases are tag-driven and published by `.github/workflows/release.yml`:

- Pushing a semantic version tag (`MAJOR.MINOR.PATCH`, no prefix) builds the CLI and publishes a GitHub release for that tag.
- The tag must equal the `version` in `package.json`, which is the version source the CLI reads for `herakles --version`. The workflow fails otherwise, so the release PR bumps `package.json` first and the tag is pushed on the merge commit.
- The workflow runs lint, typecheck, tests and the quality gate, cross-compiles the CLI for `bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-arm64` and `bun-linux-x64` with `bun run build:cli -- --target=<bun-target> --outfile=<path>`, and packages each binary as a tarball. It smoke-tests the Linux x64 binary and the binary extracted from its tarball (`--version` must print the tag, `--help` must succeed) before anything is published.
- Each release attaches four tarballs and a `SHA256SUMS` file: `herakles-<version>-<os>-<arch>.tar.gz`, where `<os>` is `macos` or `linux` and `<arch>` is `arm64` or `x64`. Each tarball holds only the `herakles` binary at its root; the raw binaries are not published. Verify a download with `sha256sum -c SHA256SUMS --ignore-missing`, then extract it with `tar -xzf` and run `chmod +x herakles` if needed.
- The Homebrew tap formula (`frostney/tap/herakles`) consumes these assets and is updated per release in `frostney/homebrew-tap`.
- Re-running the workflow for an existing release replaces its assets instead of failing.
- The rolling desktop `nightly` prerelease is retired; `main` no longer publishes builds.
- Rollback is manual: install an earlier release tarball, or run `bun add -g github:frostney/herakles#<tag>` to install that tag from source.

Signing, notarization, auto-update metadata and further platforms (Windows) are deferred.
