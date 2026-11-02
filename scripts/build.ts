#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";

const allTargets = {
  cli: { entrypoint: "./src/cli/main.ts", outfile: "./dist/herakles" },
} as const;

type TargetName = keyof typeof allTargets;

function selectedTargets(argv: string[]): TargetName[] {
  const names = argv.filter((arg) => arg === "cli") as TargetName[];
  return names.length > 0 ? names : (["cli"] as TargetName[]);
}

const targets = selectedTargets(Bun.argv.slice(2)).map((name) => allTargets[name]);

await mkdir("dist", { recursive: true });

let failed = false;
for (const target of targets) {
  const result = await Bun.build({
    entrypoints: [target.entrypoint],
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    compile: {
      outfile: target.outfile,
    },
  });

  if (!result.success) {
    failed = true;
    console.error(`Failed to build ${target.outfile}`);
    for (const log of result.logs) {
      console.error(log);
    }
    continue;
  }

  console.log(`Built ${target.outfile}`);
}

if (failed) {
  process.exit(1);
}
