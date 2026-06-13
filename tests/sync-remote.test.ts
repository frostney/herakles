import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SyncPlan } from "../src/domain";
import { localizeRemoteSyncPlan } from "../src/sync/remote";
import { runCommand } from "../src/utils/command";

function remotePlan(path: string): SyncPlan {
  return {
    generatedAt: "2026-06-13T00:00:00.000Z",
    server: "http://remote.example",
    items: [
      {
        action: "clone",
        reason: "missing local clone",
        project: {
          source: "github",
          id: "github:frostney/tool",
          owner: "frostney",
          repo: "tool",
          slug: "frostney-tool",
          path,
          visibility: "public",
          state: "open-source",
          archived: false,
          pinned: false,
          topics: [],
          tags: [],
          languages: [],
          hasRoadmap: false,
          sync: true,
          automationEnabled: true,
        },
      },
    ],
  };
}

describe("remote sync plans", () => {
  test("localizes remote relative paths under the client workspace root", () => {
    const localized = localizeRemoteSyncPlan(remotePlan("tools/tool"), "/client/workspace");

    expect(localized.items[0]?.project.path).toBe(join("/client/workspace", "tools", "tool"));
  });

  test("rejects remote paths that escape the client workspace root", () => {
    expect(() => localizeRemoteSyncPlan(remotePlan("../outside"), "/client/workspace")).toThrow(
      "workspace root",
    );
  });

  test("CLI prints a localized remote sync plan", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "herakles-remote-cli-"));
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/api/sync/remote/plan") {
          return new Response("not found", { status: 404 });
        }
        if (req.headers.get("authorization") !== "Bearer secret") {
          return new Response("unauthorized", { status: 401 });
        }
        return Response.json(remotePlan("tools/tool"));
      },
    });

    try {
      const result = await runCommand(
        [
          process.execPath,
          "run",
          "src/cli/main.ts",
          "sync",
          "plan",
          "--root",
          workspaceRoot,
          "--json",
          "--server",
          server.url.href,
          "--token",
          "secret",
        ],
        {
          cwd: join(import.meta.dir, ".."),
        },
      );

      const plan = JSON.parse(result.stdout) as SyncPlan;
      expect(plan.items[0]?.action).toBe("clone");
      expect(plan.items[0]?.project.path).toBe(join(workspaceRoot, "tools", "tool"));
    } finally {
      server.stop(true);
    }
  });
});
