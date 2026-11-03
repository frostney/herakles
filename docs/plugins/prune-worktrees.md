# prune-worktrees

The bundled `prune-worktrees` plugin removes linked git worktrees whose pull request is merged, and the local branch each one leaves behind. It follows [ADR 0018](../adr/0018-plugin-system.md) and stays off until the synced configuration enables it:

```toml
[plugins.prune-worktrees]
```

It adds one command, `herakles projects prune-worktrees`.

## What it scans

Every linked worktree of every tracked project's canonical checkout, from `git worktree list --porcelain`. A project that is not checked out has none. The main worktree is never a candidate.

## When a worktree is prunable

All of these must hold:

- It is clean: `git status --porcelain` is empty, untracked files included.
- Nothing is unpushed: the branch has an upstream and no commits ahead of it. A gone upstream, as after GitHub deletes a merged branch, is checked through the merged pull request below instead.
- Its pull request is merged into the default branch (hosted facts, else `origin/HEAD`); a pull request merged into another branch, as in a stack, does not count. The plugin runs `gh pr list --repo <owner/name> --head <branch> --state merged` and ignores pull requests from forks, which only share the branch name. It requires that a merged pull request's head commit equals the branch tip, or that the tip is an ancestor of it. Squash merges count, because the check uses the pull request head, not `git branch --merged`. A branch with commits after the merge is not pruned.

Everything else is skipped, with a reason in the output: `uncommitted or untracked files`, `unpushed`, `branch has no upstream`, `no merged PR`, `head moved past merged PR`, `merged PR targeted another branch`, `locked`, `detached HEAD with no branch`, `T3-managed worktree` (any path under `~/.t3/worktrees` after resolving symlinks), `worktree directory is missing`, `default branch`, a project with no GitHub repository, and `could not list merged PRs` or similar when a fact cannot be verified.

Files that git ignores, such as `node_modules`, do not make a worktree dirty. Removing the worktree deletes them, and the plan says so.

## What it does

Per prunable worktree, after the plan is shown and confirmed:

1. Recheck that the worktree is still clean and its branch tip is unchanged. If not, skip it and report why.
2. `git worktree remove -- <path>`, never `--force`.
3. `git branch -D -- <branch>`. Force deletion is safe here only because the merged pull request check proved the tip is merged; `git branch -d` cannot see a squash merge.

All of it runs inside `applyPlan`. A failure on one worktree is reported and does not stop the others; the exit code is then 1.

## Flags

- No flags: print the plan. In a terminal, ask for confirmation and apply on `yes`. Without a terminal, or with `--json`, print the plan only.
- `--yes`: apply without prompting. Required to apply when output is not a terminal or with `--json`.
- `--dry-run`: print the plan and change nothing, even with `--yes`.
- `--json`: print one JSON report on stdout (`dryRun`, `applied`, `worktrees`, `results`). The plan steps go to stderr when applying.
