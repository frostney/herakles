export function renderTomlDiff(before: string | undefined, after: string): string {
  const beforeLines = before ? before.trimEnd().split("\n") : [];
  const afterLines = after.trimEnd().split("\n");
  let prefixLength = 0;
  while (
    prefixLength < beforeLines.length &&
    prefixLength < afterLines.length &&
    beforeLines[prefixLength] === afterLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < beforeLines.length - prefixLength &&
    suffixLength < afterLines.length - prefixLength &&
    beforeLines[beforeLines.length - suffixLength - 1] ===
      afterLines[afterLines.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  const contextBefore = beforeLines.slice(Math.max(0, prefixLength - 1), prefixLength);
  const contextAfter =
    suffixLength === 0
      ? []
      : beforeLines.slice(beforeLines.length - suffixLength, beforeLines.length - suffixLength + 1);
  const removed = beforeLines.slice(
    prefixLength,
    suffixLength === 0 ? beforeLines.length : beforeLines.length - suffixLength,
  );
  const added = afterLines.slice(
    prefixLength,
    suffixLength === 0 ? afterLines.length : afterLines.length - suffixLength,
  );
  return [
    "--- current",
    "+++ planned",
    ...contextBefore.map((line) => `  ${line}`),
    ...removed.map((line) => `- ${line}`),
    ...added.map((line) => `+ ${line}`),
    ...contextAfter.map((line) => `  ${line}`),
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
