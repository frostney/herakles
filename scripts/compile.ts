import tailwind from "bun-plugin-tailwind";

/** `Bun.build` options for a single-file Herakles executable, optionally cross-compiled. */
export function compileOptions(
  entrypoint: string,
  outfile: string,
  target?: Bun.Build.CompileTarget,
): Bun.BuildConfig {
  return {
    entrypoints: [entrypoint],
    plugins: [tailwind],
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    compile: {
      outfile,
      ...(target ? { target } : {}),
    },
  };
}
