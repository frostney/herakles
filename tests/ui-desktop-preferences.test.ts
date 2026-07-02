import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  desktopPreferencesPath,
  readDesktopPreferences,
  resolveDesktopWorkspaceRoot,
  writeDesktopPreferences,
} from "../src/ui/desktop/preferences";

async function tempWorkspace(prefix = "herakles-desktop-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const configDir = join(root, "_herakles");
  const configBody = ["version = 2", "[github]", "owners = []", ""].join("\n");
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, "herakles.toml"), configBody);
  return root;
}

describe("desktop preferences", () => {
  test("stores preferences under the app user data directory", () => {
    expect(desktopPreferencesPath("/tmp/herakles-user-data")).toBe(
      "/tmp/herakles-user-data/preferences.json",
    );
  });

  test("loads empty preferences when the file is missing or malformed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "herakles-prefs-"));
    const path = join(dir, "preferences.json");
    expect(await readDesktopPreferences(path)).toEqual({});

    await writeFile(path, "{nope");
    expect(await readDesktopPreferences(path)).toEqual({});
  });

  test("uses a valid stored workspace root before opening a picker", async () => {
    const workspaceRoot = await tempWorkspace();
    const prefsPath = join(await mkdtemp(join(tmpdir(), "herakles-prefs-")), "preferences.json");
    await writeDesktopPreferences(prefsPath, { workspaceRoot });
    let pickerCalls = 0;

    const resolved = await resolveDesktopWorkspaceRoot({
      preferencesPath: prefsPath,
      chooseDirectory: async () => {
        pickerCalls++;
        return undefined;
      },
    });

    expect(resolved).toBe(workspaceRoot);
    expect(pickerCalls).toBe(0);
  });

  test("falls back to native selection when stored root is invalid", async () => {
    const workspaceRoot = await tempWorkspace();
    const prefsPath = join(await mkdtemp(join(tmpdir(), "herakles-prefs-")), "preferences.json");
    await writeDesktopPreferences(prefsPath, { workspaceRoot: "/missing/herakles" });
    const invalidRoots: string[] = [];

    const resolved = await resolveDesktopWorkspaceRoot({
      preferencesPath: prefsPath,
      notifyInvalidRoot: (root) => {
        invalidRoots.push(root);
      },
      chooseDirectory: async (startingFolder) => {
        expect(startingFolder).toBe("/missing/herakles");
        return workspaceRoot;
      },
    });

    expect(resolved).toBe(workspaceRoot);
    expect(invalidRoots).toEqual(["/missing/herakles"]);
    expect(JSON.parse(await readFile(prefsPath, "utf8")).workspaceRoot).toBe(workspaceRoot);
  });

  test("returns undefined when the user cancels first-use selection", async () => {
    const prefsPath = join(await mkdtemp(join(tmpdir(), "herakles-prefs-")), "preferences.json");

    const resolved = await resolveDesktopWorkspaceRoot({
      preferencesPath: prefsPath,
      chooseDirectory: async () => undefined,
    });

    expect(resolved).toBeUndefined();
  });
});
