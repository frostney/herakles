import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function createTestWorkspace(prefix: string, toml: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(join(root, "_herakles", "herakles.toml"), toml);
  return root;
}
