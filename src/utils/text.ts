/** `1500` as `1500ms`, `60000` as `60s`. */
export function formatDuration(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`;
}

/** Cut to at most `max` code points, ending in an ellipsis, so emoji are never split. */
export function truncateText(value: string, max: number): string {
  const points = Array.from(value);
  return points.length <= max ? value : `${points.slice(0, max - 1).join("")}…`;
}
