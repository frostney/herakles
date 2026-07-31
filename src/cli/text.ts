import { type ApplicationText, text_en } from "@stricli/core";
import { HeraklesWorkspaceNotFoundError } from "../config/workspace";

export const heraklesApplicationText: ApplicationText = {
  ...text_en,
  exceptionWhileRunningCommand(error, ansiColor) {
    if (error instanceof HeraklesWorkspaceNotFoundError) {
      return error.message;
    }
    return text_en.exceptionWhileRunningCommand(error, ansiColor);
  },
};
