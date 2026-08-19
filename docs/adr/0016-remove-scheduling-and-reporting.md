# Remove Scheduling and Reporting

Herakles no longer owns scheduling, agent-runtime dispatch, or report generation. Those concerns will be handled by a separate system instead of remaining as optional or dormant Herakles features.

The removal is intentionally clean and breaking:

- The CLI, API, UI, core services, and domain model expose no scheduling or reporting behavior.
- `_herakles/herakles.toml` rejects the removed `automation`, `job`, and `codex` tables instead of migrating or ignoring them.
- New workspaces do not scaffold `_herakles/reports`, `_herakles/state`, or an automation result schema.
- Existing reports, run ledgers, locks, and other generated artifacts remain untouched. Herakles neither reads them nor creates new ones, and users decide whether to retain or delete them.

This decision supersedes [ADR 0009](0009-local-automation-lock-state.md), [ADR 0010](0010-ui-cron-and-explicit-os-cron.md), [ADR 0013](0013-automation-as-agent-runs.md), and the reporting and automation clauses in [ADR 0005](0005-no-remote-sync-api.md) and [ADR 0006](0006-separate-ui-cli.md). It does not define the replacement system or add a compatibility layer.
