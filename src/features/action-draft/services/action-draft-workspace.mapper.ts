import { isAcceptedAuthenticatedContextForTarget } from "../../authentication/services/authenticated-request-context-scope.helpers";
import { NmapToolData } from "../../tool/nmap/types/nmap.types";
import { redactNucleiCommandForPersistence } from "../../tool/nuclei/services/nuclei-command-redaction.helpers";
import { NucleiToolData } from "../../tool/nuclei/types/nuclei.types";
import { FfufToolData } from "../../tool/ffuf/types/ffuf.types";
import { validateAuthenticatedFfufTarget } from "../../tool/ffuf/services/ffuf-authenticated-request.helpers";
import { NiktoToolData } from "../../tool/nikto/types/nikto.types";
import { validateTargetedSqlmapCommand } from "../../tool/sqlmap/services/sqlmap-command.helpers";
import { SqlmapToolData } from "../../tool/sqlmap/types/sqlmap.types";
import { validateCurlCommand } from "../../tool/curl/services/curl-command.helpers";
import { CurlToolData } from "../../tool/curl/types/curl.types";
import {
  getActionDraftBooleanField,
  getActionDraftCommand,
  getActionDraftFormState,
  getActionDraftPayload,
  getActionDraftStringField,
} from "./action-draft-payload.helpers";
import {
  ActionDraftWorkspaceApplyResult,
  ActionDraftWorkspaceMapInput,
} from "./action-draft-workspace.types";
import { mapNmapActionDraftFormState } from "./nmap-action-draft-workspace.mapper";
import { mapNucleiActionDraftFormState } from "./nuclei-action-draft-workspace.mapper";
import { mapFfufActionDraftFormState } from "./ffuf-action-draft-workspace.mapper";
import {
  getNiktoActionDraftValidationError,
} from "./nikto-action-draft-validation.helpers";
import { mapNiktoActionDraftFormState } from "./nikto-action-draft-workspace.mapper";
import { mapSqlmapActionDraftFormState } from "./sqlmap-action-draft-workspace.mapper";
import { mapCurlActionDraftFormState } from "./curl-action-draft-workspace.mapper";

export function mapActionDraftToWorkspaceState({
  draft,
  currentToolName,
  currentToolData,
  buildGeneratedCommand,
  authenticatedContext = null,
}: ActionDraftWorkspaceMapInput): ActionDraftWorkspaceApplyResult {
  if (draft.targetTool !== currentToolName) {
    return {
      ok: false,
      reason: `This draft targets ${draft.targetTool}, not ${currentToolName}.`,
    };
  }

  if (
    draft.targetTool !== "nmap" &&
    draft.targetTool !== "nuclei" &&
    draft.targetTool !== "ffuf" &&
    draft.targetTool !== "sqlmap" &&
    draft.targetTool !== "nikto" &&
    draft.targetTool !== "curl"
  ) {
    return {
      ok: false,
      reason: `Draft target ${draft.targetTool} is not an implemented scanner workspace.`,
    };
  }

  const payload = getActionDraftPayload(draft);
  const rawCommand = getActionDraftCommand(payload);
  const command =
    rawCommand && currentToolName === "nuclei"
      ? redactNucleiCommandForPersistence(rawCommand)
      : rawCommand;
  const formState = getActionDraftFormState(payload);
  if (currentToolName === "nikto") {
    const validationError = getNiktoActionDraftValidationError(
      rawCommand,
      formState,
      (currentToolData as NiktoToolData).form.profile,
    );
    if (validationError) {
      return {
        ok: false,
        reason: validationError,
      };
    }
  }
  if (
    currentToolName === "nikto" &&
    getActionDraftBooleanField(formState ?? {}, "useAuthenticatedContext") === true
  ) {
    const target =
      getActionDraftStringField(formState ?? {}, "target") ??
      (currentToolData as NiktoToolData).form.target;
    const authenticationError = getAuthenticatedDraftTargetError(
      authenticatedContext,
      target,
    );
    if (authenticationError) return authenticationError;
  }
  if (
    currentToolName === "nuclei" &&
    getActionDraftBooleanField(formState ?? {}, "useAuthenticatedContext") === true
  ) {
    if (getActionDraftStringField(formState ?? {}, "templatesPath")?.trim()) {
      return {
        ok: false,
        reason: "Authenticated Nuclei drafts cannot use custom template or workflow paths.",
      };
    }
    const target =
      getActionDraftStringField(formState ?? {}, "target") ??
      (currentToolData as NucleiToolData).form.target;
    const authenticationError = getAuthenticatedDraftTargetError(
      authenticatedContext,
      target,
    );
    if (authenticationError) return authenticationError;
  }
  if (
    currentToolName === "ffuf" &&
    getActionDraftBooleanField(formState ?? {}, "useAuthenticatedContext") === true
  ) {
    const ffufToolData = currentToolData as FfufToolData;
    const mode = getActionDraftStringField(formState ?? {}, "mode") ?? ffufToolData.mode;
    const target =
      mode === "content_discovery"
        ? getActionDraftStringField(formState ?? {}, "targetPattern") ??
          (ffufToolData.mode === "content_discovery"
            ? ffufToolData.form.targetPattern
            : ffufToolData.form.endpoint)
        : getActionDraftStringField(formState ?? {}, "endpoint") ??
          (ffufToolData.mode === "content_discovery"
            ? ffufToolData.form.targetPattern.replace(/\/FUZZ$/, "")
            : ffufToolData.form.endpoint);
    let hasCredentialFreeTarget = false;
    try {
      validateAuthenticatedFfufTarget(target);
      hasCredentialFreeTarget = true;
    } catch {
      hasCredentialFreeTarget = false;
    }
    const isExactOriginAccepted =
      hasCredentialFreeTarget &&
      isAcceptedAuthenticatedContextForTarget(authenticatedContext, target);
    if (!isExactOriginAccepted) {
      return {
        ok: false,
        reason:
          "This draft requires an accepted authentication context for the target's exact origin.",
      };
    }
    if (
      rawCommand &&
      /(?:^|\s)-(?:b|cookie|request(?:-proto)?)(?=\s|=|$)/.test(rawCommand)
    ) {
      return {
        ok: false,
        reason:
          "Authenticated FFUF drafts must not include credential or raw-request command flags.",
      };
    }
  }
  if (
    currentToolName === "curl" &&
    getActionDraftBooleanField(formState ?? {}, "useAuthenticatedContext") === true
  ) {
    const target =
      getActionDraftStringField(formState ?? {}, "targetUrl") ??
      (currentToolData as CurlToolData).form.targetUrl;
    const authenticationError = getAuthenticatedDraftTargetError(
      authenticatedContext,
      target,
    );
    if (authenticationError) return authenticationError;
  }
  if (
    currentToolName === "sqlmap" &&
    getActionDraftBooleanField(formState ?? {}, "useAuthenticatedContext") === true
  ) {
    const target =
      getActionDraftStringField(formState ?? {}, "targetUrl") ??
      (currentToolData as SqlmapToolData).form.targetUrl;
    const targetError = getAuthenticatedDraftTargetError(
      authenticatedContext,
      target,
    );
    if (targetError) return targetError;
  }
  let mapped;
  try {
    mapped = currentToolName === "nmap"
      ? mapNmapActionDraftFormState(currentToolData as NmapToolData, formState)
      : currentToolName === "nuclei"
        ? mapNucleiActionDraftFormState(
            currentToolData as NucleiToolData,
            formState,
            authenticatedContext,
          )
        : currentToolName === "ffuf"
          ? mapFfufActionDraftFormState(
              currentToolData as FfufToolData,
              formState,
              authenticatedContext,
            )
          : currentToolName === "sqlmap"
            ? mapSqlmapActionDraftFormState(
                currentToolData as SqlmapToolData,
                formState,
                authenticatedContext,
              )
            : currentToolName === "nikto"
              ? mapNiktoActionDraftFormState(
                  currentToolData as NiktoToolData,
                  formState,
                  authenticatedContext,
                )
              : mapCurlActionDraftFormState(
                  currentToolData as CurlToolData,
                  formState,
                  authenticatedContext,
                );
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Invalid action draft form state.",
    };
  }
  const { toolData, didApply } = mapped;

  if (!command && !didApply) {
    return {
      ok: false,
      reason: "This draft has no usable command or form state for the current workspace.",
    };
  }

  const generatedCommand = buildGeneratedCommand(toolData);
  const commandInput = command ?? generatedCommand;
  if (currentToolName === "sqlmap") {
    try {
      if (didApply) validateTargetedSqlmapCommand(generatedCommand);
      validateTargetedSqlmapCommand(commandInput);
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "Invalid targeted sqlmap draft.",
      };
    }
  }
  if (currentToolName === "curl") {
    try {
      const sessionTarget = (currentToolData as CurlToolData).form.targetUrl;
      validateCurlCommand(generatedCommand, sessionTarget);
      validateCurlCommand(commandInput, sessionTarget);
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "Invalid cURL action draft.",
      };
    }
  }

  return {
    ok: true,
    application: {
      toolData,
      generatedCommand,
      commandInput,
      commandSource: command && command !== generatedCommand ? "manual" : "generated",
      message: `Applied action draft: ${draft.title}`,
    },
  };
}

function getAuthenticatedDraftTargetError(
  authenticatedContext: ActionDraftWorkspaceMapInput["authenticatedContext"],
  target: string,
): ActionDraftWorkspaceApplyResult | null {
  if (isAcceptedAuthenticatedContextForTarget(authenticatedContext ?? null, target)) {
    return null;
  }
  return {
    ok: false,
    reason:
      "This draft requires an accepted authentication context for the target's exact origin.",
  };
}
