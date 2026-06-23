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
  return [...projects].sort((left, right) => compareProjects(left, right, key, direction));
}

function compareProjects(
  left: Project,
  right: Project,
  key: ProjectSortKey,
  direction: ProjectSortDirection,
) {
  const primary = compareByKey(left, right, key, direction);
  if (primary !== 0) return primary;
  if (key !== "starred") {
    const starred = compareBoolean(left.pinned, right.pinned, "desc");
    if (starred !== 0) return starred;
  }
  return left.slug.localeCompare(right.slug);
}

function compareByKey(
  left: Project,
  right: Project,
  key: ProjectSortKey,
  direction: ProjectSortDirection,
) {
  switch (key) {
    case "starred":
      return compareBoolean(left.pinned, right.pinned, direction);
    case "language":
      return compareOptionalText(
        projectPrimaryLanguage(left),
        projectPrimaryLanguage(right),
        direction,
      );
    case "loc":
      return compareOptionalNumber(left.lineCounts?.loc, right.lineCounts?.loc, direction);
    case "sloc":
      return compareOptionalNumber(left.lineCounts?.sloc, right.lineCounts?.sloc, direction);
    case "activity":
      return compareOptionalNumber(
        timestamp(left.latestActivityAt),
        timestamp(right.latestActivityAt),
        direction,
      );
    case "commit":
      return compareOptionalNumber(
        timestamp(left.mainlineCommittedAt),
        timestamp(right.mainlineCommittedAt),
        direction,
      );
  }
}

function projectPrimaryLanguage(project: Project): string | undefined {
  if (project.primaryLanguage) return project.primaryLanguage;
  const topLanguage = project.languageBreakdown
    ?.filter((language) => language.name)
    .sort((left, right) => right.size - left.size || left.name.localeCompare(right.name))[0]?.name;
  return topLanguage ?? project.languages[0];
}

function compareBoolean(left: boolean, right: boolean, direction: ProjectSortDirection): number {
  return compareNumber(Number(left), Number(right), direction);
}

function compareOptionalText(
  left: string | undefined,
  right: string | undefined,
  direction: ProjectSortDirection,
): number {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  const compared = left.localeCompare(right);
  return direction === "asc" ? compared : -compared;
}

function compareOptionalNumber(
  left: number | undefined,
  right: number | undefined,
  direction: ProjectSortDirection,
): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return compareNumber(left, right, direction);
}

function compareNumber(left: number, right: number, direction: ProjectSortDirection): number {
  const compared = left - right;
  return direction === "asc" ? compared : -compared;
}

function timestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}
