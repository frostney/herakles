# Deployment

## Executive Summary

- Local development runs Herakles from source with Bun (`bun run herakles`).
- Shipped distribution uses a Bun `build --compile` single-file executable under `dist/`.
- Generated caches and worktrees stay under ignored `_herakles` folders.
- Stable releases are tag-driven.

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

The binary is self-contained: copy `dist/herakles` to another directory without the source tree and run it from there.

Cross-compilation for other OS/arch targets can use Bun's `--target=bun-<os>-<arch>` compile options when release automation needs multi-platform artifacts; the default `bun run build` targets the machine that runs it.

## Continuous Integration

GitHub Actions is the CI provider. See [Tooling](tooling.md) for the workflow and local verification commands.

## Release Status

The first release channel is a macOS arm64 Electrobun artifact attached to GitHub Releases by `.github/workflows/desktop.yml`:

- Stable releases are created from semantic version tags. The tag is the release identity; avoid release-only manifest bumps.
- Nightly builds are published from the latest successful `main` build as a single rolling `nightly` prerelease.
- Stable and nightly artifacts must include enough version, channel, commit, and architecture detail in their filenames to identify what was installed.
- Rollback is manual: download and install an earlier stable release artifact.

Signing, notarization, auto-update metadata, update feeds, macOS x64 packaging, and cross-platform installers are intentionally deferred until the unsigned macOS arm64 artifact flow is reliable.

Attaching the `dist/herakles` / `dist/herakles-ui` compile artifacts to GitHub Releases is a follow-on packaging step; local `bun run build` is the supported way to produce them today.
