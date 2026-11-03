# prs Plugin

`prs` is a bundled first-party plugin ([ADR 0018](../adr/0018-plugin-system.md)) that reviews open pull requests across tracked hosted projects from the terminal. It is off until the synced configuration enables it.

## Enable

Add the table to `_herakles/herakles.toml`:

```toml
[plugins.prs]
```

`herakles plugins list` shows the plugin, its state and this line while it is off. Set `enabled = false` in the table to keep the entry but turn the plugin off.

## Use

```sh
herakles prs --root ~/Code
```

`prs` lists open pull requests across tracked hosted projects, starred projects first (marked `*`), then by most recently updated. The table shows project, pull request number, title, author, draft or open state, review status, check status, last update, and URL. Local experiments are skipped.

Titles longer than 60 characters are shortened with `…` in the table; `--json` keeps them whole. Projects whose GitHub read failed are reported on stderr, one short line per project, after the table. The command exits 1 only when there were hosted projects and none of them could be read, with the table output and with `--json` alike. It exits 0 when at least one project was read, even if others failed, and when the workspace has no hosted projects. When no pull requests are found and some reads failed, the message says how many projects could not be read instead of reporting an empty list.

Pass `--json` for the full result, including failures: each failure carries a short `reason` and the full `message`, which can include the `gh` arguments.

## Cache

The plugin reads GitHub through the plugin context's `gh.run` and keeps its generated state under `_herakles/cache/plugins/prs`. A read is cached for one minute for the same set of hosted projects. A read where every project failed is not cached, so a rerun reads again. When the result comes from the cache, a one-line note on stderr gives the time it was read and `--json` reports `"cached": true`. Pass `--refresh` to bypass the cache.
