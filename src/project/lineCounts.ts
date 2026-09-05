import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { ProjectLineCounts } from "../domain";

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "_herakles",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "vendor",
]);

const countedExtensions = new Set([
  ".astro",
  ".c",
  ".clj",
  ".cljs",
  ".cpp",
  ".cs",
  ".css",
  ".dart",
  ".erl",
  ".ex",
  ".exs",
  ".fs",
  ".go",
  ".h",
  ".hpp",
  ".hrl",
  ".html",
  ".inc",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".lua",
  ".mjs",
  ".pas",
  ".php",
  ".pl",
  ".pp",
  ".py",
  ".r",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
  ".zig",
]);

const countedBasenames = new Set(["Dockerfile", "Makefile"]);

type LineCountCacheFile = {
  version: 1;
  projects: Record<string, { stamp: string; loc: number; sloc: number }>;
};

type DiskCacheState = {
  cache: LineCountCacheFile;
  dirty: boolean;
  revision: number;
  /** Serializes flushes for this cache file so concurrent callers cannot overwrite a newer revision. */
  flushPromise?: Promise<void> | undefined;
};

const memoryCache = new Map<string, { stamp: string; counts: ProjectLineCounts }>();
const diskCaches = new Map<string, DiskCacheState>();

type LineCountWriteFile = typeof writeFile;
let lineCountWriteFile: LineCountWriteFile = writeFile;

/** Test-only: replace the writeFile used by flushLineCountCache. Pass null/undefined to restore. */
export function __setLineCountWriteFileForTests(fn?: LineCountWriteFile | null): void {
  lineCountWriteFile = fn ?? writeFile;
}

function cacheFilePath(cacheDir: string): string {
  return join(cacheDir, "line-counts.json");
}

function memoryCacheKey(projectPath: string, cacheDir?: string): string {
  return `${cacheDir ?? ""}\0${projectPath}`;
}

export function countProjectLines(
  projectPath: string,
  cacheDir?: string,
): ProjectLineCounts | undefined {
  if (!existsSync(projectPath)) return undefined;
  const inventory = collectInventory(projectPath);
  const stamp = stampInventory(inventory);
  const memKey = memoryCacheKey(projectPath, cacheDir);
  const cached = memoryCache.get(memKey);
  if (cached?.stamp === stamp) return { ...cached.counts };

  const fromDisk = cacheDir ? readDiskEntry(cacheDir, projectPath) : undefined;
  if (fromDisk?.stamp === stamp) {
    memoryCache.set(memKey, { stamp, counts: { loc: fromDisk.loc, sloc: fromDisk.sloc } });
    return { loc: fromDisk.loc, sloc: fromDisk.sloc };
  }

  const totals: ProjectLineCounts = { loc: 0, sloc: 0 };
  for (const file of inventory) {
    countFile(file.path, totals);
  }
  memoryCache.set(memKey, { stamp, counts: { ...totals } });
  if (cacheDir) writeDiskEntry(cacheDir, projectPath, stamp, totals);
  return totals;
}

/** Flush pending cache writes for a workspace cache directory. Never throws. */
export async function flushLineCountCache(cacheDir?: string): Promise<void> {
  if (!cacheDir) return;
  const path = cacheFilePath(cacheDir);
  const state = diskCaches.get(path);
  if (!state) return;
  if (!state.dirty && !state.flushPromise) return;

  const previous = state.flushPromise;
  const run = (async () => {
    if (previous) await previous;
    await flushUntilClean(path, state);
  })();

  state.flushPromise = run;
  try {
    await run;
  } finally {
    if (state.flushPromise === run) {
      state.flushPromise = undefined;
    }
  }
}

/** Persist until clean or a write fails. Only one caller runs this per state (via flushPromise). */
async function flushUntilClean(path: string, state: DiskCacheState): Promise<void> {
  while (state.dirty) {
    const revision = state.revision;
    const payload = `${JSON.stringify(state.cache)}\n`;
    try {
      await mkdir(dirname(path), { recursive: true });
      await lineCountWriteFile(path, payload, "utf8");
      if (state.revision === revision) {
        state.dirty = false;
      }
      // else revision advanced during the write — loop and persist the newer snapshot
    } catch {
      // Keep dirty so a later flush can retry; never fail workspace load.
      return;
    }
  }
}

type InventoryFile = { path: string; mtimeMs: number; size: number };

function collectInventory(projectPath: string): InventoryFile[] {
  const files: InventoryFile[] = [];
  visit(projectPath, files, true);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return files;
}

function stampInventory(files: InventoryFile[]): string {
  const hash = createHash("sha1");
  for (const file of files) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(String(file.mtimeMs));
    hash.update("\0");
    hash.update(String(file.size));
    hash.update("\n");
  }
  return hash.digest("hex");
}

function visit(path: string, files: InventoryFile[], isRoot = false) {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) return;
  if (!isRoot && basename(path).startsWith(".")) return;
  if (stat.isDirectory()) {
    if (ignoredDirectories.has(basename(path))) return;
    let entries: string[];
    try {
      entries = readdirSync(path);
    } catch {
      return;
    }
    for (const entry of entries) {
      visit(join(path, entry), files);
    }
    return;
  }
  if (!stat.isFile() || !isCountedFile(path)) return;
  files.push({ path, mtimeMs: stat.mtimeMs, size: stat.size });
}

function isCountedFile(path: string): boolean {
  const name = basename(path);
  return countedBasenames.has(name) || countedExtensions.has(extname(name).toLowerCase());
}

function countFile(path: string, totals: ProjectLineCounts) {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  if (!text) return;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n")
    : normalized.split("\n");
  for (const line of lines) {
    totals.loc += 1;
    if (isSourceLine(line)) totals.sloc += 1;
  }
}

function isSourceLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && !/^(?:\/\/|#|--|;|\/\*|\*|<!--)/.test(trimmed);
}

function ensureDiskCache(cacheDir: string): DiskCacheState {
  const path = cacheFilePath(cacheDir);
  const existing = diskCaches.get(path);
  if (existing) return existing;

  const state: DiskCacheState = {
    cache: { version: 1, projects: {} },
    dirty: false,
    revision: 0,
  };
  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as LineCountCacheFile;
      if (parsed?.version === 1 && parsed.projects && typeof parsed.projects === "object") {
        state.cache = parsed;
      }
    } catch {
      // ignore corrupt cache
    }
  }
  diskCaches.set(path, state);
  return state;
}

function readDiskEntry(cacheDir: string, projectPath: string) {
  return ensureDiskCache(cacheDir).cache.projects[projectPath];
}

function writeDiskEntry(
  cacheDir: string,
  projectPath: string,
  stamp: string,
  counts: ProjectLineCounts,
) {
  const state = ensureDiskCache(cacheDir);
  state.cache.projects[projectPath] = { stamp, loc: counts.loc, sloc: counts.sloc };
  state.dirty = true;
  state.revision += 1;
}
