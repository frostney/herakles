import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync } from "node:fs";
import { mkdir, readlink, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyCanonicalPath, canonicalPathPlan, resolveProjectCanonicalPath } from "../src/app";
import {
  ambiguousOwnersWorkspace,
  cleanupHostedCloneTempDirs,
  hostedPathMismatchWorkspace,
  mismatchProjectId,
  trackedTempDir,
  withFakeGhHostedClone,
} from "./helpers/hosted-clone";

afterEach(cleanupHostedCloneTempDirs);

describe("canonical path plan and apply", () => {
  test("plan reports the move and changes nothing on disk", async () => {
    const { workspaceRoot, duplicatePath, canonicalPath } = await hostedPathMismatchWorkspace();

    await withFakeGhHostedClone(async () => {
      const plan = await canonicalPathPlan(workspaceRoot, mismatchProjectId);

      expect(plan).toEqual({
        projectId: mismatchProjectId,
        from: duplicatePath,
        to: canonicalPath,
      });
      expect(existsSync(duplicatePath)).toBe(true);
      expect(existsSync(canonicalPath)).toBe(false);
      expect(existsSync(join(workspaceRoot, "open-source"))).toBe(false);
    });
  });

  test("plan resolves a slug to the project id", async () => {
    const { workspaceRoot, duplicatePath, canonicalPath } = await hostedPathMismatchWorkspace();

    await withFakeGhHostedClone(async () => {
      expect(await canonicalPathPlan(workspaceRoot, "herakles")).toEqual({
        projectId: mismatchProjectId,
        from: duplicatePath,
        to: canonicalPath,
      });
    });
  });

  test("plan refuses a project without a path mismatch", async () => {
    const { workspaceRoot, duplicatePath } = await hostedPathMismatchWorkspace();

    await withFakeGhHostedClone(async () => {
      await expect(canonicalPathPlan(workspaceRoot, "unknown")).rejects.toThrow(
        "No hosted clone path mismatch for project: unknown",
      );
      expect(existsSync(duplicatePath)).toBe(true);
    });
  });

  test("apply moves the checkout and the mismatch is gone afterwards", async () => {
    const { workspaceRoot, duplicatePath, canonicalPath } = await hostedPathMismatchWorkspace();

    await withFakeGhHostedClone(async () => {
      const plan = await canonicalPathPlan(workspaceRoot, mismatchProjectId);
      const result = await applyCanonicalPath(workspaceRoot, plan);

      expect(result).toEqual({ ...plan, moved: true });
      expect(existsSync(duplicatePath)).toBe(false);
      expect(existsSync(canonicalPath)).toBe(true);
      await expect(canonicalPathPlan(workspaceRoot, mismatchProjectId)).rejects.toThrow(
        "No hosted clone path mismatch",
      );
    });
  });

  test("apply re-checks and refuses a destination created after the plan", async () => {
    const { workspaceRoot, duplicatePath, canonicalPath } = await hostedPathMismatchWorkspace();

    await withFakeGhHostedClone(async () => {
      const plan = await canonicalPathPlan(workspaceRoot, mismatchProjectId);
      await mkdir(canonicalPath, { recursive: true });

      await expect(applyCanonicalPath(workspaceRoot, plan)).rejects.toThrow(
        "Canonical checkout path already exists",
      );
      expect(existsSync(duplicatePath)).toBe(true);
    });
  });

  test("apply refuses a plan that no longer matches the workspace", async () => {
    const { workspaceRoot, duplicatePath, canonicalPath } = await hostedPathMismatchWorkspace();

    await withFakeGhHostedClone(async () => {
      const plan = await canonicalPathPlan(workspaceRoot, mismatchProjectId);

      await expect(
        applyCanonicalPath(workspaceRoot, { ...plan, to: join(workspaceRoot, "open-source", "x") }),
      ).rejects.toThrow("Canonical path plan changed");
      expect(existsSync(duplicatePath)).toBe(true);
      expect(existsSync(canonicalPath)).toBe(false);
    });
  });

  test("plan and apply refuse a canonical path behind a symlink outside the workspace", async () => {
    const { workspaceRoot, duplicatePath } = await hostedPathMismatchWorkspace();
    const outsideRoot = await trackedTempDir("herakles-outside-canonical-");
    await symlink(outsideRoot, join(workspaceRoot, "open-source"));

    await withFakeGhHostedClone(async () => {
      await expect(canonicalPathPlan(workspaceRoot, mismatchProjectId)).rejects.toThrow(
        "Refusing to move checkout outside workspace",
      );
      await expect(resolveProjectCanonicalPath(workspaceRoot, mismatchProjectId)).rejects.toThrow(
        "Refusing to move checkout outside workspace",
      );
      expect(existsSync(duplicatePath)).toBe(true);
    });
  });

  test("apply refuses when the checkout was replaced by a symlink out of the workspace after planning", async () => {
    const { workspaceRoot, duplicatePath } = await hostedPathMismatchWorkspace();

    await withFakeGhHostedClone(async () => {
      const plan = await canonicalPathPlan(workspaceRoot, mismatchProjectId);
      const outsideRoot = await trackedTempDir("herakles-outside-clone-");
      const outsideClone = join(outsideRoot, "clone");
      await rename(duplicatePath, outsideClone);
      await symlink(outsideClone, duplicatePath);

      await expect(applyCanonicalPath(workspaceRoot, plan)).rejects.toThrow(
        "No hosted clone path mismatch",
      );
      expect(existsSync(join(workspaceRoot, "open-source", "herakles"))).toBe(false);
      expect(existsSync(outsideClone)).toBe(true);
    });
  });

  test("plan refuses a dangling symlink at the canonical path without touching it", async () => {
    const { workspaceRoot, duplicatePath, canonicalPath } = await hostedPathMismatchWorkspace();
    await mkdir(join(workspaceRoot, "open-source"), { recursive: true });
    const target = join(workspaceRoot, "missing-target");
    await symlink(target, canonicalPath);

    await withFakeGhHostedClone(async () => {
      await expect(canonicalPathPlan(workspaceRoot, mismatchProjectId)).rejects.toThrow(
        "Canonical checkout path already exists",
      );
      expect(existsSync(duplicatePath)).toBe(true);
      expect(await readlink(canonicalPath)).toBe(target);
    });
  });

  test("apply refuses a dangling symlink created at the canonical path after the plan", async () => {
    const { workspaceRoot, duplicatePath, canonicalPath } = await hostedPathMismatchWorkspace();

    await withFakeGhHostedClone(async () => {
      const plan = await canonicalPathPlan(workspaceRoot, mismatchProjectId);
      await mkdir(join(workspaceRoot, "open-source"), { recursive: true });
      const target = join(workspaceRoot, "missing-target");
      await symlink(target, canonicalPath);

      await expect(applyCanonicalPath(workspaceRoot, plan)).rejects.toThrow(
        "Canonical checkout path already exists",
      );
      expect(existsSync(duplicatePath)).toBe(true);
      expect(lstatSync(canonicalPath).isSymbolicLink()).toBe(true);
      expect(await readlink(canonicalPath)).toBe(target);
    });
  });

  test("apply checks the destination again after creating parents, before the rename", async () => {
    const { workspaceRoot, duplicatePath, canonicalPath } = await hostedPathMismatchWorkspace();

    await withFakeGhHostedClone(async () => {
      const plan = await canonicalPathPlan(workspaceRoot, mismatchProjectId);
      const target = join(workspaceRoot, "missing-target");
      let renamed = false;

      await expect(
        applyCanonicalPath(workspaceRoot, plan, {
          mkdir: (async (path: string, options: { recursive: true }) => {
            const created = await mkdir(path, options);
            await symlink(target, canonicalPath);
            return created;
          }) as typeof mkdir,
          rename: async () => {
            renamed = true;
          },
        }),
      ).rejects.toThrow("Canonical checkout path already exists");
      expect(renamed).toBe(false);
      expect(existsSync(duplicatePath)).toBe(true);
      expect(await readlink(canonicalPath)).toBe(target);
    });
  });

  test("a failed rename removes the parent directories this call created and rethrows", async () => {
    const { workspaceRoot, duplicatePath } = await hostedPathMismatchWorkspace();
    const nested = join(workspaceRoot, "open-source", "herakles");

    await withFakeGhHostedClone(async () => {
      const plan = await canonicalPathPlan(workspaceRoot, mismatchProjectId);

      await expect(
        applyCanonicalPath(workspaceRoot, plan, {
          rename: async () => {
            throw new Error("rename failed");
          },
        }),
      ).rejects.toThrow("rename failed");
      expect(existsSync(join(workspaceRoot, "open-source"))).toBe(false);
      expect(existsSync(nested)).toBe(false);
      expect(existsSync(duplicatePath)).toBe(true);
    });
  });

  test("a failed rename keeps parent directories that already existed", async () => {
    const { workspaceRoot, duplicatePath } = await hostedPathMismatchWorkspace();
    await mkdir(join(workspaceRoot, "open-source"), { recursive: true });

    await withFakeGhHostedClone(async () => {
      const plan = await canonicalPathPlan(workspaceRoot, mismatchProjectId);

      await expect(
        applyCanonicalPath(workspaceRoot, plan, {
          rename: async () => {
            throw new Error("rename failed");
          },
        }),
      ).rejects.toThrow("rename failed");
      expect(existsSync(join(workspaceRoot, "open-source"))).toBe(true);
      expect(existsSync(duplicatePath)).toBe(true);
    });
  });

  test("a failed rename keeps a created parent directory that is no longer empty", async () => {
    const { workspaceRoot, duplicatePath } = await hostedPathMismatchWorkspace();
    const parent = join(workspaceRoot, "open-source");

    await withFakeGhHostedClone(async () => {
      const plan = await canonicalPathPlan(workspaceRoot, mismatchProjectId);

      await expect(
        applyCanonicalPath(workspaceRoot, plan, {
          rename: async () => {
            await writeFile(join(parent, "unrelated.txt"), "keep");
            throw new Error("rename failed");
          },
        }),
      ).rejects.toThrow("rename failed");
      expect(existsSync(join(parent, "unrelated.txt"))).toBe(true);
      expect(existsSync(duplicatePath)).toBe(true);
    });
  });

  test("an exact project id wins over ambiguity checks", async () => {
    const { workspaceRoot } = await ambiguousOwnersWorkspace();

    await withFakeGhHostedClone(async () => {
      await expect(canonicalPathPlan(workspaceRoot, "github:acme/herakles")).rejects.toThrow(
        "No hosted clone path mismatch for project: github:acme/herakles",
      );
    });
  });

  test("plan refuses a slug or repository name shared by several tracked projects", async () => {
    const { workspaceRoot } = await ambiguousOwnersWorkspace();

    await withFakeGhHostedClone(async () => {
      await expect(canonicalPathPlan(workspaceRoot, "herakles")).rejects.toThrow(
        /Ambiguous project "herakles".*github:frostney\/herakles.*github:acme\/herakles|Ambiguous project "herakles".*github:acme\/herakles.*github:frostney\/herakles/,
      );
      await expect(resolveProjectCanonicalPath(workspaceRoot, "herakles")).rejects.toThrow(
        "Ambiguous project",
      );
    });
  });
});
