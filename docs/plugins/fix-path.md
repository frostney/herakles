# fix-path plugin

The bundled `fix-path` plugin adds `herakles projects fix-path <project>`. It moves a hosted clone that lives at a path other than its Canonical Checkout Path to that path. Validation reports the mismatch as `hosted-clone-path-mismatch`.

## Enable

The plugin is off until `_herakles/herakles.toml` enables it ([ADR 0018](../adr/0018-plugin-system.md)):

```toml
[plugins.fix-path]
```

`herakles plugins list` shows the plugin and this line while it is off. `enabled = false` keeps the table and turns the plugin off again.

## Use

```sh
bun run herakles projects fix-path tool --root ~/Code
```

The command shows the project, the existing path and the canonical path as plan steps, then asks for confirmation. A declined or closed prompt moves nothing.

- `--yes` skips the confirmation. The steps still print.
- `--json` prints the result object `{ projectId, from, to, moved }` on stdout. The steps and the prompt go to stderr.
- The selector is a project id, slug or repository name. A slug or repository name shared by several tracked projects is refused; use the full project id.

## Safety

The plugin holds no path logic. It asks core for a plan through the `canonicalPath` plugin context service and applies it through `applyPlan`, so nothing moves without the steps being shown. Core refuses:

- a checkout or canonical path outside the Herakles Workspace, including one behind a symlink;
- a canonical path that already exists, including a dangling symlink;
- a missing checkout, and a project with no path mismatch.

Applying reloads the workspace and re-runs every check, so a path that changed after the plan is refused. The move never deletes or duplicates repositories. A failed move removes only the empty parent directories it created.
