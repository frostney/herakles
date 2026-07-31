import { writeFile } from "node:fs/promises";
import { TOML } from "bun";

type TomlBlock = {
  start: number;
  end: number;
  contentEnd: number;
  projectId?: string;
};

export function normalizeProjectConfigOrder(toml: string): string {
  const lines = toml.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) ?? [];
  const headers = tableHeaders(lines);
  if (headers.length === 0) return toml;

  const blocks = headers.map<TomlBlock>((header, index) => {
    const end = headers[index + 1]?.start ?? lines.length;
    let contentEnd = end;
    while (contentEnd > header.start && isBlankLine(lines[contentEnd - 1] ?? "")) {
      contentEnd -= 1;
    }
    return {
      start: header.start,
      end,
      contentEnd,
      ...(header.projectId === undefined ? {} : { projectId: header.projectId }),
    };
  });
  const projectBlocks = blocks
    .filter((block): block is TomlBlock & { projectId: string } => block.projectId !== undefined)
    .map((block) => ({ ...block, lines: lines.slice(block.start, block.contentEnd) }))
    .sort((left, right) => compareProjectIds(left.projectId, right.projectId));
  if (projectBlocks.length < 2) return toml;

  let projectIndex = 0;
  let cursor = 0;
  const normalized: string[] = [];
  for (const block of blocks) {
    normalized.push(...lines.slice(cursor, block.start));
    normalized.push(
      ...(block.projectId === undefined
        ? lines.slice(block.start, block.end)
        : [...projectBlocks[projectIndex++]!.lines, ...lines.slice(block.contentEnd, block.end)]),
    );
    cursor = block.end;
  }
  normalized.push(...lines.slice(cursor));
  return normalized.join("");
}

export async function writeConfigToml(path: string, toml: string): Promise<string> {
  const normalized = normalizeProjectConfigOrder(toml);
  await writeFile(path, normalized);
  return normalized;
}

function tableHeaders(lines: readonly string[]) {
  const headers: Array<{ start: number; projectId?: string }> = [];
  let multilineDelimiter: "'''" | '"""' | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (multilineDelimiter === undefined && isTableHeader(line)) {
      let start = index;
      while (start > 0 && isCommentLine(lines[start - 1] ?? "")) start -= 1;
      const projectId = projectIdFromHeader(line);
      headers.push({
        start,
        ...(projectId === undefined ? {} : { projectId }),
      });
    }
    multilineDelimiter = nextMultilineDelimiter(line, multilineDelimiter);
  }
  return headers;
}

function isTableHeader(line: string): boolean {
  return /^\s*\[(?!\[)[^\r\n]+\]\s*(?:#.*)?(?:\r?\n)?$/.test(line);
}

function isCommentLine(line: string): boolean {
  return /^\s*#.*(?:\r?\n)?$/.test(line);
}

function isBlankLine(line: string): boolean {
  return /^\s*(?:\r?\n)?$/.test(line);
}

function projectIdFromHeader(line: string): string | undefined {
  try {
    const parsed = TOML.parse(
      `${line.replace(/\r?\n$/, "")}\n[__herakles_sort_probe]\nvalue = true`,
    ) as {
      project?: Record<string, unknown>;
    };
    const projectIds = Object.keys(parsed.project ?? {});
    return projectIds.length === 1 ? projectIds[0] : undefined;
  } catch {
    return undefined;
  }
}

function compareProjectIds(left: string, right: string): number {
  const foldedLeft = left.toLowerCase();
  const foldedRight = right.toLowerCase();
  if (foldedLeft < foldedRight) return -1;
  if (foldedLeft > foldedRight) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function nextMultilineDelimiter(
  line: string,
  current: "'''" | '"""' | undefined,
): "'''" | '"""' | undefined {
  let remainder = line;
  if (current) {
    const closingIndex = delimiterIndex(remainder, current);
    if (closingIndex === -1) return current;
    remainder = remainder.slice(closingIndex + current.length);
  }

  while (remainder) {
    const opening = openingDelimiter(remainder);
    if (!opening) return undefined;
    const closingIndex = delimiterIndex(
      remainder,
      opening.delimiter,
      opening.index + opening.delimiter.length,
    );
    if (closingIndex === -1) return opening.delimiter;
    remainder = remainder.slice(closingIndex + opening.delimiter.length);
  }
  return undefined;
}

function openingDelimiter(line: string): { delimiter: "'''" | '"""'; index: number } | undefined {
  for (const match of line.matchAll(/#[^\r\n]*|'''|"""|"(?:\\.|[^"\\])*"|'[^']*'/g)) {
    const token = match[0];
    if (token.startsWith("#")) return undefined;
    if (token === "'''" || token === '"""') {
      return { delimiter: token, index: match.index };
    }
  }
  return undefined;
}

function delimiterIndex(line: string, delimiter: "'''" | '"""', fromIndex = 0): number {
  let index = line.indexOf(delimiter, fromIndex);
  while (index !== -1 && delimiter === '"""' && isEscaped(line, index)) {
    index = line.indexOf(delimiter, index + delimiter.length);
  }
  return index;
}

function isEscaped(line: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}
