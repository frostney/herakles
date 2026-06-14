export function reportIdFromPath(reportPath: string): string | undefined {
  const normalized = reportPath.replaceAll("\\", "/");
  const relativePrefix = "_herakles/reports/";
  if (normalized.startsWith(relativePrefix)) return normalized.slice(relativePrefix.length);
  const marker = `/${relativePrefix}`;
  const index = normalized.lastIndexOf(marker);
  if (index < 0) return undefined;
  return normalized.slice(index + marker.length);
}
