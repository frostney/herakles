# Canonical Workspace Config

Herakles uses `_herakles/herakles.toml` as the canonical Herakles Workspace configuration file and does not support project-local development config, `herakles.local.toml`, machine profiles, or a Herakles-managed config repository.

Users may put `_herakles/herakles.toml` wherever they prefer for their own synchronization workflow, including a Git repository, Gist, notes system, or plain file copy. Herakles itself treats the TOML as local input: Config Exchange lets the UI copy, paste, validate, and apply it, and `herakles up` materializes the workspace from it.
