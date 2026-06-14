# Agent Instructions

## Hard Constraints

- Treat `CONTEXT.md` as the authoritative language guide for Herakles terms. If terminology changes, update `CONTEXT.md` first.
- Treat `docs/architecture.md` and `docs/adr/` as the authoritative product and architecture decisions. Do not duplicate or override ADR decisions in this file.
- Use Bun for package management, scripts, tests, TOML parsing, serving, bundling, cron integration, and subprocess-oriented runtime code.
- Do not introduce npm, pnpm, yarn, Vite, project-local Herakles config, synced machine profiles, or a generic remote shell/API endpoint.
- Keep `_herakles/herakles.toml` as the canonical configuration. Do not introduce `herakles.local.toml`, project-local Herakles config, or alternate synced config files.
- Keep generated state out of synced configuration. Local Herakles artifacts belong under ignored folders inside `_herakles`.
- Treat the CLI and UI as control surfaces over the same core services; do not duplicate project resolution, workspace up planning, validation, scheduling, or config mutation logic in the UI.

## Runtime / Commands

```sh
bun install
bun test
bun run lint
bunx tsc --noEmit
bun run quality
```

Use `bun run herakles -- <command>` for CLI smoke checks and `bun run ui -- --root <workspace> --no-open` for UI server smoke checks.

## Code Organization

Use `CONTEXT.md` for domain terminology and `docs/architecture.md` for the current system model. Keep this section limited to source ownership boundaries.

- `src/app.ts` is the service facade shared by CLI and API routes.
- `src/cli/` contains Stricli command wiring only; command implementations should call shared services.
- `src/api/` contains typed API routing and event streaming; it must not expose generic shell execution.
- `src/project/`, `src/up/`, `src/lifecycle/`, and `src/config/` own project resolution, workspace spin-up, validation, and config writes.
- `src/automation/` owns scheduling, locks, ledgers, and run context. `src/agent-runtime/` owns runtime dispatch.
- `src/ui/client/` renders the browser UI over API client calls; keep plan/apply and read-only views aligned with the service contracts.
- Generated local state belongs under ignored `_herakles/cache`, `_herakles/reports`, `_herakles/worktrees`, or `_herakles/state` paths, never inside synced config except through typed config writes.

## Testing

- Use `bun test` for the full suite.
- Add focused tests near the behavior surface being changed: API route tests for HTTP contracts, CLI invocation tests for command parity, service tests for domain behavior, and UI helper tests for deterministic client logic.
- Prefer fake `git`, `gh`, and `codex` binaries or injected loaders over live network/tool mutation in tests.
- After UI-facing changes, smoke the Bun UI server with a temporary workspace when the in-app Browser tool is unavailable.

## Safety / Boundaries

- Never silently move, delete, prune, push, or publish repositories. Use explicit typed plan/apply paths.
- Herakles does not expose remote sync or generic shell APIs. Config Exchange is copy-paste TOML exchange through typed validation.
- Automation is a scheduled handoff to the configured agent runtime. Herakles owns scheduling, locks, GitHub lookup, project selection, context, and reports; the agent runtime owns implementation-specific workflows.
- Preserve user or generated changes. Do not revert unrelated files or use destructive Git commands unless explicitly requested.
