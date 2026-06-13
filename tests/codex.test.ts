import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCodexReportOnly } from "../src/codex";
import { loadConfig } from "../src/config/load";
import { withFakeCodex } from "./helpers/codex";

describe("Codex report-only integration", () => {
  test("passes the prepared prompt and context to codex exec stdin", async () => {
    const workspace = await tempCodexWorkspace("herakles-codex-");
    await withFakeCodex(
      `out=""
previous=""
for arg in "$@"; do
  if [ "$previous" = "--output-last-message" ]; then
    out="$arg"
  fi
  previous="$arg"
done
cat > "$out"
printf '{"event":"done"}\\n'
`,
      async () => {
        const result = await runCodexReportOnly(workspace.loaded, {
          prompt: workspace.prompt,
          worktree: workspace.root,
          reportPath: workspace.reportPath,
          context: "Project context.",
        });

        expect(result.status).toBe("succeeded");
        expect(await Bun.file(workspace.reportPath).text()).toBe(
          "Summarize this.\n\nProject context.",
        );
      },
    );
  });

  test("writes a diagnostic report when codex fails before producing output", async () => {
    const workspace = await tempCodexWorkspace("herakles-codex-fail-");
    await withFakeCodex(
      `echo "codex exploded" >&2
exit 7
`,
      async () => {
        const result = await runCodexReportOnly(workspace.loaded, {
          prompt: workspace.prompt,
          worktree: workspace.root,
          reportPath: workspace.reportPath,
        });
        const report = await Bun.file(workspace.reportPath).text();

        expect(result.status).toBe("failed");
        expect(result.exitCode).toBe(7);
        expect(result.message).toContain("codex exploded");
        expect(report).toContain("Status: failed");
        expect(report).toContain("codex exploded");
      },
    );
  });
});

async function tempCodexWorkspace(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
root = "."

[github]
owners = []

[codex]
profile = "fake-profile"
sandbox = "workspace-write"
`,
  );
  return {
    root,
    prompt: "Summarize this.",
    reportPath: join(root, "_reports", "summary.md"),
    loaded: await loadConfig(root),
  };
}
