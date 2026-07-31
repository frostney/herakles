import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectHeraklesWorkspace } from "../src/config/workspace";
import { type UiServerSession, startUiServerSession } from "../src/ui/server/server";

const sessions: UiServerSession[] = [];

async function tempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-ui-server-"));
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

async function expectServerWorkspace(session: UiServerSession, workspaceRoot: string) {
  const response = await fetch(`${session.url}/api/status`);
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.root).toBe(workspaceRoot);
  return body;
}

afterEach(() => {
  for (const session of sessions.splice(0)) {
    session.stop();
  }
});

describe("UI server lifecycle", () => {
  test("starts from a directory inside a Herakles Workspace", async () => {
    const workspaceRoot = await tempWorkspace();
    const nested = join(workspaceRoot, "open-source", "herakles");
    await mkdir(nested, { recursive: true });
    const session = await startUiServerSession({
      workspaceRoot: selectHeraklesWorkspace(undefined, nested),
      port: 0,
      openBrowser: false,
    });
    sessions.push(session);

    await expectServerWorkspace(session, workspaceRoot);
  });

  test("starts a reusable server session and serves API status", async () => {
    const workspaceRoot = await tempWorkspace();
    const session = await startUiServerSession({
      workspaceRoot,
      port: 0,
      openBrowser: false,
    });
    sessions.push(session);

    expect(session.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const body = await expectServerWorkspace(session, workspaceRoot);
    expect(body.config.syncedConfigPath).toBe(join(workspaceRoot, "_herakles", "herakles.toml"));

    session.stop();
    session.stop();
  });
});
