# Definition of Done

Use this gate before handoff, review, or PR creation. A change is not done until every applicable item is satisfied or explicitly marked out of scope by the user.

## Implementation

- The delivered behavior matches the issue, confirmed mini-spec, or requested documentation change without hidden scope changes.
- The change follows the project language in [CONTEXT.md](CONTEXT.md) and the relevant boundaries in [Architecture](docs/architecture.md) and [Code Style](docs/code-style.md).
- CLI, API, and UI changes call the shared core services instead of duplicating project resolution, workspace spin-up planning, validation, scheduling, or config mutation logic.
- `_herakles/herakles.toml` remains the canonical synced configuration; generated state remains under ignored `_herakles` folders.
- Repository operations stay explicit, typed, and non-destructive. Herakles must not silently move, delete, prune, push, publish, or duplicate repositories.

## Tests and Verification

- Focused tests cover the behavior surface that owns the contract, such as API route tests for HTTP behavior, service tests for domain behavior, CLI invocation tests for command parity, or UI helper tests for deterministic client logic.
- Relevant focused checks pass before broader checks.
- Before handoff, review resolution, or PR creation, run the local gate bundle:
  - `bun run lint`
  - `bunx tsc --noEmit`
  - `bun test`
  - `bun run quality`
- Focused tests and browser/UI smoke checks are useful during development, but they do not replace the local gate bundle before handoff.
- UI-facing changes are smoke-tested with `bun run ui -- --root <workspace> --no-open` or equivalent browser evidence when the behavior cannot be covered by deterministic tests alone.

## Documentation and Decisions

- Documentation is updated when commands, structure, project language, constraints, workflows, user-facing behavior, or implementation evidence expectations change.
- Durable terminology changes are captured in [CONTEXT.md](CONTEXT.md) without implementation details.
- Durable architecture or design decisions are recorded as ADRs under `docs/adr/` only when the decision is hard to reverse, surprising without context, and the result of a real trade-off.
- Existing ADRs remain immutable except for link maintenance or explicit supersession.

## Handoff

- The diff has been self-reviewed against the issue, mini-spec, or user request criterion by criterion.
- The changeset has been reviewed by a separate review pass from the implementation work, using `/review` when available or a documented manual diff review when it is not.
- Review comments are answered in their originating threads and resolved when fixed; do not add top-level PR comments unless the user explicitly asks.
- Reviewer-facing context is captured in the PR body or handoff: summary, constraints, tests run, docs updated, ADR links, residual risks, skipped checks, and intentionally deferred work.
- There are no unrelated changes mixed into the handoff unless the user explicitly requested them.
