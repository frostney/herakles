const posixHomePath = /\/(?:Users|home)\/[^/\s:;,)\]]+(?:\/[^\s:;,)\]]*)*/g;
const windowsHomePath = /\b[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s:;,)\]]+(?:[\\/]+[^\\/\s:;,)\]]*)*/g;

export type DisplayTextPart = {
  kind: "text" | "path";
  value: string;
};

export function displayPath(path: string): string {
  return path
    .replace(/^\/Users\/[^/]+(?=\/|$)/, "~")
    .replace(/^\/home\/[^/]+(?=\/|$)/, "~")
    .replace(/^[A-Za-z]:[\\/]+Users[\\/]+[^\\/]+(?=[\\/]|$)/, "~")
    .replaceAll("\\", "/");
}

export function displayTextWithHomePaths(text: string): string {
  return displayTextPartsWithHomePaths(text)
    .map((part) => part.value)
    .join("");
}

export function displayTextPartsWithHomePaths(text: string): DisplayTextPart[] {
  const matches = [...pathMatches(text, posixHomePath), ...pathMatches(text, windowsHomePath)].sort(
    (a, b) => a.index - b.index,
  );
  if (matches.length === 0) return [{ kind: "text", value: text }];

  const parts: DisplayTextPart[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.index < cursor) continue;
    if (match.index > cursor) {
      parts.push({ kind: "text", value: text.slice(cursor, match.index) });
    }
    parts.push({ kind: "path", value: displayPath(match.value) });
    cursor = match.index + match.value.length;
  }
  if (cursor < text.length) parts.push({ kind: "text", value: text.slice(cursor) });
  return parts;
}

function pathMatches(text: string, pattern: RegExp): Array<{ index: number; value: string }> {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)].map((match) => ({
    index: match.index ?? 0,
    value: match[0],
  }));
}
