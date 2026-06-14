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
    const argvPath = join(workspace.root, "codex-argv.txt");
    await withFakeCodex(
      `printf '%s\\n' "$*" > ${JSON.stringify(argvPath)}
out=""
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
        const argv = await Bun.file(argvPath).text();
        expect(argv).toContain("--skip-git-repo-check");
        expect(argv).not.toContain("--ask-for-approval");
        expect(argv.trim().endsWith(" -")).toBe(true);
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
    reportPath: join(root, "_herakles", "reports", "summary.md"),
    loaded: await loadConfig(root),
  };
}
