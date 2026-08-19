# Separate UI CLI

> The automation and reporting route clauses are superseded by [ADR 0016](0016-remove-scheduling-and-reporting.md).

Herakles runs the browser UI through a separate CLI command and server process so the UI can stay open while other CLI commands continue to run normally. The UI server exposes typed local routes for project operations, automation, reports, validation, and config exchange; it does not expose a generic remote shell or remote sync API.
