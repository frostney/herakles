import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readlink, symlink } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../src/utils/command";
import {
  ambiguousOwnersWorkspace,
  cleanupHostedCloneTempDirs,
  hostedPathMismatchWorkspace,
  mismatchProjectId,
  withFakeGhHostedClone,
} from "./helpers/hosted-clone";

afterEach(cleanupHostedCloneTempDirs);

const cliPath = join(import.meta.dir, "..", "src", "cli", "main.ts");

function fixPath(workspaceRoot: string, args: string[], stdin?: string) {
  return runCommand(
    [
      process.execPath,
      "run",
      cliPath,
      "projects",
      "fix-path",
      "herakles",
      "--root",
      workspaceRoot,
      ...args,
    ],
    { allowFailure: true, timeoutMs: 30_000, ...(stdin === undefined ? {} : { stdin }) },
  );
}

describe("herakles projects fix-path", () => {
  test("--yes moves the checkout without prompting", async () => {
    const { workspaceRoot, duplicatePath, canonicalPath } = await hostedPathMismatchWorkspace();

    await withFakeGhHostedClone(async () => {
      const result = await fixPath(workspaceRoot, ["--yes"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`Moved ${duplicatePath} to ${canonicalPath}`);
      expect(result.stdout).not.toContain("(yes/no)");
      expect(existsSync(duplicatePath)).toBe(false);
      expect(existsSync(canonicalPath)).toBe(true);
    });
  });

  test("moves after an explicit yes answer", async () => {
    const { workspaceRoot, duplicatePath, canonicalPath } = await hostedPathMismatchWorkspace();

    await withFakeGhHostedClone(async () => {
      const result = await fixPath(workspaceRoot, [], "yes\n");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("(yes/no)");
      expect(existsSync(duplicatePath)).toBe(false);
      expect(existsSync(canonicalPath)).toBe(true);
    });
  });

  test("a declined prompt moves nothing", async () => {
    const { workspaceRoot, duplicatePath, canonicalPath } = await hostedPathMismatchWorkspace();

    await withFakeGhHostedClone(async () => {
      const result = await fixPath(workspaceRoot, [], "no\n");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Fix path cancelled.");
      expect(existsSync(duplicatePath)).toBe(true);
      expect(existsSync(canonicalPath)).toBe(false);
    });
  });

  test("a closed stdin counts as a decline instead of hanging or moving", async () => {
    const { workspaceRoot, duplicatePath, canonicalPath } = await hostedPathMismatchWorkspace();

    await withFakeGhHostedClone(async () => {
      const result = await fixPath(workspaceRoot, []);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Fix path cancelled.");
      expect(existsSync(duplicatePath)).toBe(true);
      expect(existsSync(canonicalPath)).toBe(false);
    });
  });

  test("--json --yes prints the result object only", async () => {
    const { workspaceRoot, duplicatePath, canonicalPath } = await hostedPathMismatchWorkspace();

    await withFakeGhHostedClone(async () => {
      const result = await fixPath(workspaceRoot, ["--json", "--yes"]);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        projectId: mismatchProjectId,
        from: duplicatePath,
        to: canonicalPath,
        moved: true,
      });
      expect(existsSync(canonicalPath)).toBe(true);
    });
  });

  test("--json without --yes prompts on stderr and reports a decline as JSON", async () => {
    const { workspaceRoot, duplicatePath, canonicalPath } = await hostedPathMismatchWorkspace();

    await withFakeGhHostedClone(async () => {
      const result = await fixPath(workspaceRoot, ["--json"], "no\n");

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        projectId: mismatchProjectId,
        from: duplicatePath,
        to: canonicalPath,
        moved: false,
      });
      expect(result.stderr).toContain("(yes/no)");
      expect(existsSync(duplicatePath)).toBe(true);
    });
  });

  test("check failures exit non-zero and move nothing", async () => {
    const { workspaceRoot, duplicatePath, canonicalPath } = await hostedPathMismatchWorkspace();
    await mkdir(canonicalPath, { recursive: true });

    await withFakeGhHostedClone(async () => {
      const result = await fixPath(workspaceRoot, ["--yes"]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Canonical checkout path already exists");
      expect(existsSync(duplicatePath)).toBe(true);
    });
  });

  test("a dangling symlink at the canonical path is refused and left untouched", async () => {
    const { workspaceRoot, duplicatePath, canonicalPath } = await hostedPathMismatchWorkspace();
    await mkdir(join(workspaceRoot, "open-source"), { recursive: true });
    const target = join(workspaceRoot, "missing-target");
    await symlink(target, canonicalPath);

    await withFakeGhHostedClone(async () => {
      const result = await fixPath(workspaceRoot, ["--yes"]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Canonical checkout path already exists");
      expect(existsSync(duplicatePath)).toBe(true);
      expect(await readlink(canonicalPath)).toBe(target);
    });
  });

  test("an ambiguous selector is refused with the matching ids", async () => {
    const { workspaceRoot } = await ambiguousOwnersWorkspace();

    await withFakeGhHostedClone(async () => {
      const result = await fixPath(workspaceRoot, ["--yes"]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Ambiguous project");
      expect(result.stderr).toContain("github:frostney/herakles");
      expect(result.stderr).toContain("github:acme/herakles");
    });
  });
});
