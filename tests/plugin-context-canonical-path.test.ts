import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createPluginContext } from "../src/cli/pluginContext";
import {
  ambiguousOwnersWorkspace,
  cleanupHostedCloneTempDirs,
  hostedPathMismatchWorkspace,
  mismatchProjectId,
  withFakeGhHostedClone,
} from "./helpers/hosted-clone";

afterEach(cleanupHostedCloneTempDirs);

function contextFor(workspaceRoot: string) {
  const output = { stdout: "", stderr: "" };
  const context = createPluginContext({
    pluginName: "fix-path",
    workspaceRoot,
    json: false,
    stdout: {
      write: (text) => {
        output.stdout += text;
      },
    },
    stderr: {
      write: (text) => {
        output.stderr += text;
      },
    },
  });
  return { context, output };
}

describe("canonicalPath context service", () => {
  test("plan is typed as an operation plan and changes nothing on disk", async () => {
    const { workspaceRoot, duplicatePath, canonicalPath } = await hostedPathMismatchWorkspace();
    const { context } = contextFor(workspaceRoot);

    await withFakeGhHostedClone(async () => {
      const plan = await context.canonicalPath.plan("herakles");

      expect(plan).toMatchObject({
        projectId: mismatchProjectId,
        from: duplicatePath,
        to: canonicalPath,
        steps: [{ action: "move", target: duplicatePath, detail: `to ${canonicalPath}` }],
      });
      expect(plan.summary).toContain("does not delete or duplicate repositories");
      expect(existsSync(duplicatePath)).toBe(true);
      expect(existsSync(canonicalPath)).toBe(false);
    });
  });

  test("applyPlan with yes shows the steps, then moves the checkout", async () => {
    const { workspaceRoot, duplicatePath, canonicalPath } = await hostedPathMismatchWorkspace();
    const { context, output } = contextFor(workspaceRoot);

    await withFakeGhHostedClone(async () => {
      const plan = await context.canonicalPath.plan(mismatchProjectId);
      const outcome = await context.applyPlan(plan, { yes: true });

      expect(outcome).toEqual({
        applied: true,
        result: {
          projectId: mismatchProjectId,
          from: duplicatePath,
          to: canonicalPath,
          moved: true,
        },
      });
      expect(output.stdout).toContain(duplicatePath);
      expect(existsSync(duplicatePath)).toBe(false);
      expect(existsSync(canonicalPath)).toBe(true);
    });
  });

  test("apply re-checks the workspace and refuses a destination created after the plan", async () => {
    const { workspaceRoot, duplicatePath, canonicalPath } = await hostedPathMismatchWorkspace();
    const { context } = contextFor(workspaceRoot);

    await withFakeGhHostedClone(async () => {
      const plan = await context.canonicalPath.plan(mismatchProjectId);
      await mkdir(canonicalPath, { recursive: true });

      await expect(context.applyPlan(plan, { yes: true })).rejects.toThrow(
        "Canonical checkout path already exists",
      );
      expect(existsSync(duplicatePath)).toBe(true);
    });
  });

  test("plan refuses an ambiguous selector and a project without a mismatch", async () => {
    const ambiguous = await ambiguousOwnersWorkspace();
    const mismatch = await hostedPathMismatchWorkspace();

    await withFakeGhHostedClone(async () => {
      await expect(
        contextFor(ambiguous.workspaceRoot).context.canonicalPath.plan("herakles"),
      ).rejects.toThrow("Ambiguous project");
      await expect(
        contextFor(mismatch.workspaceRoot).context.canonicalPath.plan("unknown"),
      ).rejects.toThrow("No hosted clone path mismatch for project: unknown");
    });
  });
});
