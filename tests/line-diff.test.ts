import { describe, expect, test } from "bun:test";
import { formatUnifiedDiff, lineDiff } from "../src/utils/lineDiff";

const changes = (before: string, after: string) =>
  lineDiff(before, after)
    .filter((line) => line.kind !== "same")
    .map((line) => `${line.kind === "add" ? "+" : "-"}${line.text}`);

describe("lineDiff", () => {
  test("reports no changes for identical text", () => {
    expect(changes("a\nb\n", "a\nb\n")).toEqual([]);
    expect(lineDiff("a\nb\n", "a\nb\n").map((line) => line.text)).toEqual(["a", "b"]);
  });

  test("handles empty inputs", () => {
    expect(lineDiff("", "")).toEqual([]);
    expect(changes("", "a\nb\n")).toEqual(["+a", "+b"]);
    expect(changes("a\nb\n", "")).toEqual(["-a", "-b"]);
  });

  test("detects insertions, deletions and replacements", () => {
    expect(changes("a\nb\nc\n", "a\nx\nb\nc\n")).toEqual(["+x"]);
    expect(changes("a\nb\nc\n", "a\nc\n")).toEqual(["-b"]);
    expect(changes("a\nb\nc\n", "a\nx\nc\n")).toEqual(["-b", "+x"]);
  });

  test("finds a minimal diff for moved blocks", () => {
    expect(changes("a\nb\nc\nd\n", "c\nd\na\nb\n")).toEqual(["-a", "-b", "+a", "+b"]);
    expect(changes("a\nb\nc\nd\ne\n", "b\nd\ne\nx\n")).toEqual(["-a", "-c", "+x"]);
  });

  test("keeps order so applying the diff reproduces both sides", () => {
    const before = "one\ntwo\nthree\nfour\nfive\n";
    const after = "one\nthree\nfour\nsix\nfive\nseven\n";
    const lines = lineDiff(before, after);
    const rebuild = (skip: "add" | "remove") =>
      lines
        .filter((line) => line.kind !== skip)
        .map((line) => `${line.text}\n`)
        .join("");
    expect(rebuild("add")).toBe(before);
    expect(rebuild("remove")).toBe(after);
  });

  test("ignores a missing trailing newline", () => {
    expect(changes("a\nb", "a\nb\n")).toEqual([]);
  });
});

describe("formatUnifiedDiff", () => {
  test("returns an empty string when nothing changed", () => {
    expect(formatUnifiedDiff(lineDiff("a\n", "a\n"))).toBe("");
  });

  test("renders one hunk with context and line ranges", () => {
    const before = "1\n2\n3\n4\n5\n6\n7\n8\n9\n";
    const after = "1\n2\n3\n4\nfive\n6\n7\n8\n9\n";
    expect(formatUnifiedDiff(lineDiff(before, after), 2)).toBe(
      ["@@ -3,5 +3,5 @@", " 3", " 4", "-5", "+five", " 6", " 7"].join("\n"),
    );
  });

  test("splits distant changes into separate hunks and merges near ones", () => {
    const before = Array.from({ length: 12 }, (_, i) => `l${i + 1}`).join("\n");
    const after = before.replace("l1\n", "L1\n").replace("l12", "L12");
    const output = formatUnifiedDiff(lineDiff(before, after), 1);
    expect(output.match(/^@@/gm)).toHaveLength(2);
    const near = formatUnifiedDiff(lineDiff("a\nb\nc\nd\n", "A\nb\nc\nD\n"), 1);
    expect(near.match(/^@@/gm)).toHaveLength(1);
  });

  test("starts a pure insertion into empty text at line 1", () => {
    expect(formatUnifiedDiff(lineDiff("", "a\n"))).toBe(["@@ -0,0 +1,1 @@", "+a"].join("\n"));
  });
});
