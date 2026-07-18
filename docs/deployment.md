# Deployment

## Executive Summary

- Herakles currently runs from source with Bun.
- The UI is a local Bun fullstack server, not a hosted SaaS deployment.
- The first packaged target is an unsigned macOS arm64 Electrobun desktop app.
- OS-level automation cron is explicit local machine state.
- Generated reports, caches, worktrees, ledgers, and locks stay under ignored `_herakles` folders.
- Stable releases are tag-driven, and nightly builds are a rolling prerelease from `main`.
- Auto-update, signing, and notarization are out of scope for the first desktop packaging pass.

## Local Runtime

Herakles is operated locally through the CLI and UI:

```sh
bun run herakles -- <command>
bun run ui -- --root <workspace> --no-open
bun run desktop
```

The UI server uses Bun's fullstack server model and serves the local Herakles Workspace. It can run in-process automation ticks while it is open.

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

## Scheduled Automation

OS-level cron registration is available from the CLI and must be explicit. The generated worker is local machine state under `_herakles/cache` and calls the shared automation service for the workspace.

Automation schedules are synced configuration, but locks, run ledgers, reports, and generated worker files are local artifacts.

## Continuous Integration

GitHub Actions is the CI provider. See [Tooling](tooling.md) for the workflow and local verification commands.

## Release Status

The first release channel is a macOS arm64 Electrobun artifact attached to GitHub Releases by `.github/workflows/desktop.yml`:

- Stable releases are created from semantic version tags. The tag is the release identity; avoid release-only manifest bumps.
- Nightly builds are published from the latest successful `main` build as a single rolling `nightly` prerelease.
- Stable and nightly artifacts must include enough version, channel, commit, and architecture detail in their filenames to identify what was installed.
- Rollback is manual: download and install an earlier stable release artifact.

Signing, notarization, auto-update metadata, update feeds, macOS x64 packaging, and cross-platform installers are intentionally deferred until the unsigned macOS arm64 artifact flow is reliable.
