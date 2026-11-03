import type { AnyPluginCommand, HeraklesPlugin } from "./api";
import { commandPathSegments } from "./validate";

/** Names of the core CLI routes plugins must not replace. */
export type CoreCommandTree = {
  /** Top-level core commands, such as `status`. */
  commands: readonly string[];
  /** Core command groups and their commands, such as `projects`. */
  groups: Readonly<Record<string, readonly string[]>>;
  /** Core groups plugins may not add commands to, such as `plugins`. */
  sealedGroups: readonly string[];
};

export type MountedPluginCommand = {
  plugin: HeraklesPlugin;
  /** Route segments: `[name]` or `[group, name]`. */
  path: [string] | [string, string];
  command: AnyPluginCommand;
};

type MountResult = { ok: true; commands: MountedPluginCommand[] } | { ok: false; message: string };

/**
 * Tracks which owner holds each CLI route. Plugins may add top-level commands,
 * add commands to core groups, and create groups of their own. A plugin may
 * never replace a core route or another plugin's route, or add commands to
 * another plugin's group.
 */
export class PluginRouteTable {
  private readonly owners = new Map<string, string>();
  private readonly groupOwners = new Map<string, string>();
  private readonly sealedGroups = new Set<string>();

  constructor(core: CoreCommandTree) {
    for (const group of core.sealedGroups) this.sealedGroups.add(group);
    for (const command of core.commands) this.owners.set(command, "core");
    for (const [group, commands] of Object.entries(core.groups)) {
      this.groupOwners.set(group, "core");
      for (const command of commands) this.owners.set(`${group} ${command}`, "core");
    }
  }

  /** Mount every command of a plugin, or none of them when any path is taken. */
  mount(plugin: HeraklesPlugin): MountResult {
    const draft = this.copy();
    const commands: MountedPluginCommand[] = [];
    for (const [path, command] of Object.entries(plugin.commands ?? {})) {
      const segments = commandPathSegments(path) as MountedPluginCommand["path"];
      const conflict = draft.claim(segments, plugin.name);
      if (conflict) return { ok: false, message: conflict };
      commands.push({ plugin, path: segments, command });
    }
    this.owners.clear();
    this.groupOwners.clear();
    for (const [key, owner] of draft.owners) this.owners.set(key, owner);
    for (const [key, owner] of draft.groupOwners) this.groupOwners.set(key, owner);
    return { ok: true, commands };
  }

  private claim(path: MountedPluginCommand["path"], owner: string): string | undefined {
    const [first, second] = path;
    if (second === undefined) {
      const holder = this.owners.get(first) ?? this.groupOwners.get(first);
      if (holder) return taken(`herakles ${first}`, holder);
      this.owners.set(first, owner);
      return undefined;
    }
    const commandHolder = this.owners.get(first);
    if (commandHolder) return taken(`herakles ${first}`, commandHolder);
    if (this.sealedGroups.has(first)) {
      return `Command collision: herakles ${first} is reserved by core.`;
    }
    const groupHolder = this.groupOwners.get(first);
    if (groupHolder && groupHolder !== "core" && groupHolder !== owner) {
      return taken(`herakles ${first}`, groupHolder);
    }
    const leafHolder = this.owners.get(`${first} ${second}`);
    if (leafHolder) return taken(`herakles ${first} ${second}`, leafHolder);
    this.groupOwners.set(first, groupHolder ?? owner);
    this.owners.set(`${first} ${second}`, owner);
    return undefined;
  }

  private copy(): PluginRouteTable {
    const table = new PluginRouteTable({ commands: [], groups: {}, sealedGroups: [] });
    for (const group of this.sealedGroups) table.sealedGroups.add(group);
    for (const [key, owner] of this.owners) table.owners.set(key, owner);
    for (const [key, owner] of this.groupOwners) table.groupOwners.set(key, owner);
    return table;
  }
}

function taken(route: string, owner: string): string {
  const by = owner === "core" ? "core" : `plugin ${owner}`;
  return `Command collision: ${route} is already defined by ${by}.`;
}
