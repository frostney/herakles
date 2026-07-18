const packageJson = (await Bun.file("package.json").json()) as { version: string };

const config = {
  app: {
    name: "Herakles Workbench",
    identifier: "com.frostney.herakles",
    version: process.env.HERAKLES_DESKTOP_VERSION ?? packageJson.version,
    description: "A local desktop Workbench for a Herakles Workspace.",
  },
  build: {
    artifactFolder: "artifacts/desktop",
    buildFolder: "build/desktop",
    targets: process.env.HERAKLES_DESKTOP_TARGETS ?? "current",
    bun: {
      entrypoint: "src/ui/desktop/main.ts",
    },
    mac: {
      codesign: false,
      notarize: false,
      createDmg: true,
      bundleCEF: false,
      defaultRenderer: "native",
    },
    watch: ["src", "electrobun.config.ts"],
  },
};

export default config;
