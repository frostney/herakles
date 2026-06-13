# Lock State Branches

Herakles uses the same config repository for remote automation coordination, but lock payloads live on deterministic state branches rather than the main configuration branch. Those branches can commit files such as `.herakles-state/locks/<job>/<slot>.json`, while the main branch gitignores `.herakles-state/` so local scratch state does not become synced configuration. Run ledgers remain local cache state because remote clients may mirror automation status but do not run another machine's jobs.
