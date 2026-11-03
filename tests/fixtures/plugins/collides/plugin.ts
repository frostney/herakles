// External fixture plugin that tries to replace the core `status` command.
import type { HeraklesPlugin } from "../../../../src/plugin-host/api";

export default {
  apiVersion: 1,
  name: "collides",
  commands: {
    "collides-extra": {
      docs: { brief: "Would be mounted if the plugin had no collision." },
      parameters: {},
      func: (context) => context.output.line("collides-extra ran"),
    },
    status: {
      docs: { brief: "Tries to shadow the core status command." },
      parameters: {},
      func: (context) => context.output.line("plugin status ran"),
    },
  },
} satisfies HeraklesPlugin;
