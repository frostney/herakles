import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { doctor } from "../src/app";
import { createTestWorkspace } from "./helpers/workspace";

async function tempWorkspace() {
  const root = await createTestWorkspace(
    "herakles-doctor-",
    `version = 2
[github]
owners = []
`,
  );
  await writeFile(join(root, "_herakles", ".gitignore"), "cache/\nworktrees/\n");
  return root;
}

describe("doctor", () => {
  test("includes tooling and local state ignore checks", async () => {
    const root = await tempWorkspace();
    await withFakeTools(async () => {
      const result = await doctor(root);
      const checks = Object.fromEntries(result.checks.map((check) => [check.name, check]));

      expect(checks.config?.status).toBe("ok");
      expect(checks["config-state-ignore"]?.status).toBe("ok");
      // The fake bun on PATH exits 1: a passing check proves bun was not spawned.
      expect(checks.bun).toEqual({ name: "bun", status: "ok", message: Bun.version });
      expect(checks.git?.message).toBe("git version 2.50.0-test");
      expect(checks.gh?.message).toBe("gh version 2.70.0-test");
    });
  });

  test("reports missing git and gh as failed checks instead of throwing", async () => {
    const root = await tempWorkspace();
    const emptyBin = await mkdtemp(join(tmpdir(), "herakles-empty-bin-"));
    const previousPath = process.env.PATH ?? "";
    process.env.PATH = emptyBin;
    try {
      const result = await doctor(root);
      const checks = Object.fromEntries(result.checks.map((check) => [check.name, check]));

      expect(checks.git).toEqual({ name: "git", status: "fail", message: "git not found on PATH" });
      expect(checks.gh).toEqual({ name: "gh", status: "fail", message: "gh not found on PATH" });
      expect(checks.bun?.status).toBe("ok");
      expect(checks.config?.status).toBe("ok");
    } finally {
      process.env.PATH = previousPath;
      await rm(emptyBin, { recursive: true, force: true });
    }
  });
});

async function withFakeTools(run: () => Promise<void>) {
  const bin = await mkdtemp(join(tmpdir(), "herakles-fake-tools-"));
  await writeExecutable(
    join(bin, "bun"),
    `#!/usr/bin/env bash
echo "bun must not be spawned" >&2
exit 1
`,
  );
  await writeExecutable(
    join(bin, "git"),
    `#!/usr/bin/env bash
echo "git version 2.50.0-test"
`,
  );
  await writeExecutable(
    join(bin, "gh"),
    `#!/usr/bin/env bash
echo "gh version 2.70.0-test"
`,
  );
  const previousPath = process.env.PATH ?? "";
  process.env.PATH = `${bin}${delimiter}${previousPath}`;
  try {
    await run();
  } finally {
    process.env.PATH = previousPath;
  }
}

async function writeExecutable(path: string, content: string) {
  await writeFile(path, content);
  await chmod(path, 0o755);
}
