# Sync Through Herakles Server

Herakles does not use synced machine profiles to decide what each computer should clone. A Herakles server exposes the resolved workspace model and sync API, and another Herakles instance can run sync against that endpoint by IP or URL; this keeps synchronization centered on the orchestrator rather than duplicating profile evaluation on every machine.
