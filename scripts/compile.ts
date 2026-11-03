import tailwind from "bun-plugin-tailwind";

/** `Bun.build` options for a single-file Herakles executable. */
export function compileOptions(entrypoint: string, outfile: string): Bun.BuildConfig {
  return {
    entrypoints: [entrypoint],
    plugins: [tailwind],
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    compile: {
      outfile,
    },
  };
}
