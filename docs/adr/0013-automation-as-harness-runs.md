# Automation as Harness Runs

Herakles automation jobs are scheduled harness runs defined by prompt, schedule, project selection, tag filters, output path, and harness adapter. Herakles prepares context, claims slots, invokes the configured AI harness, and records reports; it does not own project-specific automation modes such as implementation planning, review resolution, or publishing workflows.

Cron remains the precise synced schedule format, but user-facing automation screens lead with human-readable schedule summaries. Automation schedules are interpreted in the local machine timezone at runtime rather than through synced timezone fields.
