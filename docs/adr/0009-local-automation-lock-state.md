# Local Automation Lock State

Automation locks are local machine state under `_herakles/state/locks`. They prevent duplicate in-process or explicit OS-level ticks on the same workspace from claiming the same slot at the same time, and expired locks are ignored or cleaned up before a slot is claimed again.

Herakles does not use branch locks, config-repository remotes, or a remote sync endpoint for automation coordination. A copied `_herakles/herakles.toml` can spin up another workspace, but run ledgers and locks remain local to the machine that executed the automation tick.
