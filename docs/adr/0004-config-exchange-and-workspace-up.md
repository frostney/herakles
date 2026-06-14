# Config Exchange and Workspace Up Replace Remote Sync

Herakles does not expose a remote sync API or machine profile model. Configuration moves between machines by user-directed Config Exchange or whatever external storage the user prefers for `_herakles/herakles.toml`. A local machine then runs `herakles up` to clone or update hosted projects from that configuration.
