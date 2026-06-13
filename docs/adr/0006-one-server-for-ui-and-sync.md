# Separate UI CLI with Optional Sync Routes

Herakles runs the browser UI through a separate CLI command and server process so the UI can stay open while other CLI commands continue to run normally. When synchronization views or client sync need it, that UI server can expose token-protected remote sync routes, but remote callers remain limited to read/sync behavior.
