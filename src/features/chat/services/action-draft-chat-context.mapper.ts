import { redactNucleiCommandForPersistence } from "../../tool/nuclei/services/nuclei-command-redaction.helpers";
import { redactNiktoCommandForPersistence } from "../../tool/nikto/services/nikto-authenticated-command.helpers";
import { ScannerToolId } from "../../tool/shared/registry/scanner-catalog";
import { redactActionDraftAuthorizationValues } from "./action-draft-chat-context.helpers";
import {
  ActionDraftChatContextArgs,
  ActionDraftChatSessionTarget,
} from "./action-draft-chat-context.types";

export function mapActionDraftChatPayload(
  args: ActionDraftChatContextArgs,
  session: ActionDraftChatSessionTarget | null,
) {
  const scannerTarget = getScannerTargetForDraft(args.targetTool, session);
  const parsedFormState = parseOptionalJson(args.formStateJson, "formStateJson");
  const formState =
    args.targetTool === "nikto"
      ? redactActionDraftAuthorizationValues(
          parsedFormState,
          redactNiktoCommandForPersistence,
        )
      : args.targetTool === "nuclei"
      ? redactActionDraftAuthorizationValues(parsedFormState)
      : parsedFormState;
  const formStateRecord =
    formState && typeof formState === "object" && !Array.isArray(formState)
      ? (formState as Record<string, unknown>)
      : null;
  const normalizedFormState = formStateRecord
    ? args.targetTool === "ffuf"
      ? normalizeFfufDraftFormState(formStateRecord, scannerTarget)
      : args.targetTool === "sqlmap"
        ? normalizeSqlmapDraftFormState(formStateRecord, scannerTarget)
      : {
          ...formStateRecord,
          ...(typeof formStateRecord.target === "string"
            ? {
                target: replaceTargetPlaceholders(formStateRecord.target, scannerTarget),
              }
            : {}),
          ...(!("target" in formStateRecord) && scannerTarget ? { target: scannerTarget } : {}),
        }
    : args.targetTool === "ffuf" && scannerTarget
      ? { mode: "content_discovery", targetPattern: `${scannerTarget.replace(/\/$/, "")}/FUZZ` }
    : formState;

  return {
    ...(scannerTarget
      ? {
          sessionTarget: {
            normalized: session?.normalizedUrl ?? scannerTarget,
            display: session?.displayUrl ?? scannerTarget,
            scannerTarget,
          },
        }
      : {}),
    ...(args.command
      ? {
          command:
            args.targetTool === "nuclei"
              ? redactNucleiCommandForPersistence(
                  replaceTargetPlaceholders(args.command, scannerTarget),
                )
              : args.targetTool === "nikto"
                ? redactNiktoCommandForPersistence(
                    replaceTargetPlaceholders(args.command, scannerTarget),
                  )
              : replaceTargetPlaceholders(args.command, scannerTarget),
        }
      : {}),
    ...(args.intentJson
      ? {
          intent:
            args.targetTool === "nikto"
              ? redactActionDraftAuthorizationValues(
                  parseOptionalJson(args.intentJson, "intentJson"),
                  redactNiktoCommandForPersistence,
                )
              : args.targetTool === "nuclei"
              ? redactActionDraftAuthorizationValues(
                  parseOptionalJson(args.intentJson, "intentJson"),
                )
              : parseOptionalJson(args.intentJson, "intentJson"),
        }
      : {}),
    ...(normalizedFormState !== undefined ? { formState: normalizedFormState } : {}),
  };
}

function normalizeFfufDraftFormState(formState: Record<string, unknown>, scannerTarget: string) {
  if (formState.mode === "parameter_discovery" || formState.mode === "value_fuzzing") {
    return {
      ...formState,
      ...(typeof formState.endpoint === "string"
        ? { endpoint: replaceTargetPlaceholders(formState.endpoint, scannerTarget) }
        : scannerTarget
          ? { endpoint: scannerTarget }
          : {}),
    };
  }

  return {
    ...formState,
    ...(typeof formState.targetPattern === "string"
      ? { targetPattern: replaceTargetPlaceholders(formState.targetPattern, scannerTarget) }
      : scannerTarget
        ? { targetPattern: `${scannerTarget.replace(/\/$/, "")}/FUZZ` }
        : {}),
  };
}

function normalizeSqlmapDraftFormState(
  formState: Record<string, unknown>,
  scannerTarget: string,
) {
  return {
    ...formState,
    ...(typeof formState.targetUrl === "string"
      ? { targetUrl: replaceTargetPlaceholders(formState.targetUrl, scannerTarget) }
      : scannerTarget
        ? { targetUrl: scannerTarget }
        : {}),
  };
}

function parseOptionalJson(value: string | undefined, argumentName: string) {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`create_action_draft ${argumentName} must be valid JSON.`);
  }
}

function getScannerTargetForDraft(
  targetTool: ScannerToolId,
  session: ActionDraftChatSessionTarget | null,
) {
  const target = session?.normalizedUrl.trim() || session?.displayUrl.trim();
  if (!target) {
    return "";
  }

  if (targetTool === "nmap") {
    try {
      return new URL(target).hostname;
    } catch {
      return target.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    }
  }

  return target;
}

function replaceTargetPlaceholders(value: string, target: string) {
  if (!target) {
    return value;
  }

  return value
    .replaceAll("{{TARGET}}", target)
    .replaceAll("<TARGET>", target)
    .replaceAll("{TARGET}", target);
}
