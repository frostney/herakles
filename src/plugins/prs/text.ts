/** Collapse every run of whitespace, newlines included, to one space. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Cut to at most `max` code points, ending in an ellipsis, so emoji are never split. */
export function truncateText(value: string, max: number): string {
  const points = Array.from(value);
  return points.length <= max ? value : `${points.slice(0, max - 1).join("")}…`;
}
