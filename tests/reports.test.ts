import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/load";
import { createReportNote, listReports, writeReportFile } from "../src/reports";

async function tempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-reports-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
[github]
owners = []
`,
  );
  return root;
}

describe("report notes", () => {
  test("creates a local markdown note under reports", async () => {
    const loaded = await loadConfig(await tempWorkspace());
    const note = await createReportNote(loaded, {
      title: "Review workspace up",
      body: "Follow up on the workspace up wording.",
      projectId: "github:frostney/herakles",
      now: new Date("2026-06-13T10:00:00Z"),
    });
    const content = await readFile(note.path, "utf8");
    const reports = await listReports(loaded);

    expect(note.id).toBe("notes/github-frostney-herakles/2026-06-13-review-workspace-up.md");
    expect(note.kind).toBe("notes");
    expect(content).toContain("# Review workspace up");
    expect(content).toContain("Project: github:frostney/herakles");
    expect(reports.map((report) => report.id)).toContain(note.id);
  });

  test("rejects report paths outside the reports directory", async () => {
    const loaded = await loadConfig(await tempWorkspace());

    await expect(writeReportFile(loaded, "../outside.md", "nope")).rejects.toThrow("Path escapes");
    await expect(writeReportFile(loaded, "/tmp/outside.md", "nope")).rejects.toThrow(
      "Path must be relative",
    );
  });
});
