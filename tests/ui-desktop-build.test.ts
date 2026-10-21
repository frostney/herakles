import { expect, test } from "bun:test";
import config from "../electrobun.config";

test("desktop bundle compiles the Workbench Tailwind stylesheet", async () => {
  const { entrypoint, ...options } = config.build.bun;
  const result = await Bun.build({
    ...options,
    entrypoints: [entrypoint],
    target: "bun",
  });

  expect(result.success).toBe(true);
  const stylesheets = result.outputs.filter((output) => output.path.endsWith(".css"));
  expect(stylesheets.length).toBeGreaterThan(0);
  const css = (await Promise.all(stylesheets.map((output) => output.text()))).join("\n");
  expect(css).toContain(".flex {");
  expect(css).toContain("display: flex;");
  expect(css).toContain("--font-display:");
  expect(css).not.toContain("@source");
  expect(css).not.toContain("@theme");
});
