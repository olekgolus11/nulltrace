import { normalizeExactOrigin } from "../../authentication/services/authenticated-request-context.service";
import { redactNucleiCommandForPersistence } from "../../tool/nuclei/services/nuclei-command-redaction.helpers";
import { NucleiToolData } from "../../tool/nuclei/types/nuclei.types";
import {
  applyActionDraftFormState,
  getActionDraftBooleanField,
  getActionDraftCommand,
  getActionDraftFormState,
  getActionDraftPayload,
  getActionDraftStringField,
} from "./action-draft-workspace.helpers";
import {
  ActionDraftWorkspaceApplyResult,
  ActionDraftWorkspaceMapInput,
} from "./action-draft-workspace.types";

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

  if (draft.targetTool !== "nmap" && draft.targetTool !== "nuclei") {
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
    let isExactOriginAccepted = false;
    try {
      isExactOriginAccepted = Boolean(
        authenticatedContext?.authCheck.isProceedAllowed &&
        authenticatedContext.origin === normalizeExactOrigin(target),
      );
    } catch {
      isExactOriginAccepted = false;
    }
    if (!isExactOriginAccepted) {
      return {
        ok: false,
        reason:
          "This draft requires an accepted authentication context for the target's exact origin.",
      };
    }
  }
  const { toolData, didApply } = applyActionDraftFormState(
    currentToolName,
    currentToolData,
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
