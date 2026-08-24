# Deployment

## Executive Summary

- Local development still runs Herakles from source with Bun (`bun run herakles`, `bun run ui`).
- Shipped CLI/UI distribution uses Bun `build --compile` single-file executables under `dist/`.
- The UI remains a local Bun fullstack server, not a hosted SaaS deployment.
- The first packaged desktop target is an unsigned macOS arm64 Electrobun app.
- Generated caches and worktrees stay under ignored `_herakles` folders.
- Stable releases are tag-driven, and nightly builds are a rolling prerelease from `main`.
- Auto-update, signing, and notarization are out of scope for the first desktop packaging pass.

## Local Runtime

Herakles is operated locally through the CLI and UI from source during development:

```sh
bun run herakles -- <command>
bun run ui -- --root <workspace> --no-open
bun run desktop
```

The UI server uses Bun's fullstack server model and serves the local Herakles Workspace.

## CLI Executable Distribution

Build standalone Bun-native executables for the current platform:

```sh
bun run build
# or individually:
bun run build:cli
bun run build:ui
```

This runs `scripts/build.ts`, which uses `Bun.build({ compile: ... })` with `bun-plugin-tailwind` so the CLI and UI binaries embed the Workbench HTML/CSS/JS assets. Artifacts land at:

- `dist/herakles` — main CLI (includes `herakles ui`)
- `dist/herakles-ui` — direct UI server entrypoint

`package.json` `bin` entries are thin wrappers under bin/ that prefer dist/ when present, else TypeScript sources for development. Source-dev scripts (`bun run herakles`, `bun run ui`) always run from src/ and do not require a prior build.

Compiled artifacts remain ignored by git. Install by building locally and placing the artifact on PATH.

Run a built executable directly:

```sh
./dist/herakles --help
./dist/herakles --version
./dist/herakles doctor --root <workspace> --json
./dist/herakles-ui --root <workspace> --no-open
```

The binaries are self-contained: copy `dist/herakles` (or `dist/herakles-ui`) to another directory without the source tree and run it from there. Electrobun desktop packaging remains a separate path and is unchanged by this CLI bundle flow.

Cross-compilation for other OS/arch targets can use Bun's `--target=bun-<os>-<arch>` compile options when release automation needs multi-platform artifacts; the default `bun run build` targets the machine that runs it.

Caveat: herakles-ui HTML/asset compile uses Bun fullstack HTML imports; Tailwind at-source warnings during compile can appear. Verify UI routes after rebuilding client assets.

## Desktop Distribution

Herakles desktop distribution starts macOS-first through Electrobun. The packaged app is a native shell around the same local Workbench and shared core services used by the CLI and browser UI; it is not a hosted service, remote command API, or separate project model.

The first artifacts are unsigned macOS arm64 release archives intended for deliberate manual installation and testing. Users should expect normal macOS unsigned-app first-run friction until signing and notarization are intentionally added. Do not wire auto-update, delta update, signing, notarization, macOS x64 packaging, Windows packaging, or Linux packaging into the first release workflow.

Local desktop packaging commands:

```sh
bun run desktop:build
bun run desktop:build:nightly
```

Stable artifacts use Electrobun's stable channel and are named like `stable-macos-arm64-HeraklesWorkbench.dmg`. Nightly artifacts are uploaded to the `nightly` GitHub prerelease but use Electrobun's canary build channel, so the local filenames begin with `canary-`. The first workflow intentionally builds only arm64 artifacts on GitHub's `macos-26` arm64 runner.

Desktop packaging must preserve the same Herakles Workspace boundary as the source UI. The native shell should not infer a project-local config file or sync profile. `_herakles/herakles.toml` remains the canonical synced configuration, and generated desktop state remains local machine state.

## Desktop Workspace Root

The CLI and Bun UI server continue to accept `--root <workspace>`. The Electrobun shell owns the native first-use experience around that same root value:

- On first launch, ask the user to choose a Herakles Workspace rather than relying on the app bundle working directory.
- Store the selected Herakles Workspace Root in native local app preferences.
- On later launches, prefer that saved root when it still points at a valid Herakles Workspace.
- If the saved root is missing or invalid, ask again before starting the Workbench.
- Keep the saved root out of `_herakles/herakles.toml` and other synced configuration.

This preference is a local desktop convenience only. Config Exchange and workspace spin-up still operate on the selected Herakles Workspace and do not introduce machine profiles or remote sync.

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
