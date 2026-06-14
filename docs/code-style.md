# Code Style

## Executive Summary

- Use `CONTEXT.md` terms in code, docs, CLI output, and UI text.
- Keep CLI, API, and UI as thin control surfaces over shared services.
- Write `_herakles/herakles.toml` only through typed config services.
- Prefer Bun runtime APIs before adding dependencies.
- Test behavior at the surface that owns the contract.

## Source Ownership

- `src/app.ts` is the service facade shared by CLI and API routes.
- `src/cli/` contains Stricli command wiring only.
- `src/api/` contains typed API routing and event streaming.
- `src/project/`, `src/up/`, `src/lifecycle/`, and `src/config/` own project resolution, workspace spin-up, validation, and config writes.
- `src/automation/` owns scheduling, locks, ledgers, and run context.
- `src/agent-runtime/` owns runtime dispatch.
- `src/ui/client/` renders the browser UI over API client calls.

## Naming

Use project language from `CONTEXT.md`. In particular:

- Use `project`, not `inventory`, for the resolved Herakles model.
- Use `agent runtime`, not `harness`, for the configured tool that receives automation prompts.
- Use `up` or `spin up workspace`, not checkout, for workspace-level setup.
- Use `Config Exchange`, not sync, for copy-paste TOML exchange.

## Config Writes

`_herakles/herakles.toml` is the canonical configuration. Config writes should be typed, minimal, and plan-first when they affect existing projects.

Generated state belongs under ignored `_herakles/cache`, `_herakles/reports`, `_herakles/worktrees`, or `_herakles/state` paths. Do not store generated ledgers, locks, reports, or caches in synced TOML.

## UI And API

The UI should call typed API routes and shared services. It should not duplicate project resolution, workspace up planning, validation, scheduling, or config mutation logic.

API routes should expose Herakles operations, not generic shell execution.

## Testing

Add focused tests near the behavior surface being changed:

- API route tests for HTTP contracts.
- CLI invocation tests for command parity.
- Service tests for domain behavior.
- UI helper tests for deterministic client logic.

Prefer fake `git`, `gh`, and `codex` binaries or injected loaders over live network or tool mutation in tests.
