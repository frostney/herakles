import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
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

export function countProjectLines(projectPath: string): ProjectLineCounts | undefined {
  if (!existsSync(projectPath)) return undefined;
  const totals: ProjectLineCounts = { loc: 0, sloc: 0 };
  visit(projectPath, totals);
  return totals;
}

function visit(path: string, totals: ProjectLineCounts) {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch {
    return;
  }
  if (stat.isDirectory()) {
    if (ignoredDirectories.has(basename(path))) return;
    for (const entry of readdirSync(path)) {
      visit(join(path, entry), totals);
    }
    return;
  }
  if (!stat.isFile() || !isCountedFile(path)) return;
  countFile(path, totals);
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
