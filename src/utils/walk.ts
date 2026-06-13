import { readdir } from "node:fs/promises";
import { join } from "node:path";

export async function walkFiles(
  root: string,
  predicate: (name: string) => boolean,
): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(path, predicate)));
    } else if (entry.isFile() && predicate(entry.name)) {
      files.push(path);
    }
  }
  return files;
}
