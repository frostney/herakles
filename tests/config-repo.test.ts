import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addProject, configDoctor, configPull, status } from "../src/app";

async function tempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-config-repo-"));
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

describe("config repository commands", () => {
  test("doctor warns when _herakles is not a git checkout", async () => {
    const result = await configDoctor(await tempWorkspace());
    expect(result.checks.find((check) => check.name === "config-git")?.status).toBe("warn");
  });

  test("doctor reports whether config state scratch files are ignored", async () => {
    const root = await tempWorkspace();

    const missing = await configDoctor(root);
    expect(missing.checks.find((check) => check.name === "config-state-ignore")?.status).toBe(
      "warn",
    );

    await writeFile(join(root, "_herakles", ".gitignore"), ".herakles-state/\n");
    const ignored = await configDoctor(root);
    expect(ignored.checks.find((check) => check.name === "config-state-ignore")?.status).toBe("ok");
  });

  test("pull refuses non-git config directories", async () => {
    await expect(configPull(await tempWorkspace())).rejects.toThrow(
      "_herakles is not a Git checkout",
    );
  });

  test("operational loads auto-pull config repositories and reload config", async () => {
    const root = await tempWorkspace();
    await mkdir(join(root, "_herakles", ".git"), { recursive: true });
    await withFakeGitAndGh(root, async (logPath) => {
      const result = await status(root);
      const log = await readFile(logPath, "utf8");

      expect(log).toContain("git:pull --ff-only");
      expect(log).toContain("gh:repo list frostney");
      expect(result.hostedCount).toBe(1);
    });
  });

  test("operational loads respect auto_pull false", async () => {
    const root = await tempWorkspace();
    await mkdir(join(root, "_herakles", ".git"), { recursive: true });
    await writeTestConfig(root, { config: ["auto_pull = false"], owners: [] });
    await withFakeGitAndGh(root, async (logPath) => {
      const result = await status(root);
      const log = await readFile(logPath, "utf8").catch(() => "");

      expect(log).not.toContain("git:pull --ff-only");
      expect(result.hostedCount).toBe(0);
    });
  });

  test("auto_push commits and pushes synced config mutations", async () => {
    const root = await tempWorkspace();
    await mkdir(join(root, "_herakles", ".git"), { recursive: true });
    await writeTestConfig(root, {
      config: ["auto_pull = false", "auto_push = true"],
      owners: ["frostney"],
    });
    await withFakeGitAndGh(root, async (logPath) => {
      await addProject(root, {
        id: "frostney-tool",
        source: "github",
        repo: "frostney/tool",
        state: "candidate",
      });
      const log = await readFile(logPath, "utf8");
      const config = await readFile(join(root, "_herakles", "herakles.toml"), "utf8");

      expect(config).toContain('[project."frostney-tool"]');
      expect(config).toContain('state = "candidate"');
      expect(log).toContain("git:add");
      expect(log).toContain("herakles.toml");
      expect(log).toContain("git:-c user.name=Herakles");
      expect(log).toContain("commit -m Add frostney-tool Herakles project");
      expect(log).toContain("git:push");
    });
  });
});

async function writeTestConfig(
  root: string,
  options: { config?: string[]; owners?: string[] } = {},
) {
  const config = options.config?.length ? `\n[config]\n${options.config.join("\n")}\n` : "";
  const owners = options.owners ?? [];
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
root = "."
${config}
[github]
owners = [${owners.map((owner) => JSON.stringify(owner)).join(", ")}]
`,
  );
}

async function withFakeGitAndGh(root: string, run: (logPath: string) => Promise<void>) {
  const bin = await mkdtemp(join(tmpdir(), "herakles-config-bin-"));
  const logPath = join(bin, "commands.log");
  const previousPath = process.env.PATH;
  const previousLog = process.env.HERAKLES_TEST_LOG;
  const previousConfig = process.env.HERAKLES_TEST_CONFIG;
  await writeFile(
    join(bin, "git"),
    `#!/bin/sh
printf 'git:%s\\n' "$*" >> "$HERAKLES_TEST_LOG"
if [ "$1" = "pull" ]; then
cat > "$HERAKLES_TEST_CONFIG" <<'TOML'
version = 2
root = "."

[github]
owners = ["frostney"]
TOML
fi
if [ "$1" = "diff" ]; then
  exit 1
fi
exit 0
`,
  );
  await writeFile(
    join(bin, "gh"),
    `#!/bin/sh
printf 'gh:%s\\n' "$*" >> "$HERAKLES_TEST_LOG"
cat <<'JSON'
[{
  "name": "tool",
  "nameWithOwner": "frostney/tool",
  "owner": { "login": "frostney" },
  "sshUrl": "git@github.com:frostney/tool.git",
  "url": "https://github.com/frostney/tool",
  "visibility": "PRIVATE",
  "isPrivate": true,
  "isArchived": false,
  "repositoryTopics": [],
  "languages": []
}]
JSON
`,
  );
  await chmod(join(bin, "git"), 0o755);
  await chmod(join(bin, "gh"), 0o755);
  process.env.PATH = `${bin}:${previousPath ?? ""}`;
  process.env.HERAKLES_TEST_LOG = logPath;
  process.env.HERAKLES_TEST_CONFIG = join(root, "_herakles", "herakles.toml");
  try {
    await run(logPath);
  } finally {
    process.env.PATH = previousPath;
    restoreEnv("HERAKLES_TEST_LOG", previousLog);
    restoreEnv("HERAKLES_TEST_CONFIG", previousConfig);
  }
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
