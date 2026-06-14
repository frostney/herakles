# Deployment

## Executive Summary

- Herakles currently runs from source with Bun.
- The UI is a local Bun fullstack server, not a hosted SaaS deployment.
- OS-level automation cron is explicit local machine state.
- Generated reports, caches, worktrees, ledgers, and locks stay under ignored `_herakles` folders.
- Release packaging is not defined yet.

## Local Runtime

Herakles is operated locally through the CLI and UI:

```sh
bun run herakles -- <command>
bun run ui -- --root <workspace> --no-open
```

The UI server uses Bun's fullstack server model and serves the local Herakles Workspace. It can run in-process automation ticks while it is open.

## Scheduled Automation

OS-level cron registration is available from the CLI and must be explicit. The generated worker is local machine state under `_herakles/cache` and calls the shared automation service for the workspace.

Automation schedules are synced configuration, but locks, run ledgers, reports, and generated worker files are local artifacts.

## Continuous Integration

GitHub Actions is the CI provider. See [Tooling](tooling.md) for the workflow and local verification commands.

## Release Status

No package, installer, hosted service, or rollback process is defined yet. When release packaging is introduced, document the build profile, artifact format, installation path, and rollback process here.
