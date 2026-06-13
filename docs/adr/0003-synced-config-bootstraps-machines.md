# Synced Config Bootstraps the Orchestrator

Herakles treats `_herakles/herakles.toml` as the required synced configuration and `herakles.local.toml` as optional UI-only machine convenience. The local file cannot override repositories, lifecycle, sync, automation, root layout, or remote selection. The synced file should be sufficient to start the orchestrator for the configured remote repositories; cross-machine synchronization is handled by a Herakles client requesting a sync plan from a Herakles server rather than by selecting a synced machine profile.
