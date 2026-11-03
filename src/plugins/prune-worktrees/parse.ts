/** One entry of `git worktree list --porcelain`. */
export type WorktreeEntry = {
  path: string;
  head: string;
  /** Short branch name; absent for a detached or bare worktree. */
  branch?: string;
  bare: boolean;
  detached: boolean;
  /** The lock reason; an empty string for a lock without one. Absent when unlocked. */
  locked?: string;
  /** Git's reason that the worktree is stale, such as a missing directory. */
  prunable?: string;
};

/** Parse `git worktree list --porcelain`. The first entry is the main worktree. */
export function parseWorktreeList(stdout: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  for (const record of stdout.split(/\r?\n\r?\n/)) {
    const entry = parseRecord(record);
    if (entry) entries.push(entry);
  }
  return entries;
}

function parseRecord(record: string): WorktreeEntry | undefined {
  const entry: WorktreeEntry = { path: "", head: "", bare: false, detached: false };
  for (const line of record.split(/\r?\n/)) {
    const space = line.indexOf(" ");
    const key = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? "" : line.slice(space + 1);
    applyField(entry, key, value);
  }
  return entry.path === "" ? undefined : entry;
}

function applyField(entry: WorktreeEntry, key: string, value: string) {
  switch (key) {
    case "worktree":
      entry.path = value;
      break;
    case "HEAD":
      entry.head = value;
      break;
    case "branch":
      entry.branch = value.replace(/^refs\/heads\//, "");
      break;
    case "bare":
      entry.bare = true;
      break;
    case "detached":
      entry.detached = true;
      break;
    case "locked":
      entry.locked = value;
      break;
    case "prunable":
      entry.prunable = value;
      break;
  }
}

export type MergedPullRequest = {
  number: number;
  headRefOid: string;
  baseRefName: string;
  /** The head branch lives in a fork, so it only shares a name with the local branch. */
  crossRepository: boolean;
};

/** Parse `gh pr list --json number,headRefOid,baseRefName,isCrossRepository`; undefined when the shape is wrong. */
export function parseMergedPullRequests(stdout: string): MergedPullRequest[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const pullRequests: MergedPullRequest[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") return undefined;
    const { number, headRefOid, baseRefName, isCrossRepository } = item as Record<string, unknown>;
    if (typeof number !== "number" || typeof headRefOid !== "string") return undefined;
    if (typeof baseRefName !== "string") return undefined;
    // A missing flag counts as a fork: only a same-repository head proves the local branch merged.
    pullRequests.push({
      number,
      headRefOid,
      baseRefName,
      crossRepository: isCrossRepository !== false,
    });
  }
  return pullRequests;
}

const objectId = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

export function isObjectId(value: string): boolean {
  return objectId.test(value);
}

export type UpstreamState = { configured: boolean; gone: boolean; ahead: number };

/**
 * Parse `git for-each-ref --format=%(refname)%09%(upstream)%09%(upstream:track)`
 * for one branch. The ref pattern also matches `refs/heads/<branch>/child`, so
 * pick the line for the exact ref. The track column is `[gone]`, `[ahead N]`,
 * `[behind M]`, `[ahead N, behind M]` or empty.
 */
export function parseUpstream(stdout: string, branch: string): UpstreamState | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    const [refname = "", upstream = "", track = ""] = line.split("\t");
    if (refname !== `refs/heads/${branch}`) continue;
    return {
      configured: upstream.trim() !== "",
      gone: track.includes("gone"),
      ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
    };
  }
  return undefined;
}
