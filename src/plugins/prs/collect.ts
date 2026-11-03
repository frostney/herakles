import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginContext } from "../../plugin-host/api";
import { describeReadFailure, ghReader, listOpenPullRequests } from "./github";
import type {
  PrsProject,
  PullRequestCollection,
  PullRequestCollectionFailure,
  PullRequestSummary,
} from "./types";

// What the cache holds. `cached` is stamped on each returned copy, so a stored entry never claims
// to be fresh.
type PullRequestSnapshot = Omit<PullRequestCollection, "cached">;

type StoredEntry = {
  expiresAt: number;
  key: string;
  value: PullRequestSnapshot;
};

const CACHE_TTL_MS = 60_000;
const CACHE_VERSION = 1;
const CACHE_FILE = "pull-requests.json";

type HostedProject = PrsProject & { owner: string };

/**
 * Open pull requests across tracked hosted projects. Reads are cached briefly
 * in the plugin cache directory; `refresh` bypasses the cache, and a read where
 * every project failed is never stored, so fixing `gh` takes effect at once.
 */
export async function collectPullRequests(
  context: PluginContext,
  options: { refresh?: boolean } = {},
): Promise<PullRequestCollection> {
  const projects = await context.projects.list();
  const hosted = projects.filter(isHosted);
  const key = cacheKey(hosted);
  const path = join(context.workspace.cacheDir, CACHE_FILE);
  if (options.refresh !== true) {
    const stored = await readStored(path, key);
    if (stored) return { ...stored, cached: true };
  }
  const value = await readFromGitHub(context, hosted, projects.length - hosted.length);
  if (!readNothing(value)) {
    await writeStored(path, { expiresAt: Date.now() + CACHE_TTL_MS, key, value }).catch(
      () => undefined,
    );
  }
  return { ...value, cached: false };
}

function isHosted(project: PrsProject): project is HostedProject {
  return project.source === "github" && project.owner !== undefined;
}

function readNothing(value: PullRequestSnapshot): boolean {
  return value.projectsRead === 0 && value.failures.length > 0;
}

async function readFromGitHub(
  context: PluginContext,
  hosted: readonly HostedProject[],
  skippedLocalProjects: number,
): Promise<PullRequestSnapshot> {
  const read = ghReader(context.gh.run);
  const settled = await Promise.allSettled(
    hosted.map((project) => listOpenPullRequests(read, `${project.owner}/${project.repo}`)),
  );
  const pullRequests: PullRequestSummary[] = [];
  const failures: PullRequestCollectionFailure[] = [];
  for (const [index, project] of hosted.entries()) {
    const result = settled[index];
    if (!result) continue;
    if (result.status === "fulfilled") {
      pullRequests.push(
        ...result.value.map((pullRequest) => ({
          ...pullRequest,
          projectId: project.id,
          projectPinned: project.pinned,
          projectSlug: project.slug,
          projectState: project.state,
        })),
      );
    } else {
      failures.push({
        projectId: project.id,
        projectSlug: project.slug,
        repo: `${project.owner}/${project.repo}`,
        message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        reason: describeReadFailure(result.reason),
      });
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    pullRequests: pullRequests.sort(
      (a, b) =>
        Number(b.projectPinned) - Number(a.projectPinned) ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.projectSlug.localeCompare(b.projectSlug),
    ),
    failures,
    projectsRead: hosted.length - failures.length,
    skippedLocalProjects,
  };
}

/** The cache holds for exactly the hosted projects, and their ordering inputs, it was read for. */
function cacheKey(hosted: readonly HostedProject[]): string {
  const identity = hosted
    .map((project) => [
      project.id,
      project.slug,
      project.owner,
      project.repo,
      project.pinned,
      project.state,
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return `${CACHE_VERSION}:${JSON.stringify(identity)}`;
}

async function readStored(path: string, key: string): Promise<PullRequestSnapshot | undefined> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Partial<StoredEntry>;
    if (raw.key !== key || typeof raw.expiresAt !== "number" || raw.expiresAt <= Date.now()) {
      return undefined;
    }
    return raw.value;
  } catch {
    return undefined;
  }
}

async function writeStored(path: string, entry: StoredEntry) {
  await mkdir(join(path, ".."), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(entry, null, 2)}\n`);
  await rename(temporary, path);
}
