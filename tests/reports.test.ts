import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/load";
import { createReportNote, listReports } from "../src/reports";

async function tempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-reports-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
root = "."

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
      title: "Review sync & prune",
      body: "Follow up on the prune wording.",
      projectId: "github:frostney/herakles",
      now: new Date("2026-06-13T10:00:00Z"),
    });
    const content = await readFile(note.path, "utf8");
    const reports = await listReports(loaded);

    expect(note.id).toBe("notes/github-frostney-herakles/2026-06-13-review-sync-prune.md");
    expect(note.kind).toBe("notes");
    expect(content).toContain("# Review sync & prune");
    expect(content).toContain("Project: github:frostney/herakles");
    expect(reports.map((report) => report.id)).toContain(note.id);
  });
});
