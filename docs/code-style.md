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
- `src/ui/client/` renders the browser UI over API client calls.

## Naming

Use project language from `CONTEXT.md`. In particular:

- Use `project`, not `inventory`, for the resolved Herakles model.
- Use `up` or `spin up workspace`, not checkout, for workspace-level setup.
- Use `Config Exchange`, not sync, for copy-paste TOML exchange.

## Config Writes

`_herakles/herakles.toml` is the canonical configuration. Config writes should be typed, minimal, and plan-first when they affect existing projects.

Tracked project config tables are written in case-insensitive alphabetical order by project key, with the exact key as a deterministic tie-breaker. Comments immediately attached to a project table move with that table; unrelated sections and meaningful array order are preserved.

Generated state belongs under ignored `_herakles/cache` or `_herakles/worktrees` paths. Do not store generated caches in synced TOML.

## UI And API

The UI should call typed API routes and shared services. It should not duplicate project resolution, workspace up planning, validation, or config mutation logic.

API routes should expose Herakles operations, not generic shell execution.

Project action buttons should be narrow typed operations with bounded targets and validated destinations. Opening a repository in the filesystem, GitHub, Codex, or a terminal is allowed as an explicit app-launch operation; the UI should not grow arbitrary command execution or unvalidated local path handling.

Workspace-derived assets such as project icons must be served only from validated project paths inside the Herakles Workspace and must not follow symlinked files outside that boundary.

Any operation that moves repositories or serves workspace files must validate containment against real filesystem paths, not only lexical path prefixes.

## GitHub Reads

GitHub GraphQL reads may be used as a preferred path, but each read must have a REST fallback that preserves the same Herakles data contract. This includes higher-level `gh` commands whose implementation is GraphQL-backed, not only explicit `gh api graphql` calls. If both paths fail, surface the failure through the owning service instead of silently returning incomplete fields.

Tests for GraphQL-backed reads should prove that GraphQL remains preferred, REST fallback normalization is equivalent, and a failed fallback remains visible to the caller.

## Testing

Add focused tests near the behavior surface being changed:

- API route tests for HTTP contracts.
- CLI invocation tests for command parity.
- Service tests for domain behavior.
- UI helper tests for deterministic client logic.

Prefer fake `git` and `gh` binaries or injected loaders over live network or tool mutation in tests.
