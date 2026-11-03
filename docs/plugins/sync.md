# Sync Plugin

The bundled `sync` plugin adds `herakles projects sync <project>`. It fetches a hosted project and fast-forwards its local default branch, and it handles local changes the way GitHub Desktop does when it pulls. It follows [ADR 0018](../adr/0018-plugin-system.md).

## Enable it

Bundled plugins are off until the synced configuration turns them on. Add the table to `_herakles/herakles.toml`:

```toml
[plugins.sync]
```

`herakles plugins list` shows the plugin and the line that enables it. Without the table, `projects sync` is an unknown command.

## What it does

```sh
herakles projects sync frostney-tool --root ~/Code
```

1. Reads the project's default branch and the checkout's current branch.
2. Shows a plan (`git fetch --all --prune`, then a fast-forward) and asks for confirmation, unless `--yes`. With `--json`, the plan and questions go to stderr and stdout holds only the result.
3. Fetches, then fast-forwards: `git pull --ff-only origin <branch>` when the default branch is checked out, otherwise `git fetch origin <branch>:refs/heads/<branch>`.

It never pushes, never creates merge commits and never moves or relocates a checkout. Only hosted projects can be synchronised; an unknown or local project is an error.

## Local changes

Local changes alone do not block the sync. Herakles attempts the fast-forward and only reacts when git refuses because local changes, tracked or untracked, would be overwritten. Then:

- In a terminal, Herakles shows a second plan and asks whether to stash the changes and continue.
- Without a terminal, or with `--json`, it stashes only when `--stash` is passed. Otherwise the project is reported as `blocked`, with the reason, and nothing is changed.

The stash is `git stash push --include-untracked -m '!!Herakles<branch>'`, so untracked files are included, and the message marks it as a Herakles stash for that branch (GitHub Desktop uses `!!GitHub_Desktop<branch>`). Both the stash and the retried fast-forward are steps of the plan that `applyPlan` shows.

Rules around the stash:

- If `git stash list` already holds a Herakles stash for the branch, the project is `blocked` and no second stash is made. Restore or drop the old one first.
- Herakles never pops or applies the stash. The result names the stash ref and commit and how to restore it: `git stash pop`, or `git stash apply <commit>` (the commit stays valid after later stashes shift `stash@{0}`).
- If the fast-forward still fails after stashing, the changes stay stashed and the result says so.

## Flags and result

| Flag | Effect |
| --- | --- |
| `--yes` | Skip the confirmation of the fetch and fast-forward plan. Required without a terminal. |
| `--stash` | Consent to stash blocking local changes and retry, without asking. |
| `--json` | Print the result as JSON; plans and questions go to stderr. |
| `--root` | Select the Herakles Workspace. |

The result has `projectId`, `branch`, `status`, `message`, `behindBefore`, `behindAfter` and, when changes were stashed, `stash` with `ref`, `commit`, `message` and `restore`. `status` is `done`, `skipped` (declined, unknown default branch, or a branch that cannot be fast-forwarded), `blocked` or `failed`. `blocked` and `failed` exit with code 1; `done` and `skipped` exit with code 0.

Herakles recognises git's English refusal text ("Your local changes to the following files would be overwritten by merge" and its untracked-file variant). With a translated git, an overlap is reported as a branch that cannot be fast-forwarded.
