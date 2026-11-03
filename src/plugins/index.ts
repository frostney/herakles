import type { HeraklesPlugin } from "../plugin-host/api";
import fixPath from "./fix-path";
import prs from "./prs";
import pruneWorktrees from "./prune-worktrees";
import sync from "./sync";

/**
 * First-party plugins compiled into the Herakles binary. Each one stays off
 * until `_herakles/herakles.toml` enables it with `[plugins.<name>]`.
 */
export const bundledPlugins: readonly HeraklesPlugin[] = [fixPath, sync, prs, pruneWorktrees];
