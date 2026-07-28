import { isAcceptedAuthenticatedContextForTarget } from "../../authentication/services/authenticated-request-context-scope.helpers";
import { NmapToolData } from "../../tool/nmap/types/nmap.types";
import { redactNucleiCommandForPersistence } from "../../tool/nuclei/services/nuclei-command-redaction.helpers";
import { NucleiToolData } from "../../tool/nuclei/types/nuclei.types";
import { FfufToolData } from "../../tool/ffuf/types/ffuf.types";
import { validateAuthenticatedFfufTarget } from "../../tool/ffuf/services/ffuf-authenticated-request.helpers";
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

  if (draft.targetTool !== "nmap" && draft.targetTool !== "nuclei" && draft.targetTool !== "ffuf") {
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
    const isExactOriginAccepted = isAcceptedAuthenticatedContextForTarget(
      authenticatedContext,
      target,
    );
    if (!isExactOriginAccepted) {
      return {
        ok: false,
        reason:
          "This draft requires an accepted authentication context for the target's exact origin.",
      };
    }
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
  const { toolData, didApply } =
    currentToolName === "nmap"
      ? mapNmapActionDraftFormState(currentToolData as NmapToolData, formState)
      : currentToolName === "nuclei"
        ? mapNucleiActionDraftFormState(
            currentToolData as NucleiToolData,
            formState,
            authenticatedContext,
          )
        : mapFfufActionDraftFormState(
            currentToolData as FfufToolData,
            formState,
            authenticatedContext,
          );

  if (!command && !didApply) {
    return {
      ok: false,
      reason: "This draft has no usable command or form state for the current workspace.",
    };
  }

  const generatedCommand = buildGeneratedCommand(toolData);
  const commandInput = command ?? generatedCommand;

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
