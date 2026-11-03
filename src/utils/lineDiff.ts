export type DiffLine = { kind: "same" | "add" | "remove"; text: string };

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Line-based diff of two texts, ordered as they appear in a unified diff. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const head = a.slice(0, prefix).map((text): DiffLine => ({ kind: "same", text }));
  const tail = a.slice(a.length - suffix).map((text): DiffLine => ({ kind: "same", text }));
  return [
    ...head,
    ...diffMiddle(a.slice(prefix, a.length - suffix), b.slice(prefix, b.length - suffix)),
    ...tail,
  ];
}

function diffMiddle(a: readonly string[], b: readonly string[]): DiffLine[] {
  const width = b.length + 1;
  // lcs[i * width + j] is the longest common subsequence length of a[i..] and b[j..].
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * width + j + 1]! + 1
          : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: "same", text: a[i]! });
      i += 1;
      j += 1;
    } else if (
      j >= b.length ||
      (i < a.length && lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!)
    ) {
      lines.push({ kind: "remove", text: a[i]! });
      i += 1;
    } else {
      lines.push({ kind: "add", text: b[j]! });
      j += 1;
    }
  }
  return lines;
}

const marks = { same: " ", add: "+", remove: "-" } as const;

/** Render diff lines as unified-diff hunks with context. Returns "" when nothing changed. */
export function formatUnifiedDiff(lines: readonly DiffLine[], context = 3): string {
  const oldBefore: number[] = [];
  const newBefore: number[] = [];
  let oldCount = 0;
  let newCount = 0;
  for (const line of lines) {
    oldBefore.push(oldCount);
    newBefore.push(newCount);
    if (line.kind !== "add") oldCount += 1;
    if (line.kind !== "remove") newCount += 1;
  }
  return hunkRanges(lines, context)
    .flatMap(([start, end]) => {
      const hunk = lines.slice(start, end);
      const oldLines = hunk.filter((line) => line.kind !== "add").length;
      const newLines = hunk.filter((line) => line.kind !== "remove").length;
      const oldStart = oldBefore[start]! + (oldLines === 0 ? 0 : 1);
      const newStart = newBefore[start]! + (newLines === 0 ? 0 : 1);
      return [
        `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`,
        ...hunk.map((line) => `${marks[line.kind]}${line.text}`),
      ];
    })
    .join("\n");
}

function hunkRanges(lines: readonly DiffLine[], context: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  lines.forEach((line, index) => {
    if (line.kind === "same") return;
    const start = Math.max(0, index - context);
    const end = Math.min(lines.length, index + context + 1);
    const last = ranges.at(-1);
    if (last && start <= last[1]) last[1] = end;
    else ranges.push([start, end]);
  });
  return ranges;
}
