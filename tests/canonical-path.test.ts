import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyCanonicalPath, canonicalPathPlan, resolveProjectCanonicalPath } from "../src/app";
import {
  hostedPathMismatchWorkspace,
  mismatchProjectId,
  withFakeGhHostedClone,
} from "./helpers/hosted-clone";

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
    const outsideRoot = await mkdtemp(join(tmpdir(), "herakles-outside-canonical-"));
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
      const outsideRoot = await mkdtemp(join(tmpdir(), "herakles-outside-clone-"));
      const outsideClone = join(outsideRoot, "clone");
      await rename(duplicatePath, outsideClone);
      await symlink(outsideClone, duplicatePath);

      await expect(applyCanonicalPath(workspaceRoot, plan)).rejects.toThrow(
        "No hosted clone path mismatch",
      );
      expect(existsSync(join(workspaceRoot, "open-source", "herakles"))).toBe(false);
      expect(existsSync(outsideClone)).toBe(true);
      await rm(outsideRoot, { recursive: true, force: true });
    });
  });
});
