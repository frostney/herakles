# Remote Sync Is Read-Only

Herakles remote sync clients may read hosted workspace state, sync plans, reports, and automation status from token-protected `/api/sync/remote/*` server endpoints, but they cannot trigger automations or mutate another machine's workspace. Automations can be mirrored as state, but each machine runs only the work that is initiated locally according to its own configuration and permissions.

Remote read payloads avoid server-local absolute paths. Project paths, report paths, and automation run report paths are projected into workspace-relative form before leaving the server. Local experiment projects are hidden from remote clients.
