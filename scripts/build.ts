#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import tailwind from "bun-plugin-tailwind";

const allTargets = {
  cli: { entrypoint: "./src/cli/main.ts", outfile: "./dist/herakles" },
  ui: { entrypoint: "./src/ui/server/main.ts", outfile: "./dist/herakles-ui" },
} as const;

type TargetName = keyof typeof allTargets;

function selectedTargets(argv: string[]): TargetName[] {
  const names = argv.filter((arg) => arg === "cli" || arg === "ui") as TargetName[];
  return names.length > 0 ? names : (["cli", "ui"] as TargetName[]);
}

function flagValue(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || undefined;
}

const argv = Bun.argv.slice(2);
const compileTarget = flagValue(argv, "target") as Bun.Build.CompileTarget | undefined;
const outfileOverride = flagValue(argv, "outfile");
const targetNames = selectedTargets(argv);

if ((compileTarget || outfileOverride) && !(targetNames.length === 1 && targetNames[0] === "cli")) {
  console.error("--target and --outfile are only supported with the cli build target.");
  process.exit(1);
}

const targets = targetNames.map((name) => ({
  ...allTargets[name],
  outfile: outfileOverride ?? allTargets[name].outfile,
}));

await mkdir("dist", { recursive: true });

let failed = false;
for (const target of targets) {
  const result = await Bun.build({
    entrypoints: [target.entrypoint],
    plugins: [tailwind],
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    compile: {
      outfile: target.outfile,
      ...(compileTarget ? { target: compileTarget } : {}),
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
