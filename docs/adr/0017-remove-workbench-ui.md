# Remove the Workbench UI

Herakles is CLI-only. The browser Workbench (`herakles ui`, the `herakles-ui` executable, and the `/api` routes and server-sent events behind it) and the Electrobun desktop app are removed instead of being maintained alongside the CLI.

Maintaining a browser UI, a typed API layer, a live event stream, and a desktop shell next to the CLI multiplied the surface that every change had to cover, including a React/Tailwind client stack, desktop packaging, and nightly desktop builds, while the CLI already called the same core services.

The removal is intentionally clean and breaking:

- The UI-only features were ported to CLI commands before this removal: `herakles prs`, `herakles projects fix-path`, `herakles projects sync`, and `herakles config show` and `herakles config apply`.
- The `herakles ui` command, the `herakles-ui` executable, `src/ui`, `src/api`, and the `/api` routes and SSE events are gone. There is no browser or desktop surface.
- Desktop distribution and nightly builds are retired. Releases publish the CLI executable.
- Core services that only the UI called are removed. Services that the CLI commands call remain shared core services.
- The change ships as a breaking release, 3.0.0.

This decision supersedes [ADR 0006](0006-separate-ui-cli.md), [ADR 0007](0007-tanstack-start-with-bun-bundler.md), [ADR 0014](0014-bun-plugin-tailwind-for-workbench-styling.md), and [ADR 0015](0015-vendor-production-design-assets.md). [ADR 0010](0010-ui-cron-and-explicit-os-cron.md) was already superseded by [ADR 0016](0016-remove-scheduling-and-reporting.md). Other ADRs mention the UI or `herakles-ui` in passing; their decisions otherwise stand.
