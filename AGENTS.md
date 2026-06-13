# Agent Instructions

## Hard Constraints

- Use Bun for package management, scripts, tests, TOML parsing, serving, bundling, cron integration, and subprocess-oriented runtime code.
- Do not introduce npm, pnpm, yarn, Vite, project-local Herakles config, synced machine profiles, or a generic remote shell/API endpoint.
- Keep `_herakles/herakles.toml` as the canonical synced configuration. `herakles.local.toml` is limited to UI host, port, browser opening, and token location.
- Keep local experiments, reports, approvals, worktrees, caches, run ledgers, and fallback lock files out of synced configuration.
- Treat the CLI and UI as control surfaces over the same core services; do not duplicate project resolution, sync planning, validation, scheduling, or config mutation logic in the UI.

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

- `src/app.ts` is the service facade shared by CLI and API routes.
- `src/cli/` contains Stricli command wiring only; command implementations should call shared services.
- `src/api/` contains typed API routing and event streaming; it must not expose generic shell execution.
- `src/project/`, `src/sync/`, `src/lifecycle/`, and `src/config/` own resolved model, sync, validation, and config writes.
- `src/ui/client/` renders the browser UI over API client calls; keep plan/apply and read-only views aligned with the service contracts.
- Generated local state belongs under `_cache`, `_reports`, `_worktrees`, approvals, or ignored `.herakles-state`, never inside synced config except through typed sparse overrides.

## Testing

- Use `bun test` for the full suite.
- Add focused tests near the behavior surface being changed: API route tests for HTTP contracts, CLI invocation tests for command parity, service tests for domain behavior, and UI helper tests for deterministic client logic.
- Prefer fake `git`, `gh`, and `codex` binaries or injected loaders over live network/tool mutation in tests.
- After UI-facing changes, smoke the Bun UI server with a temporary workspace when the in-app Browser tool is unavailable.

## Safety / Boundaries

- Never silently move, delete, prune, push, or publish repositories. Use explicit plan/apply or approval paths.
- Remote sync clients are read/sync-only and token-protected; automations may be mirrored remotely but are not run by remote callers.
- Automation starts report-only or manual-gated. Codex is a worker over prepared context; Herakles owns scheduling, locks, GitHub lookup, reports, Git worktrees, commits, pushes, and PR creation.
- Preserve user or generated worktree changes. Do not revert unrelated files or use destructive Git commands unless explicitly requested.
