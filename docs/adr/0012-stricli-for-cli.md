# Stricli for the CLI

Herakles uses Stricli for command routing and argument parsing in both the main `herakles` CLI and the direct `herakles-ui` server entrypoint. The CLI surface should depend on the previously selected modern, community-driven TypeScript CLI library rather than drifting to a different implementation library without a product reason.

Stricli is an MIT-licensed OSS command-line library from Bloomberg with type-safe command definitions, route maps for nested commands, generated help, runtime input parsing, and no runtime dependencies. That gives Herakles a real CLI framework while preserving the earlier library decision and keeping the CLI layer small enough to run directly under Bun.
