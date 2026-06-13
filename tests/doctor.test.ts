import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { doctor } from "../src/app";

async function tempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-doctor-"));
  await mkdir(join(root, "_herakles", ".git"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
[github]
owners = []
`,
  );
  await writeFile(join(root, "_herakles", ".gitignore"), "cache/\nreports/\nworktrees/\nstate/\n");
  return root;
}

describe("doctor", () => {
  test("includes tooling and synced config repository checks", async () => {
    const root = await tempWorkspace();
    await withFakeTools(async () => {
      const result = await doctor(root);
      const checks = Object.fromEntries(result.checks.map((check) => [check.name, check]));

      expect(checks.config?.status).toBe("ok");
      expect(checks["synced-config"]?.status).toBe("ok");
      expect(checks["config-state-ignore"]?.status).toBe("ok");
      expect(checks["config-git"]?.status).toBe("ok");
      expect(checks["config-origin"]?.message).toBe("git@github.com:frostney/herakles-config.git");
      expect(checks.bun?.message).toBe("1.3.0-test");
      expect(checks.git?.message).toBe("git version 2.50.0-test");
      expect(checks.gh?.message).toBe("gh version 2.70.0-test");
      expect(checks.codex?.message).toBe("codex 0.1.0-test");
      expect(checks["codex-profile"]?.status).toBe("ok");
    });
  });
});

async function withFakeTools(run: () => Promise<void>) {
  const bin = await mkdtemp(join(tmpdir(), "herakles-fake-tools-"));
  await writeExecutable(
    join(bin, "bun"),
    `#!/usr/bin/env bash
echo "1.3.0-test"
`,
  );
  await writeExecutable(
    join(bin, "git"),
    `#!/usr/bin/env bash
if [[ "$1 $2 $3" == "remote get-url origin" ]]; then
  echo "git@github.com:frostney/herakles-config.git"
  exit 0
fi
echo "git version 2.50.0-test"
`,
  );
  await writeExecutable(
    join(bin, "gh"),
    `#!/usr/bin/env bash
echo "gh version 2.70.0-test"
`,
  );
  await writeExecutable(
    join(bin, "codex"),
    `#!/usr/bin/env bash
if [[ "$1 $2" == "exec --help" ]]; then
  echo "Usage: codex exec --profile <profile>"
  exit 0
fi
echo "codex 0.1.0-test"
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
