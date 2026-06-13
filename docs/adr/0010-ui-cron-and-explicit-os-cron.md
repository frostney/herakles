# UI Cron and Explicit OS Cron

Herakles runs in-process Bun cron ticks while the UI server is open, including a startup catch-up pass that executes due slots missed while the server was not running. Durable OS-level cron registration is available from the CLI, but it must be installed explicitly. The install command writes a generated worker script under the local cache path and registers that script with Bun's OS-level cron API. Bun cron wakes Herakles up, while Herakles still owns due-slot calculation, locking, duplicate prevention, and run recording.
