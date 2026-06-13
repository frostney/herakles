# Lock State Branches

Herakles can use the same config repository for automation coordination, but lock payloads live on deterministic state branches rather than the main configuration branch. Local fallback locks live under `_herakles/state/locks`, and the main branch gitignores `state/` so local scratch state does not become synced configuration. Run ledgers remain local cache state under `_herakles/cache/runs`.
