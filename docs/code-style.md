# Code Style

## Executive Summary

- Use `CONTEXT.md` terms in code, docs, and CLI output.
- Keep the CLI a thin control surface over shared services.
- Write `_herakles/herakles.toml` only through typed config services.
- Prefer Bun runtime APIs before adding dependencies.
- Test behavior at the surface that owns the contract.

## Source Ownership

- `src/app.ts` is the service facade the CLI calls.
- `src/cli/` contains Stricli command wiring only, including the context handed to plugin commands.
- `src/project/`, `src/up/`, `src/lifecycle/`, and `src/config/` own project resolution, workspace spin-up, validation, and config writes.
- `src/plugin-host/` owns the plugin API (`api.ts`) and plugin loading, checks and command routing.
- `src/plugins/<name>/` holds one bundled plugin; `src/plugins/index.ts` is the bundled plugin registry.

## Plugins

Add an optional feature as a bundled plugin under `src/plugins/<name>/` rather than as a core command. A bundled plugin imports only `src/plugin-host/api.ts`, its own files and package dependencies, the same surface an external plugin has. Core imports bundled plugins only through the registry. Fallow boundary zones in `fallow.toml` enforce both rules.

When a plugin needs a core service the context lacks, add it to the context in `src/plugin-host/api.ts` as an additive change instead of importing core. Keep logic that guards a core invariant, such as Canonical Checkout Path containment, in core. Feature logic belongs in the plugin.

A plugin operation that moves, deletes, prunes, pushes or publishes goes through `context.applyPlan` so the user sees the steps and confirms them.

## Naming

Use project language from `CONTEXT.md`. In particular:

- Use `project`, not `inventory`, for the resolved Herakles model.
- Use `up` or `spin up workspace`, not checkout, for workspace-level setup.
- Use `Config Exchange`, not sync, for copy-paste TOML exchange.

## Config Writes

`_herakles/herakles.toml` is the canonical configuration. Config writes should be typed, minimal, and plan-first when they affect existing projects.

Tracked project config tables are written in case-insensitive alphabetical order by project key, with the exact key as a deterministic tie-breaker. Comments immediately attached to a project table move with that table; unrelated sections and meaningful array order are preserved.

Generated state belongs under ignored `_herakles/cache` or `_herakles/worktrees` paths. Do not store generated caches in synced TOML.

## CLI Commands

Commands should call shared services. They should not duplicate project resolution, workspace up planning, validation, or config mutation logic.

Commands should expose Herakles operations, not generic shell execution.

Any operation that moves repositories must validate containment against real filesystem paths, not only lexical path prefixes.

## GitHub Reads

GitHub GraphQL reads may be used as a preferred path, but each read must have a REST fallback that preserves the same Herakles data contract. This includes higher-level `gh` commands whose implementation is GraphQL-backed, not only explicit `gh api graphql` calls. If both paths fail, surface the failure through the owning service instead of silently returning incomplete fields.

Tests for GraphQL-backed reads should prove that GraphQL remains preferred, REST fallback normalization is equivalent, and a failed fallback remains visible to the caller.

## Testing

Add focused tests near the behavior surface being changed:

- CLI invocation tests for command behavior and output.
- Service tests for domain behavior.

Prefer fake `git` and `gh` binaries or injected loaders over live network or tool mutation in tests.
