import { existsSync } from "node:fs";
import { join } from "node:path";
import type { TestCommand } from "../domain";

type PackageJson = {
  scripts?: Record<string, string>;
};

export async function discoverTestCommands(projectPath: string): Promise<TestCommand[]> {
  const commands: TestCommand[] = [];
  if (existsSync(join(projectPath, "package.json"))) {
    commands.push(...(await packageJsonCommands(projectPath)));
  }
  if (existsSync(join(projectPath, "Cargo.toml"))) {
    commands.push({ id: "cargo-test", label: "Cargo tests", argv: ["cargo", "test"] });
  }
  if (existsSync(join(projectPath, "go.mod"))) {
    commands.push({ id: "go-test", label: "Go tests", argv: ["go", "test", "./..."] });
  }
  if (existsSync(join(projectPath, "pyproject.toml"))) {
    commands.push({ id: "python-test", label: "Python tests", argv: ["uv", "run", "pytest"] });
  }
  if (existsSync(join(projectPath, "Package.swift"))) {
    commands.push({ id: "swift-test", label: "Swift tests", argv: ["swift", "test"] });
  }
  return dedupe(commands);
}

async function packageJsonCommands(projectPath: string): Promise<TestCommand[]> {
  const parsed = (await Bun.file(join(projectPath, "package.json")).json()) as PackageJson;
  const scripts = parsed.scripts ?? {};
  const commands: TestCommand[] = [];
  if (scripts.test) {
    commands.push({ id: "bun-test", label: "Bun tests", argv: ["bun", "run", "test"] });
  }
  if (scripts.lint) {
    commands.push({ id: "bun-lint", label: "Bun lint", argv: ["bun", "run", "lint"] });
  }
  if (scripts.typecheck) {
    commands.push({
      id: "bun-typecheck",
      label: "Bun typecheck",
      argv: ["bun", "run", "typecheck"],
    });
  }
  return commands;
}

function dedupe(commands: readonly TestCommand[]): TestCommand[] {
  const seen = new Set<string>();
  return commands.filter((command) => {
    const key = command.argv.join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
