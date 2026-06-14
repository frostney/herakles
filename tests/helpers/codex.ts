import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function withFakeCodex(script: string, run: () => Promise<void>) {
  const bin = await fakeCodexBin(script);
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath ?? ""}`;
  try {
    await run();
  } finally {
    process.env.PATH = previousPath;
  }
}

async function fakeCodexBin(script: string): Promise<string> {
  const bin = await mkdtemp(join(tmpdir(), "herakles-fake-codex-"));
  await writeFile(
    join(bin, "codex"),
    `#!/bin/sh
if [ "$1" = "exec" ] && [ "$2" = "--help" ]; then
cat <<'HELP'
Usage: codex exec [OPTIONS] [PROMPT]
  -p, --profile <CONFIG_PROFILE_V2>
  -s, --sandbox <SANDBOX_MODE>
  -C, --cd <DIR>
      --skip-git-repo-check
      --json
  -o, --output-last-message <FILE>
HELP
exit 0
fi
${script}
`,
  );
  await chmod(join(bin, "codex"), 0o755);
  return bin;
}
