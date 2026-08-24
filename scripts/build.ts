#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import tailwind from "bun-plugin-tailwind";

const targets = [
  { entrypoint: "./src/cli/main.ts", outfile: "./dist/herakles" },
  { entrypoint: "./src/ui/server/main.ts", outfile: "./dist/herakles-ui" },
] as const;

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
