import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import type { LoadedConfig } from "../config/load";
import type { Project, ReportDetail, ReportSummary } from "../domain";
import { walkFiles } from "../utils/walk";

export type ReportNoteInput = {
  title: string;
  body: string;
  projectId?: string;
  now?: Date;
};

export function reportsRoot(loaded: LoadedConfig): string {
  return join(loaded.paths.workspaceRoot, loaded.config.layout.reports_path);
}

export async function listReports(loaded: LoadedConfig): Promise<ReportSummary[]> {
  const root = reportsRoot(loaded);
  if (!existsSync(root)) return [];
  const files = await walkFiles(root, (name) => name.endsWith(".md"));
  const summaries = await Promise.all(
    files.map(async (path): Promise<ReportSummary> => {
      const info = await stat(path);
      const id = relative(root, path);
      return {
        id,
        path,
        title: basename(path, ".md"),
        kind: id.split("/")[0] ?? "report",
        updatedAt: info.mtime.toISOString(),
      };
    }),
  );
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function writeReport(
  loaded: LoadedConfig,
  relativePath: string,
  content: string,
): Promise<string> {
  return writeReportFile(loaded, relativePath, content);
}

export async function writeReportFile(
  loaded: LoadedConfig,
  relativePath: string,
  content: string,
): Promise<string> {
  const path = join(reportsRoot(loaded), relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return path;
}

export async function createReportNote(
  loaded: LoadedConfig,
  input: ReportNoteInput,
): Promise<ReportDetail> {
  const now = input.now ?? new Date();
  const slug = slugify(input.title);
  const prefix = input.projectId ? `${slugify(input.projectId)}/` : "";
  const id = `notes/${prefix}${now.toISOString().slice(0, 10)}-${slug}.md`;
  await writeReport(loaded, id, renderReportNote(input, now));
  return readReport(loaded, id);
}

export async function readReport(loaded: LoadedConfig, id: string): Promise<ReportDetail> {
  const reports = await listReports(loaded);
  const summary = reports.find((report) => report.id === id);
  if (!summary) throw new Error(`Unknown report: ${id}`);
  return {
    ...summary,
    content: await readFile(summary.path, "utf8"),
  };
}

export async function latestReport(loaded: LoadedConfig): Promise<ReportDetail | undefined> {
  const [summary] = await listReports(loaded);
  return summary ? readReport(loaded, summary.id) : undefined;
}

export async function listProjectReports(
  loaded: LoadedConfig,
  project: Project,
): Promise<ReportSummary[]> {
  const reports = await listReports(loaded);
  const needles = reportNeedles(project);
  const matched: ReportSummary[] = [];
  for (const report of reports) {
    const haystack = `${report.id}\n${report.title}\n${await readFile(report.path, "utf8").catch(
      () => "",
    )}`.toLowerCase();
    if (needles.some((needle) => haystack.includes(needle))) {
      matched.push(report);
    }
  }
  return matched;
}

function renderReportNote(input: ReportNoteInput, now: Date): string {
  return `# ${input.title.trim()}

Kind: note
Generated: ${now.toISOString()}
${input.projectId ? `Project: ${input.projectId}\n` : ""}
${input.body.trim()}
`;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "note";
}

function reportNeedles(project: Project): string[] {
  return [
    project.id,
    project.slug,
    project.repo,
    ...(project.owner ? [`${project.owner}/${project.repo}`] : []),
  ].map((value) => value.toLowerCase());
}
