import type { HeraklesPlugin } from "../plugin-host/api";
import prs from "./prs";

/**
 * First-party plugins compiled into the Herakles binary. Each one stays off
 * until `_herakles/herakles.toml` enables it with `[plugins.<name>]`.
 */
export const bundledPlugins: readonly HeraklesPlugin[] = [prs];
