# Synced Config Bootstraps the Orchestrator

Herakles treats `_herakles/herakles.toml` as the required configuration-as-code file for a Herakles Workspace. There is no `herakles.local.toml`, synced machine profile, remote sync endpoint, or configured root override. A copied `herakles.toml` plus `herakles up` should be enough to spin up the orchestrator and hosted checkouts on a new machine.
