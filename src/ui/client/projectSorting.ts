import type { Project } from "../../domain";

export type ProjectSortKey = "starred" | "language" | "loc" | "sloc" | "activity" | "commit";
export type ProjectSortDirection = "asc" | "desc";

export const projectSortOptions: Array<{ key: ProjectSortKey; label: string }> = [
  { key: "starred", label: "Starred" },
  { key: "language", label: "Language" },
  { key: "loc", label: "LOC" },
  { key: "sloc", label: "SLOC" },
  { key: "activity", label: "Last activity" },
  { key: "commit", label: "Last commit" },
];

export function defaultProjectSortDirection(key: ProjectSortKey): ProjectSortDirection {
  return key === "language" ? "asc" : "desc";
}

export function sortProjects(
  projects: readonly Project[],
  key: ProjectSortKey,
  direction: ProjectSortDirection,
): Project[] {
  const value = sortValue[key];
  return [...projects].sort((left, right) => {
    const primary = compareValues(value(left), value(right), direction);
    if (primary !== 0) return primary;
    if (key !== "starred") {
      const starred = Number(right.pinned) - Number(left.pinned);
      if (starred !== 0) return starred;
    }
    return left.slug.localeCompare(right.slug);
  });
}

const sortValue: Record<ProjectSortKey, (project: Project) => string | number | undefined> = {
  starred: (project) => Number(project.pinned),
  language: (project) => projectPrimaryLanguage(project) || undefined,
  loc: (project) => project.lineCounts?.loc,
  sloc: (project) => project.lineCounts?.sloc,
  activity: (project) => timestamp(project.latestActivityAt),
  commit: (project) => timestamp(project.mainlineCommittedAt),
};

function compareValues(
  a: string | number | undefined,
  b: string | number | undefined,
  direction: ProjectSortDirection,
): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const compared =
    typeof a === "string" && typeof b === "string" ? a.localeCompare(b) : Number(a) - Number(b);
  return direction === "asc" ? compared : -compared;
}

function projectPrimaryLanguage(project: Project): string | undefined {
  if (project.primaryLanguage) return project.primaryLanguage;
  const topLanguage = project.languageBreakdown
    ?.filter((language) => language.name)
    .sort((left, right) => right.size - left.size || left.name.localeCompare(right.name))[0]?.name;
  return topLanguage ?? project.languages[0];
}

function timestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}
