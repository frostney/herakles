export function renderTomlDiff(before: string | undefined, after: string): string {
  const beforeLines = before ? before.trimEnd().split("\n") : [];
  const afterLines = after.trimEnd().split("\n");
  return [
    "--- current",
    "+++ planned",
    ...beforeLines.map((line) => `- ${line}`),
    ...afterLines.map((line) => `+ ${line}`),
  ]
    .join("\n")
    .concat("\n");
}

export function renderTomlRemovalDiff(before: string): string {
  return [
    "--- current",
    "+++ planned",
    ...before
      .trimEnd()
      .split("\n")
      .map((line) => `- ${line}`),
  ]
    .join("\n")
    .concat("\n");
}

export function replaceTomlBlock(
  content: string,
  header: string,
  toml: string,
  action: "append" | "replace" | "remove",
): string {
  const range = findTomlBlockRange(content, header);
  if (action === "remove") {
    if (!range) return content;
    return `${content.slice(0, range.start)}${content.slice(range.end)}`.replace(/\n{3,}/g, "\n\n");
  }
  if (!range) {
    const separator = content.endsWith("\n") ? "\n" : "\n\n";
    return `${content}${separator}${toml}`;
  }
  return `${content.slice(0, range.start)}${toml}${content.slice(range.end)}`;
}

function findTomlBlockRange(
  content: string,
  header: string,
): { start: number; end: number } | undefined {
  const start = content.indexOf(header);
  if (start === -1) return undefined;
  const nextHeader = content.slice(start + header.length).search(/\n\[/);
  if (nextHeader === -1) return { start, end: content.length };
  return { start, end: start + header.length + nextHeader + 1 };
}
