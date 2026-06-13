# Prefer Bun APIs

Herakles should use Bun's built-in APIs for runtime, parsing, scheduling, serving, bundling, testing, SQLite, subprocesses, and filesystem-adjacent workflows whenever they cover the product need. Third-party packages are added only when Bun lacks the capability or when a domain library provides clear value beyond a thin wrapper around Bun.
