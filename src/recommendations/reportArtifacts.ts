export function recommendationTimestamp(date: Date): string {
  return date
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/, "Z");
}

export function structuredPathFor(relativeReportPath: string): string {
  return relativeReportPath.endsWith(".md")
    ? relativeReportPath.replace(/\.md$/, ".json")
    : `${relativeReportPath}.json`;
}
