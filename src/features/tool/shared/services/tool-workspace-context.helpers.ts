import { redactNucleiCommandForPersistence } from "../../nuclei/services/nuclei-command-redaction.helpers";
import { redactNiktoCommandForPersistence } from "../../nikto/services/nikto-authenticated-command.helpers";
import { NiktoToolData } from "../../nikto/types/nikto.types";
import { redactSqlmapCommandForPersistence } from "../../sqlmap/services/sqlmap-output-redaction.helpers";
import { ToolWorkspaceContextInput } from "./tool-workspace-context.types";

export function sanitizeToolWorkspaceContext(input: ToolWorkspaceContextInput) {
  const redactCommand =
    input.toolName === "nuclei"
      ? redactNucleiCommandForPersistence
      : input.toolName === "nikto"
        ? redactNiktoCommandForPersistence
        : input.toolName === "sqlmap"
          ? redactSqlmapCommandForPersistence
        : null;
  if (!redactCommand) return input;

  const form = { ...input.toolData.form };
  if (input.toolName === "nuclei" && typeof form.extraArgs === "string") {
    form.extraArgs = redactCommand(form.extraArgs);
  }
  if (input.toolName === "nikto" && typeof form.target === "string") {
    form.target = redactCommand(form.target);
  }
  if (input.toolName === "nikto") {
    form.useAuthenticatedContext = false;
  }
  if (input.toolName === "sqlmap" && typeof form.body === "string" && form.body) {
    form.body = "[request body redacted]";
  }
  const toolData =
    input.toolName === "nikto"
      ? {
          ...(input.toolData as NiktoToolData),
          form,
          authentication: {
            ...(input.toolData as NiktoToolData).authentication,
            strategy: "none" as const,
          },
        }
      : {
          ...input.toolData,
          form,
        };
  return {
    ...input,
    commandInput: redactCommand(input.commandInput),
    generatedCommand: redactCommand(input.generatedCommand),
    toolData,
  };
}
