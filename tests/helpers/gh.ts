import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type FakeGhRepository = {
  name: string;
  owner?: string;
  isArchived?: boolean;
  description?: string;
};

export async function withFakeGhScript(prefix: string, script: string, run: () => Promise<void>) {
  const bin = await mkdtemp(join(tmpdir(), prefix));
  const previousPath = process.env.PATH;
  await writeFile(join(bin, "gh"), script);
  await chmod(join(bin, "gh"), 0o755);
  process.env.PATH = `${bin}:${previousPath ?? ""}`;
  try {
    await run();
  } finally {
    process.env.PATH = previousPath;
  }
}

export function fakeGhRepositoryJson(repo: FakeGhRepository): string {
  const owner = repo.owner ?? "frostney";
  return JSON.stringify(
    [
      {
        name: repo.name,
        nameWithOwner: `${owner}/${repo.name}`,
        owner: { login: owner },
        sshUrl: `git@github.com:${owner}/${repo.name}.git`,
        url: `https://github.com/${owner}/${repo.name}`,
        visibility: "PUBLIC",
        isArchived: repo.isArchived === true,
        ...(repo.description === undefined ? {} : { description: repo.description }),
        repositoryTopics: [],
        languages: [],
      },
    ],
    null,
    2,
  );
}
