import { describe, expect, test } from "bun:test";
import { reportIdFromPath } from "../src/ui/client/reportPaths";

describe("UI report paths", () => {
  test("extracts report ids from absolute and workspace-relative report paths", () => {
    expect(reportIdFromPath("/workspace/_reports/evening/2026-06-12.md")).toBe(
      "evening/2026-06-12.md",
    );
    expect(reportIdFromPath("_reports/coderabbit/review.md")).toBe("coderabbit/review.md");
    expect(reportIdFromPath("C:\\Code\\_reports\\weekly\\2026-W24.md")).toBe("weekly/2026-W24.md");
  });

  test("returns undefined for paths outside the reports root", () => {
    expect(reportIdFromPath("/workspace/notes/report.md")).toBeUndefined();
  });
});
