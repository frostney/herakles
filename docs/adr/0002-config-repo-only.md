# Config Repo Only

Herakles uses `_herakles/herakles.toml` as the canonical synced configuration file and does not support a project-local development config fallback. Tests and fixtures should model the orchestrator and its config repository because the product is meant to coordinate many repositories rather than configure a single repository from inside that repository.
