import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { createHash } from "node:crypto";
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

const memoryCache = new Map<string, { stamp: string; counts: ProjectLineCounts }>();
let diskCache: LineCountCacheFile | undefined;
let diskCachePath: string | undefined;
let diskCacheDirty = false;

/** Point line-count persistence at the workspace `_herakles/cache` directory. */
export function configureLineCountCache(cacheDir: string | undefined) {
  if (!cacheDir) {
    diskCachePath = undefined;
    diskCache = undefined;
    diskCacheDirty = false;
    return;
  }
  const nextPath = join(cacheDir, "line-counts.json");
  if (diskCachePath === nextPath) return;
  diskCachePath = nextPath;
  diskCache = undefined;
  diskCacheDirty = false;
}

export function countProjectLines(projectPath: string): ProjectLineCounts | undefined {
  if (!existsSync(projectPath)) return undefined;
  const inventory = collectInventory(projectPath);
  const stamp = stampInventory(inventory);
  const cached = memoryCache.get(projectPath);
  if (cached?.stamp === stamp) return { ...cached.counts };

  const fromDisk = readDiskEntry(projectPath);
  if (fromDisk?.stamp === stamp) {
    memoryCache.set(projectPath, { stamp, counts: { loc: fromDisk.loc, sloc: fromDisk.sloc } });
    return { loc: fromDisk.loc, sloc: fromDisk.sloc };
  }

  const totals: ProjectLineCounts = { loc: 0, sloc: 0 };
  for (const file of inventory) {
    countFile(file.path, totals);
  }
  memoryCache.set(projectPath, { stamp, counts: { ...totals } });
  writeDiskEntry(projectPath, stamp, totals);
  return totals;
}

/** Flush pending cache writes. Safe to call after a workspace resolve. */
export async function flushLineCountCache(): Promise<void> {
  if (!diskCacheDirty || !diskCachePath || !diskCache) return;
  await mkdir(join(diskCachePath, ".."), { recursive: true }).catch(() => undefined);
  // mkdir parent of file
  const parent = diskCachePath.slice(0, diskCachePath.lastIndexOf("/"));
  await mkdir(parent, { recursive: true });
  await writeFile(diskCachePath, `${JSON.stringify(diskCache)}\n`, "utf8");
  diskCacheDirty = false;
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
  if (!trimmed) return false;
  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("--") ||
    trimmed.startsWith(";") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("*/") ||
    trimmed.startsWith("<!--") ||
    trimmed.startsWith("-->")
  ) {
    return false;
  }
  return true;
}

function ensureDiskCache(): LineCountCacheFile {
  if (diskCache) return diskCache;
  diskCache = { version: 1, projects: {} };
  if (!diskCachePath || !existsSync(diskCachePath)) return diskCache;
  try {
    const raw = readFileSync(diskCachePath, "utf8");
    const parsed = JSON.parse(raw) as LineCountCacheFile;
    if (parsed?.version === 1 && parsed.projects && typeof parsed.projects === "object") {
      diskCache = parsed;
    }
  } catch {
    // ignore corrupt cache
  }
  return diskCache;
}

function readDiskEntry(projectPath: string) {
  if (!diskCachePath) return undefined;
  return ensureDiskCache().projects[projectPath];
}

function writeDiskEntry(projectPath: string, stamp: string, counts: ProjectLineCounts) {
  if (!diskCachePath) return;
  const cache = ensureDiskCache();
  cache.projects[projectPath] = { stamp, loc: counts.loc, sloc: counts.sloc };
  diskCacheDirty = true;
}
