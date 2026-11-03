import { buildApplication } from "@stricli/core";
import { buildRootRoute } from "./commands";
import type { CliPlugins } from "./plugins";
import { heraklesApplicationText } from "./text";

export function buildHeraklesApplication(plugins: CliPlugins) {
  return buildApplication(buildRootRoute(plugins), {
    name: "herakles",
    versionInfo: { currentVersion: "2.0.0" },
    scanner: { caseStyle: "allow-kebab-for-camel" },
    documentation: { caseStyle: "convert-camel-to-kebab" },
    localization: { text: heraklesApplicationText },
  });
}
