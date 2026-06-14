# Agent Instructions

## Hard Constraints

- Treat `CONTEXT.md` as the authoritative language guide for Herakles terms. If terminology changes, update `CONTEXT.md` first.
- Treat `docs/architecture.md`, `docs/code-style.md`, and `docs/adr/` as the authoritative product and architecture decisions. Do not duplicate or override those decisions here.
- Use Bun for package management, scripts, tests, TOML parsing, serving, bundling, cron integration, and subprocess-oriented runtime code. Do not introduce npm, pnpm, yarn, or Vite.
- Do not introduce project-local Herakles config, synced machine profiles, a remote sync API, or a generic remote shell/API endpoint.
- Keep `_herakles/herakles.toml` as the canonical configuration. Do not introduce `herakles.local.toml`, project-local Herakles config, or alternate synced config files.
- Keep generated state out of synced configuration. Local Herakles artifacts belong under ignored folders inside `_herakles`.
- Treat the CLI and UI as control surfaces over the same core services; do not duplicate project resolution, workspace up planning, validation, scheduling, or config mutation logic in the UI.

## Runtime / Commands

See `docs/tooling.md` for the full local workflow. Core checks:

```sh
bun install
bun test
bun run lint
bunx tsc --noEmit
bun run quality
```

Use `bun run herakles -- <command>` for CLI smoke checks and `bun run ui -- --root <workspace> --no-open` for UI server smoke checks.

## Code Organization

Use `CONTEXT.md` for domain terminology, `docs/architecture.md` for the system model, and `docs/code-style.md` for implementation conventions.

- `src/app.ts` is the service facade shared by CLI and API routes.
- `src/cli/` contains Stricli command wiring only; command implementations should call shared services.
- `src/api/` contains typed API routing and event streaming; it must not expose generic shell execution.
- `src/project/`, `src/up/`, `src/lifecycle/`, and `src/config/` own project resolution, workspace spin-up, validation, and config writes.
- `src/automation/` owns scheduling, locks, ledgers, and run context. `src/agent-runtime/` owns runtime dispatch.
- `src/ui/client/` renders the browser UI over API client calls; keep plan/apply and read-only views aligned with the service contracts.

## Testing

- Use `bun test` for the full suite.
- Add focused tests near the behavior surface being changed.
- Prefer fake `git`, `gh`, and `codex` binaries or injected loaders over live network/tool mutation in tests.
- After UI-facing changes, smoke the Bun UI server with a temporary workspace when the in-app Browser tool is unavailable.

## Safety / Boundaries

- Never silently move, delete, prune, push, or publish repositories. Use explicit typed plan/apply paths.
- Herakles does not expose remote sync or generic shell APIs.
- Preserve user or generated changes. Do not revert unrelated files or use destructive Git commands unless explicitly requested.
