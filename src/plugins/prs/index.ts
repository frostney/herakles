import { definePlugin } from "../../plugin-host/api";
import { pullRequestsCommand } from "./command";

export default definePlugin({
  apiVersion: 1,
  name: "prs",
  description: "Review open pull requests across tracked hosted projects.",
  commands: { prs: pullRequestsCommand },
});
