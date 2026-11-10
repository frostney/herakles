import { describe, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchRemotes } from "../src/up/fetch";
import { withEnvironment } from "./helpers/environment";

function git(cwd: string, ...args: string[]) {
  // Pass process.env explicitly so git sees the isolation withEnvironment sets.
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
}

describe("fetch remote selection", () => {
  test("lets git's own boolean parser decide which remotes skipFetchAll leaves out", async () => {
    // A real repository whose remotes point at paths that do not exist: fetching one fails at
    // once, locally, so a failure per remote shows which remotes were fetched at all.
    const root = await mkdtemp(join(tmpdir(), "herakles-fetch-bool-"));
    const missing = join(root, "missing");
    const clone = join(root, "clone");
    await withEnvironment(
      { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
      async () => {
        await mkdir(clone, { recursive: true });
        git(clone, "init", "--quiet");
        for (const remote of ["number", "word", "bare", "off", "zero", "unset"]) {
          git(clone, "remote", "add", remote, join(missing, remote));
        }
        git(clone, "config", "remote.number.skipFetchAll", "2");
        git(clone, "config", "remote.word.skipFetchAll", "yes");
        git(clone, "config", "remote.off.skipFetchAll", "off");
        git(clone, "config", "remote.zero.skipFetchAll", "0");
        // A key without a value is true.
        await appendFile(join(clone, ".git", "config"), '[remote "bare"]\n\tskipFetchAll\n');

        const { fetched, failures } = await fetchRemotes(clone, 30_000);

        expect(fetched).toEqual([]);
        // Only the remotes git itself would fetch were tried: the ones where the setting is
        // false (off, zero) or absent.
        expect(failures.map((failure) => failure.remote).sort()).toEqual(["off", "unset", "zero"]);
      },
    );
  });

  test("surfaces a malformed skipFetchAll value as git does, instead of fetching", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-fetch-bad-bool-"));
    await withEnvironment(
      { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
      async () => {
        git(root, "init", "--quiet");
        git(root, "remote", "add", "origin", join(root, "missing"));
        git(root, "config", "remote.origin.skipFetchAll", "sometimes");

        await expect(fetchRemotes(root, 30_000)).rejects.toThrow("bad boolean");
      },
    );
  });
});
