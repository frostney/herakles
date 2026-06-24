# Agent Instructions

## Authoritative Docs

- Product language: `CONTEXT.md`
- System model: `docs/architecture.md`
- Implementation conventions: `docs/code-style.md`
- Development workflow: `docs/tooling.md`
- Decisions: `docs/adr/`

Read the relevant source before changing that area. Keep decisions in one place; do not restate architecture or code-style detail here.

## Hard Constraints

- Use Bun for package management, scripts, tests, TOML parsing, serving, bundling, cron integration, and subprocess-oriented runtime code. Do not introduce npm, pnpm, yarn, or Vite.
- Do not introduce project-local Herakles config, synced machine profiles, a remote sync API, or a generic remote shell/API endpoint.
- Keep `_herakles/herakles.toml` as the canonical configuration. Do not introduce `herakles.local.toml`, project-local Herakles config, or alternate synced config files.
- Keep generated state out of synced configuration. Local Herakles artifacts belong under ignored folders inside `_herakles`.
- Treat the CLI and UI as control surfaces over the same core services; do not duplicate project resolution, workspace up planning, validation, scheduling, or config mutation logic in the UI.
- Never silently move, delete, prune, push, or publish repositories.

## Runtime / Commands

```sh
bun install
bun test
bun run lint
bunx tsc --noEmit
bun run quality
```

Smoke CLI changes with `bun run herakles -- <command>`. Smoke UI changes with `bun run ui -- --root <workspace> --no-open`.

## Code Organization

Do not add a directory map here. Source ownership belongs in the implementation conventions doc.

## Testing

- Use `bun test` for the full suite.
- Add focused tests near the behavior surface being changed; do not add tests that only restate implementation.
- Prefer fake `git`, `gh`, and `codex` binaries or injected loaders over live network or tool mutation.
- After UI-facing changes, smoke the Bun UI server with a temporary workspace when the in-app Browser tool is unavailable.
- Before handoff, review resolution, or PR creation, verify the applicable items in [DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md).

## Safety / Boundaries

- Use explicit typed plan/apply paths for repository operations.
- Preserve user or generated changes. Do not revert unrelated files or use destructive Git commands unless explicitly requested.
